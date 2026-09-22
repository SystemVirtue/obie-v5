-- Persist YouTube playability checks so blocked/restricted videos can be
-- prevented before they reach the live player.

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS youtube_playability_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (youtube_playability_status IN (
      'unknown',
      'playable',
      'embed_blocked',
      'restricted',
      'unavailable',
      'invalid',
      'check_failed'
    )),
  ADD COLUMN IF NOT EXISTS youtube_playability_reason TEXT,
  ADD COLUMN IF NOT EXISTS youtube_playability_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS youtube_embeddable BOOLEAN,
  ADD COLUMN IF NOT EXISTS youtube_oembed_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS youtube_last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS youtube_last_error_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_media_items_youtube_playability
  ON public.media_items (source_type, youtube_playability_status, youtube_playability_checked_at DESC)
  WHERE source_type = 'youtube';

CREATE TABLE IF NOT EXISTS public.youtube_playability_checks (
  id BIGSERIAL PRIMARY KEY,
  media_item_id UUID REFERENCES public.media_items(id) ON DELETE CASCADE,
  youtube_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'unknown',
    'playable',
    'embed_blocked',
    'restricted',
    'unavailable',
    'invalid',
    'check_failed'
  )),
  reason TEXT,
  checked_by TEXT NOT NULL DEFAULT 'unknown',
  embeddable BOOLEAN,
  oembed_ok BOOLEAN,
  error_code TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_youtube_playability_checks_media
  ON public.youtube_playability_checks (media_item_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_youtube_playability_checks_youtube
  ON public.youtube_playability_checks (youtube_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.youtube_alternative_candidates (
  id BIGSERIAL PRIMARY KEY,
  source_media_item_id UUID REFERENCES public.media_items(id) ON DELETE CASCADE,
  source_youtube_id TEXT NOT NULL,
  candidate_youtube_id TEXT NOT NULL,
  candidate_title TEXT NOT NULL,
  candidate_artist TEXT,
  candidate_url TEXT NOT NULL,
  candidate_duration INT,
  candidate_thumbnail TEXT,
  score INT NOT NULL DEFAULT 0,
  playability_status TEXT NOT NULL DEFAULT 'unknown',
  playability_reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_youtube_id, candidate_youtube_id)
);

CREATE INDEX IF NOT EXISTS idx_youtube_alternative_candidates_source
  ON public.youtube_alternative_candidates (source_media_item_id, score DESC, created_at DESC);

ALTER TABLE public.youtube_playability_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_alternative_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read youtube playability checks" ON public.youtube_playability_checks;
CREATE POLICY "Public read youtube playability checks"
  ON public.youtube_playability_checks FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Public read youtube alternative candidates" ON public.youtube_alternative_candidates;
CREATE POLICY "Public read youtube alternative candidates"
  ON public.youtube_alternative_candidates FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.record_youtube_playability(
  p_media_item_id UUID DEFAULT NULL,
  p_youtube_id TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'unknown',
  p_reason TEXT DEFAULT NULL,
  p_checked_by TEXT DEFAULT 'unknown',
  p_embeddable BOOLEAN DEFAULT NULL,
  p_oembed_ok BOOLEAN DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_media_id UUID;
  v_youtube_id TEXT;
  v_status TEXT;
BEGIN
  v_status := COALESCE(NULLIF(p_status, ''), 'unknown');

  IF v_status NOT IN ('unknown', 'playable', 'embed_blocked', 'restricted', 'unavailable', 'invalid', 'check_failed') THEN
    v_status := 'unknown';
  END IF;

  IF p_media_item_id IS NOT NULL THEN
    SELECT id, substring(source_id from '([A-Za-z0-9_-]{11})$')
    INTO v_media_id, v_youtube_id
    FROM public.media_items
    WHERE id = p_media_item_id;
  END IF;

  IF v_media_id IS NULL AND p_youtube_id IS NOT NULL THEN
    SELECT id, substring(source_id from '([A-Za-z0-9_-]{11})$')
    INTO v_media_id, v_youtube_id
    FROM public.media_items
    WHERE source_type = 'youtube'
      AND substring(source_id from '([A-Za-z0-9_-]{11})$') = p_youtube_id
    ORDER BY fetched_at DESC
    LIMIT 1;
  END IF;

  v_youtube_id := COALESCE(NULLIF(p_youtube_id, ''), v_youtube_id);

  IF v_youtube_id IS NULL THEN
    RAISE EXCEPTION 'record_youtube_playability requires media_item_id or youtube_id';
  END IF;

  INSERT INTO public.youtube_playability_checks (
    media_item_id,
    youtube_id,
    status,
    reason,
    checked_by,
    embeddable,
    oembed_ok,
    error_code,
    details
  )
  VALUES (
    v_media_id,
    v_youtube_id,
    v_status,
    p_reason,
    COALESCE(NULLIF(p_checked_by, ''), 'unknown'),
    p_embeddable,
    p_oembed_ok,
    p_error_code,
    COALESCE(p_details, '{}'::jsonb)
  );

  IF v_media_id IS NOT NULL THEN
    UPDATE public.media_items
    SET
      youtube_playability_status = v_status,
      youtube_playability_reason = p_reason,
      youtube_playability_checked_at = now(),
      youtube_embeddable = p_embeddable,
      youtube_oembed_ok = p_oembed_ok,
      youtube_last_error_code = CASE WHEN p_error_code IS NOT NULL THEN p_error_code ELSE youtube_last_error_code END,
      youtube_last_error_at = CASE WHEN p_error_code IS NOT NULL THEN now() ELSE youtube_last_error_at END,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'youtube_playability_status', v_status,
        'youtube_playability_reason', p_reason,
        'youtube_playability_checked_at', now(),
        'youtube_embeddable', p_embeddable,
        'youtube_oembed_ok', p_oembed_ok
      )
    WHERE id = v_media_id;
  END IF;

  RETURN v_media_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_youtube_playability(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB)
  TO authenticated, service_role;

-- Skip YouTube-only queue entries that are already known to be unplayable.
-- Cached Cloudflare/R2 matches are still allowed because they do not depend on
-- the YouTube iframe.
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
  v_skipped_count      INT := 0;
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

  LOOP
    v_next_queue_item := NULL;
    v_media := NULL;
    v_youtube_id := NULL;
    v_r2_match := NULL;
    v_playback_url := NULL;

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

      IF v_loop AND v_skipped_count < 200 THEN
        SELECT active_playlist_id INTO v_active_playlist_id
        FROM   players
        WHERE  id = p_player_id;

        IF v_active_playlist_id IS NOT NULL THEN
          SELECT lp.loaded_count INTO v_loaded_count
          FROM   load_playlist(p_player_id, v_active_playlist_id, 0, TRUE) lp;

          IF v_loaded_count > 0 THEN
            CONTINUE;
          END IF;
        END IF;
      END IF;

      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
      RETURN;
    END IF;

    SELECT
      m.id,
      m.source_id,
      m.source_type,
      m.url,
      m.title,
      m.duration,
      m.youtube_playability_status,
      m.youtube_playability_reason,
      m.youtube_playability_checked_at,
      m.youtube_embeddable,
      m.youtube_oembed_ok,
      m.youtube_last_error_code
      INTO v_media
    FROM public.media_items m
    WHERE m.id = v_next_queue_item.media_item_id;

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

    IF v_media.source_type = 'youtube'
       AND v_playback_source = 'youtube'
       AND v_media.youtube_playability_status IN ('embed_blocked', 'restricted', 'unavailable', 'invalid') THEN
      DELETE FROM queue WHERE id = v_next_queue_item.id;
      v_skipped_count := v_skipped_count + 1;

      PERFORM log_event(
        p_player_id,
        'queue_next_skipped_unplayable',
        'warn',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'youtube_id', v_youtube_id,
          'type', v_next_queue_item.type,
          'playability_status', v_media.youtube_playability_status,
          'playability_reason', v_media.youtube_playability_reason,
          'playability_checked_at', v_media.youtube_playability_checked_at,
          'youtube_embeddable', v_media.youtube_embeddable,
          'youtube_oembed_ok', v_media.youtube_oembed_ok,
          'youtube_last_error_code', v_media.youtube_last_error_code
        )
      );

      IF v_skipped_count >= 200 THEN
        PERFORM log_event(
          p_player_id,
          'queue_next_unplayable_skip_limit',
          'error',
          jsonb_build_object('skipped_count', v_skipped_count)
        );
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
        RETURN;
      END IF;

      CONTINUE;
    END IF;

    DELETE FROM queue WHERE id = v_next_queue_item.id;

    UPDATE player_status
    SET
      current_media_id      = v_next_queue_item.media_item_id,
      state                 = 'loading',
      progress              = 0,
      now_playing_index     = CASE
        WHEN v_next_queue_item.type = 'normal' THEN COALESCE(now_playing_index, 0) + 1
        ELSE now_playing_index
      END,
      source                = v_playback_source,
      local_url             = CASE
        WHEN v_playback_source = 'cloudflare' THEN v_playback_url
        ELSE NULL
      END,
      playback_started_at   = NULL,
      playback_error        = NULL,
      playback_error_code   = NULL,
      playback_error_at     = NULL,
      last_recovery_reason  = NULL,
      last_updated          = NOW()
    WHERE player_id = p_player_id;

    PERFORM log_event(
      p_player_id,
      'queue_next',
      'info',
      jsonb_build_object(
        'media_item_id',   v_next_queue_item.media_item_id,
        'type',            v_next_queue_item.type,
        'source_type',     v_media.source_type,
        'playback_source', v_playback_source,
        'playback_url',    v_playback_url,
        'youtube_id',      v_youtube_id,
        'youtube_playability_status', v_media.youtube_playability_status
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
    RETURN;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.queue_next(UUID, UUID) TO authenticated, service_role;
