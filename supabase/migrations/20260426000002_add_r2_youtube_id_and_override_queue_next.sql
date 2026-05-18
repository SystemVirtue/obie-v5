-- Add extracted YouTube IDs to R2 cache rows so playback can prefer
-- Cloudflare media for already-imported YouTube playlist items.

ALTER TABLE public.r2_files
ADD COLUMN IF NOT EXISTS youtube_id TEXT;

CREATE INDEX IF NOT EXISTS idx_r2_files_youtube_id
  ON public.r2_files (youtube_id);

-- Backfill existing rows using the trailing 11-char YouTube ID pattern
-- from the object key before the file extension.
UPDATE public.r2_files
SET youtube_id = substring(regexp_replace(object_key, '\.[^.]+$', '') from '([A-Za-z0-9_-]{11})$')
WHERE youtube_id IS NULL;

-- Prefer Cloudflare playback when the queued media item is a YouTube source
-- whose video ID exists in r2_files.youtube_id.
CREATE OR REPLACE FUNCTION queue_next(
  p_player_id UUID
)
RETURNS TABLE(media_item_id UUID, title TEXT, url TEXT, duration INT) AS $$
DECLARE
  v_next_queue_item    RECORD;
  v_loop               BOOLEAN;
  v_active_playlist_id UUID;
  v_loaded_count       INT;
  v_media              RECORD;
  v_youtube_id         TEXT;
  v_r2_match           RECORD;
  v_playback_source    TEXT;
  v_playback_url       TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  IF EXISTS (
    SELECT 1 FROM queue
    WHERE player_id = p_player_id AND type = 'priority' AND played_at IS NULL
  ) THEN
    SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
    FROM   queue q
    WHERE  q.player_id = p_player_id AND q.type = 'priority' AND q.played_at IS NULL
    ORDER  BY q.position ASC
    LIMIT  1;
  ELSE
    SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
    FROM   queue q
    WHERE  q.player_id = p_player_id AND q.type = 'normal' AND q.played_at IS NULL
    ORDER  BY q.position ASC
    LIMIT  1;
  END IF;

  IF v_next_queue_item IS NULL THEN
    SELECT ps.loop INTO v_loop
    FROM   player_settings ps
    WHERE  ps.player_id = p_player_id;

    IF v_loop THEN
      SELECT active_playlist_id INTO v_active_playlist_id
      FROM   players
      WHERE  id = p_player_id;

      IF v_active_playlist_id IS NOT NULL THEN
        SELECT lp.loaded_count INTO v_loaded_count
        FROM   load_playlist(p_player_id, v_active_playlist_id, 0, TRUE) lp;

        IF v_loaded_count > 0 THEN
          SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
          FROM   queue q
          WHERE  q.player_id = p_player_id AND q.type = 'normal' AND q.played_at IS NULL
          ORDER  BY q.position ASC
          LIMIT  1;
        END IF;
      END IF;
    END IF;

    IF v_next_queue_item IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
      RETURN;
    END IF;
  END IF;

  UPDATE queue SET played_at = NOW() WHERE id = v_next_queue_item.id;

  SELECT m.id, m.source_id, m.source_type, m.url, m.title, m.duration
    INTO v_media
  FROM   media_items m
  WHERE  m.id = v_next_queue_item.media_item_id;

  v_playback_source := CASE
    WHEN v_media.source_type = 'cloudflare' THEN 'cloudflare'
    ELSE 'youtube'
  END;
  v_playback_url := CASE
    WHEN v_media.source_type = 'cloudflare' THEN v_media.url
    ELSE NULL
  END;

  IF v_media.source_type = 'youtube' THEN
    v_youtube_id := substring(v_media.source_id from '([A-Za-z0-9_-]{11})$');

    IF v_youtube_id IS NOT NULL THEN
      SELECT r.public_url, r.object_key
        INTO v_r2_match
      FROM public.r2_files r
      WHERE r.youtube_id = v_youtube_id
      ORDER BY r.synced_at DESC, r.created_at DESC
      LIMIT 1;

      IF v_r2_match.public_url IS NOT NULL THEN
        v_playback_source := 'cloudflare';
        v_playback_url := v_r2_match.public_url;
      END IF;
    END IF;
  END IF;

  UPDATE player_status
  SET
    current_media_id  = v_next_queue_item.media_item_id,
    state             = 'loading',
    progress          = 0,
    now_playing_index = CASE
      WHEN v_next_queue_item.type = 'normal' THEN COALESCE(now_playing_index, 0) + 1
      ELSE now_playing_index
    END,
    source            = v_playback_source,
    local_url         = CASE
      WHEN v_playback_source = 'cloudflare' THEN v_playback_url
      ELSE NULL
    END,
    last_updated      = NOW()
  WHERE player_id = p_player_id;

  PERFORM log_event(
    p_player_id,
    'queue_next',
    'info',
    jsonb_build_object(
      'media_item_id', v_next_queue_item.media_item_id,
      'type',          v_next_queue_item.type,
      'source_type',   v_media.source_type,
      'playback_source', v_playback_source,
      'youtube_id',    v_youtube_id
    )
  );

  RETURN QUERY
  SELECT
    m.id,
    m.title,
    CASE
      WHEN v_playback_source = 'cloudflare' THEN v_playback_url
      ELSE m.url
    END,
    m.duration
  FROM media_items m
  WHERE m.id = v_next_queue_item.media_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION queue_next(UUID) TO authenticated, service_role;
