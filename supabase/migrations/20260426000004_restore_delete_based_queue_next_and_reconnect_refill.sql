-- Restore the production delete-based queue_next(UUID, UUID DEFAULT NULL)
-- semantics, keep idempotency support, and preserve the Cloudflare/R2
-- playback override by YouTube ID.

DROP FUNCTION IF EXISTS public.queue_next(UUID);

CREATE OR REPLACE FUNCTION public.queue_next(
  p_player_id         UUID,
  p_expected_media_id UUID DEFAULT NULL
)
RETURNS TABLE(media_item_id UUID, title TEXT, url TEXT, duration INT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_next_queue_item    RECORD;
  v_loop               BOOLEAN;
  v_active_playlist_id UUID;
  v_loaded_count       INT;
  v_media              RECORD;
  v_current_media_id   UUID;
  v_youtube_id         TEXT;
  v_r2_match           RECORD;
  v_playback_source    TEXT;
  v_playback_url       TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  IF p_expected_media_id IS NOT NULL THEN
    SELECT ps.current_media_id INTO v_current_media_id
    FROM   player_status ps
    WHERE  ps.player_id = p_player_id;

    IF v_current_media_id IS DISTINCT FROM p_expected_media_id THEN
      PERFORM log_event(
        p_player_id,
        'queue_next_skipped',
        'warn',
        jsonb_build_object(
          'reason',            'idempotency_guard',
          'expected_media_id', p_expected_media_id,
          'actual_media_id',   v_current_media_id
        )
      );
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
      RETURN;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM queue
    WHERE player_id = p_player_id AND type = 'priority'
  ) THEN
    SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
    FROM   queue q
    WHERE  q.player_id = p_player_id AND q.type = 'priority'
    ORDER  BY q.position ASC
    LIMIT  1;
  ELSE
    SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
    FROM   queue q
    WHERE  q.player_id = p_player_id AND q.type = 'normal'
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
          WHERE  q.player_id = p_player_id AND q.type = 'normal'
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

  DELETE FROM queue WHERE id = v_next_queue_item.id;

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
      'media_item_id',  v_next_queue_item.media_item_id,
      'type',           v_next_queue_item.type,
      'source_type',    v_media.source_type,
      'playback_source', v_playback_source,
      'youtube_id',     v_youtube_id
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
$$;

GRANT EXECUTE ON FUNCTION public.queue_next(UUID, UUID) TO authenticated, service_role;

-- Reconnects should preserve real queue state, but if the queue only contains
-- the currently playing track (or nothing at all), refill from the active
-- playlist so Up Next is restored.
CREATE OR REPLACE FUNCTION public.initialize_player_playlist(
  p_player_id UUID
)
RETURNS TABLE(success BOOLEAN, playlist_id UUID, playlist_name TEXT, loaded_count INT) AS $$
DECLARE
  v_future_queue_count INT;
  v_current_media_id   UUID;
  v_playlist_id        UUID;
  v_playlist_name      TEXT;
  v_loaded_count       INT := 0;
BEGIN
  SELECT ps.current_media_id INTO v_current_media_id
  FROM   player_status ps
  WHERE  ps.player_id = p_player_id;

  SELECT COUNT(*) INTO v_future_queue_count
  FROM   queue q
  WHERE  q.player_id = p_player_id
    AND (
      q.type = 'priority'
      OR q.media_item_id IS DISTINCT FROM v_current_media_id
    );

  IF v_future_queue_count > 0 THEN
    RETURN QUERY SELECT TRUE, NULL::UUID, NULL::TEXT, 0;
    RETURN;
  END IF;

  SELECT active_playlist_id INTO v_playlist_id
  FROM   players
  WHERE  id = p_player_id;

  IF v_playlist_id IS NOT NULL THEN
    SELECT name INTO v_playlist_name
    FROM   playlists
    WHERE  id = v_playlist_id;

    IF NOT FOUND THEN
      v_playlist_id := NULL;
    END IF;
  END IF;

  IF v_playlist_id IS NULL THEN
    SELECT p.id, p.name INTO v_playlist_id, v_playlist_name
    FROM   playlists p
    WHERE  EXISTS (SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = p.id)
    ORDER  BY p.created_at DESC
    LIMIT  1;
  END IF;

  IF v_playlist_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0;
    RETURN;
  END IF;

  SELECT lp.loaded_count INTO v_loaded_count
  FROM   load_playlist(p_player_id, v_playlist_id, 0) lp;

  RETURN QUERY SELECT TRUE, v_playlist_id, v_playlist_name, v_loaded_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.initialize_player_playlist(UUID) TO authenticated, service_role;
