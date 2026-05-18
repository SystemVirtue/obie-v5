-- Production-safe YouTube playability resolution rollout.
--
-- This migration is intentionally additive:
-- - keep playlist rows intact;
-- - prefer explicit Cloudflare/replacement overrides when available;
-- - soft-exclude unresolved media from future queues instead of deleting it;
-- - preserve queue_next as the single live promotion path.

CREATE OR REPLACE FUNCTION public.extract_youtube_id(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    substring(p_value from 'youtube:([A-Za-z0-9_-]{11})$'),
    substring(p_value from '[?&]v=([A-Za-z0-9_-]{11})'),
    substring(p_value from 'youtu\.be/([A-Za-z0-9_-]{11})'),
    substring(p_value from '/embed/([A-Za-z0-9_-]{11})'),
    substring(p_value from '/shorts/([A-Za-z0-9_-]{11})'),
    substring(p_value from '([A-Za-z0-9_-]{11})$')
  );
$$;

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS youtube_id TEXT,
  ADD COLUMN IF NOT EXISTS excluded_from_playback BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS excluded_reason TEXT,
  ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replacement_media_item_id UUID REFERENCES public.media_items(id);

CREATE INDEX IF NOT EXISTS idx_media_items_youtube_id
  ON public.media_items (youtube_id)
  WHERE youtube_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_items_excluded_from_playback
  ON public.media_items (excluded_from_playback, excluded_at DESC)
  WHERE excluded_from_playback = TRUE;

UPDATE public.media_items
SET youtube_id = COALESCE(
  public.extract_youtube_id(source_id),
  public.extract_youtube_id(url)
)
WHERE source_type = 'youtube'
  AND youtube_id IS NULL;

UPDATE public.r2_files
SET youtube_id = COALESCE(
  public.extract_youtube_id(object_key),
  public.extract_youtube_id(file_name),
  youtube_id
)
WHERE youtube_id IS NULL;

CREATE TABLE IF NOT EXISTS public.media_playback_overrides (
  media_item_id UUID PRIMARY KEY REFERENCES public.media_items(id) ON DELETE CASCADE,
  override_type TEXT NOT NULL CHECK (override_type IN ('cloudflare', 'replacement', 'excluded', 'youtube')),
  playback_url TEXT,
  r2_file_id UUID REFERENCES public.r2_files(id) ON DELETE SET NULL,
  replacement_media_item_id UUID REFERENCES public.media_items(id) ON DELETE SET NULL,
  confidence INT NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_playback_overrides_type
  ON public.media_playback_overrides (override_type, updated_at DESC);

ALTER TABLE public.media_playback_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read media playback overrides" ON public.media_playback_overrides;
CREATE POLICY "Public read media playback overrides"
  ON public.media_playback_overrides FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.create_or_get_media_item(
  p_source_id    TEXT,
  p_source_type  TEXT,
  p_title        TEXT,
  p_artist       TEXT    DEFAULT NULL,
  p_url          TEXT    DEFAULT NULL,
  p_duration     INT     DEFAULT NULL,
  p_thumbnail    TEXT    DEFAULT NULL,
  p_metadata     JSONB   DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_youtube_id TEXT;
BEGIN
  v_youtube_id := CASE
    WHEN p_source_type = 'youtube' THEN COALESCE(
      public.extract_youtube_id(p_source_id),
      public.extract_youtube_id(p_url)
    )
    ELSE NULL
  END;

  IF p_source_type = 'youtube' AND v_youtube_id IS NOT NULL THEN
    SELECT id
      INTO v_id
    FROM public.media_items
    WHERE source_type = 'youtube'
      AND youtube_id = v_youtube_id
    ORDER BY fetched_at DESC
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      UPDATE public.media_items
      SET
        title = p_title,
        artist = p_artist,
        url = p_url,
        duration = p_duration,
        thumbnail = p_thumbnail,
        youtube_id = v_youtube_id,
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
        fetched_at = NOW()
      WHERE id = v_id;
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO public.media_items (
    source_id,
    source_type,
    title,
    artist,
    url,
    duration,
    thumbnail,
    metadata,
    youtube_id
  )
  VALUES (
    p_source_id,
    p_source_type,
    p_title,
    p_artist,
    p_url,
    p_duration,
    p_thumbnail,
    COALESCE(p_metadata, '{}'::jsonb),
    v_youtube_id
  )
  ON CONFLICT (source_id) DO UPDATE
    SET
      title = EXCLUDED.title,
      artist = EXCLUDED.artist,
      url = EXCLUDED.url,
      duration = EXCLUDED.duration,
      thumbnail = EXCLUDED.thumbnail,
      metadata = COALESCE(public.media_items.metadata, '{}'::jsonb) || EXCLUDED.metadata,
      youtube_id = COALESCE(public.media_items.youtube_id, EXCLUDED.youtube_id),
      fetched_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_or_get_media_item(TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, JSONB)
  TO authenticated, service_role;

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT id, COALESCE(youtube_id, public.extract_youtube_id(source_id), public.extract_youtube_id(url))
      INTO v_media_id, v_youtube_id
    FROM public.media_items
    WHERE id = p_media_item_id;
  END IF;

  v_youtube_id := COALESCE(NULLIF(p_youtube_id, ''), v_youtube_id);

  IF v_media_id IS NULL AND v_youtube_id IS NOT NULL THEN
    SELECT id, COALESCE(youtube_id, public.extract_youtube_id(source_id), public.extract_youtube_id(url))
      INTO v_media_id, v_youtube_id
    FROM public.media_items
    WHERE source_type = 'youtube'
      AND COALESCE(youtube_id, public.extract_youtube_id(source_id), public.extract_youtube_id(url)) = v_youtube_id
    ORDER BY fetched_at DESC
    LIMIT 1;
  END IF;

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
      youtube_id = v_youtube_id,
      youtube_playability_status = v_status,
      youtube_playability_reason = p_reason,
      youtube_playability_checked_at = now(),
      youtube_embeddable = p_embeddable,
      youtube_oembed_ok = p_oembed_ok,
      youtube_last_error_code = CASE WHEN p_error_code IS NOT NULL THEN p_error_code ELSE youtube_last_error_code END,
      youtube_last_error_at = CASE WHEN p_error_code IS NOT NULL THEN now() ELSE youtube_last_error_at END,
      excluded_from_playback = CASE WHEN v_status = 'playable' THEN FALSE ELSE excluded_from_playback END,
      excluded_reason = CASE WHEN v_status = 'playable' THEN NULL ELSE excluded_reason END,
      excluded_at = CASE WHEN v_status = 'playable' THEN NULL ELSE excluded_at END,
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

CREATE OR REPLACE FUNCTION public.media_has_playable_route(p_media_item_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_media RECORD;
  v_youtube_id TEXT;
  v_override RECORD;
BEGIN
  SELECT *
    INTO v_media
  FROM public.media_items
  WHERE id = p_media_item_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_media.source_type IN ('cloudflare', 'local') THEN
    RETURN COALESCE(v_media.url, '') <> '';
  END IF;

  SELECT *
    INTO v_override
  FROM public.media_playback_overrides
  WHERE media_item_id = p_media_item_id;

  IF FOUND THEN
    IF v_override.override_type = 'excluded' THEN
      RETURN FALSE;
    END IF;

    IF v_override.override_type = 'cloudflare' AND COALESCE(v_override.playback_url, '') <> '' THEN
      RETURN TRUE;
    END IF;

    IF v_override.override_type = 'replacement'
       AND v_override.replacement_media_item_id IS NOT NULL
       AND v_override.replacement_media_item_id IS DISTINCT FROM p_media_item_id THEN
      RETURN public.media_has_playable_route(v_override.replacement_media_item_id);
    END IF;

    IF v_override.override_type = 'youtube' THEN
      RETURN TRUE;
    END IF;
  END IF;

  IF COALESCE(v_media.excluded_from_playback, FALSE) THEN
    RETURN FALSE;
  END IF;

  IF v_media.source_type = 'youtube' THEN
    v_youtube_id := COALESCE(v_media.youtube_id, public.extract_youtube_id(v_media.source_id), public.extract_youtube_id(v_media.url));

    IF v_youtube_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.r2_files r
         WHERE r.youtube_id = v_youtube_id
           AND COALESCE(r.public_url, '') <> ''
       ) THEN
      RETURN TRUE;
    END IF;

    IF v_media.youtube_playability_status IN ('embed_blocked', 'restricted', 'unavailable', 'invalid', 'check_failed') THEN
      RETURN FALSE;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.media_has_playable_route(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_add(
  p_player_id UUID,
  p_media_item_id UUID,
  p_type TEXT DEFAULT 'normal',
  p_requested_by TEXT DEFAULT 'admin'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_id UUID;
  v_next_position INT;
  v_max_size INT;
  v_current_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  IF NOT public.media_has_playable_route(p_media_item_id) THEN
    RAISE EXCEPTION 'Media item has no playable route';
  END IF;

  SELECT max_queue_size
    INTO v_max_size
  FROM public.player_settings
  WHERE player_id = p_player_id;

  SELECT COUNT(*)
    INTO v_current_count
  FROM public.queue
  WHERE player_id = p_player_id
    AND played_at IS NULL;

  IF v_current_count >= COALESCE(v_max_size, 50) THEN
    RAISE EXCEPTION 'Queue is full (max: %)', COALESCE(v_max_size, 50);
  END IF;

  SELECT COALESCE(MAX(position) + 1, 0)
    INTO v_next_position
  FROM public.queue
  WHERE player_id = p_player_id
    AND type = p_type
    AND played_at IS NULL;

  INSERT INTO public.queue (player_id, media_item_id, type, position, requested_by)
  VALUES (p_player_id, p_media_item_id, p_type, v_next_position, p_requested_by)
  RETURNING id INTO v_queue_id;

  PERFORM public.log_event(p_player_id, 'queue_add', 'info', jsonb_build_object(
    'queue_id', v_queue_id,
    'media_item_id', p_media_item_id,
    'type', p_type,
    'position', v_next_position
  ));

  RETURN v_queue_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.queue_add(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_next(
  p_player_id         UUID,
  p_expected_media_id UUID DEFAULT NULL
)
RETURNS TABLE(media_item_id UUID, title TEXT, url TEXT, duration INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_queue_item    RECORD;
  v_loop               BOOLEAN;
  v_active_playlist_id UUID;
  v_loaded_count       INT;
  v_media              RECORD;
  v_current_media_id   UUID;
  v_youtube_id         TEXT;
  v_r2_match           RECORD;
  v_override           RECORD;
  v_override_found     BOOLEAN := FALSE;
  v_effective_media_id UUID;
  v_playback_source    TEXT;
  v_playback_url       TEXT;
  v_skipped_count      INT := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  IF p_expected_media_id IS NOT NULL THEN
    SELECT ps.current_media_id
      INTO v_current_media_id
    FROM public.player_status ps
    WHERE ps.player_id = p_player_id;

    IF v_current_media_id IS DISTINCT FROM p_expected_media_id THEN
      PERFORM public.log_event(
        p_player_id,
        'queue_next_skipped',
        'warn',
        jsonb_build_object(
          'reason', 'idempotency_guard',
          'expected_media_id', p_expected_media_id,
          'actual_media_id', v_current_media_id
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
    v_override := NULL;
    v_override_found := FALSE;
    v_effective_media_id := NULL;
    v_playback_source := 'youtube';
    v_playback_url := NULL;

    IF EXISTS (
      SELECT 1
      FROM public.queue q
      WHERE q.player_id = p_player_id
        AND q.type = 'priority'
        AND q.played_at IS NULL
    ) THEN
      SELECT q.id, q.media_item_id, q.type
        INTO v_next_queue_item
      FROM public.queue q
      WHERE q.player_id = p_player_id
        AND q.type = 'priority'
        AND q.played_at IS NULL
      ORDER BY q.position ASC
      LIMIT 1;
    ELSE
      SELECT q.id, q.media_item_id, q.type
        INTO v_next_queue_item
      FROM public.queue q
      WHERE q.player_id = p_player_id
        AND q.type = 'normal'
        AND q.played_at IS NULL
      ORDER BY q.position ASC
      LIMIT 1;
    END IF;

    IF v_next_queue_item IS NULL THEN
      SELECT ps.loop
        INTO v_loop
      FROM public.player_settings ps
      WHERE ps.player_id = p_player_id;

      IF v_loop AND v_skipped_count < 200 THEN
        SELECT p.active_playlist_id
          INTO v_active_playlist_id
        FROM public.players p
        WHERE p.id = p_player_id;

        IF v_active_playlist_id IS NOT NULL THEN
          SELECT lp.loaded_count
            INTO v_loaded_count
          FROM public.load_playlist(p_player_id, v_active_playlist_id, 0, TRUE) lp;

          IF COALESCE(v_loaded_count, 0) > 0 THEN
            CONTINUE;
          END IF;
        END IF;
      END IF;

      UPDATE public.player_status
      SET
        current_media_id = NULL,
        state = 'idle',
        progress = 0,
        source = 'youtube',
        local_url = NULL,
        playback_started_at = NULL,
        playback_error = NULL,
        playback_error_code = NULL,
        playback_error_at = NULL,
        last_recovery_reason = NULL,
        last_updated = NOW()
      WHERE player_id = p_player_id;

      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
      RETURN;
    END IF;

    IF p_expected_media_id IS NOT NULL
       AND v_next_queue_item.media_item_id = p_expected_media_id THEN
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
        p_player_id,
        'queue_next_removed_stale_current_row',
        'warn',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'queue_id', v_next_queue_item.id,
          'type', v_next_queue_item.type
        )
      );

      IF v_skipped_count >= 200 THEN
        PERFORM public.log_event(
          p_player_id,
          'queue_next_skip_limit',
          'error',
          jsonb_build_object('skipped_count', v_skipped_count)
        );
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
        RETURN;
      END IF;

      CONTINUE;
    END IF;

    SELECT *
      INTO v_media
    FROM public.media_items m
    WHERE m.id = v_next_queue_item.media_item_id;

    IF NOT FOUND THEN
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
        p_player_id,
        'queue_next_missing_media',
        'error',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'queue_id', v_next_queue_item.id
        )
      );

      CONTINUE;
    END IF;

    v_effective_media_id := v_media.id;

    SELECT *
      INTO v_override
    FROM public.media_playback_overrides
    WHERE media_item_id = v_media.id;
    v_override_found := FOUND;

    IF v_override_found AND v_override.override_type = 'excluded' THEN
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
        p_player_id,
        'queue_next_skipped_excluded',
        'warn',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'reason', v_override.reason,
          'override_type', v_override.override_type
        )
      );

      CONTINUE;
    END IF;

    IF v_override_found AND v_override.override_type = 'replacement' THEN
      IF v_override.replacement_media_item_id IS NULL
         OR v_override.replacement_media_item_id = v_media.id
         OR NOT public.media_has_playable_route(v_override.replacement_media_item_id) THEN
        DELETE FROM public.queue
        WHERE id = v_next_queue_item.id;

        v_skipped_count := v_skipped_count + 1;

        PERFORM public.log_event(
          p_player_id,
          'queue_next_skipped_invalid_replacement',
          'warn',
          jsonb_build_object(
            'media_item_id', v_next_queue_item.media_item_id,
            'replacement_media_item_id', v_override.replacement_media_item_id,
            'reason', v_override.reason
          )
        );

        CONTINUE;
      END IF;

      v_effective_media_id := v_override.replacement_media_item_id;

      SELECT *
        INTO v_media
      FROM public.media_items m
      WHERE m.id = v_effective_media_id;

      SELECT *
        INTO v_override
      FROM public.media_playback_overrides
      WHERE media_item_id = v_effective_media_id;
      v_override_found := FOUND;
    END IF;

    IF NOT public.media_has_playable_route(v_effective_media_id) THEN
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
        p_player_id,
        'queue_next_skipped_unplayable',
        'warn',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'effective_media_item_id', v_effective_media_id,
          'type', v_next_queue_item.type,
          'playability_status', v_media.youtube_playability_status,
          'playability_reason', v_media.youtube_playability_reason,
          'excluded_from_playback', v_media.excluded_from_playback,
          'excluded_reason', v_media.excluded_reason
        )
      );

      IF v_skipped_count >= 200 THEN
        PERFORM public.log_event(
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

    v_playback_source := CASE
      WHEN v_media.source_type = 'cloudflare' THEN 'cloudflare'
      WHEN v_media.source_type = 'local' THEN 'local'
      ELSE 'youtube'
    END;
    v_playback_url := CASE
      WHEN v_media.source_type IN ('cloudflare', 'local') THEN v_media.url
      ELSE NULL
    END;

    IF v_media.source_type = 'youtube' THEN
      v_youtube_id := COALESCE(v_media.youtube_id, public.extract_youtube_id(v_media.source_id), public.extract_youtube_id(v_media.url));

      IF v_override_found AND v_override.override_type = 'cloudflare' AND COALESCE(v_override.playback_url, '') <> '' THEN
        v_playback_source := 'cloudflare';
        v_playback_url := v_override.playback_url;
      ELSIF v_youtube_id IS NOT NULL THEN
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

    DELETE FROM public.queue
    WHERE id = v_next_queue_item.id;

    UPDATE public.player_status
    SET
      current_media_id = v_effective_media_id,
      state = 'loading',
      progress = 0,
      now_playing_index = CASE
        WHEN v_next_queue_item.type = 'normal' THEN COALESCE(now_playing_index, -1) + 1
        ELSE now_playing_index
      END,
      source = v_playback_source,
      local_url = CASE
        WHEN v_playback_source IN ('cloudflare', 'local') THEN v_playback_url
        ELSE NULL
      END,
      playback_started_at = NULL,
      playback_error = NULL,
      playback_error_code = NULL,
      playback_error_at = NULL,
      last_recovery_reason = NULL,
      last_updated = NOW()
    WHERE player_id = p_player_id;

    PERFORM public.log_event(
      p_player_id,
      'queue_next',
      'info',
      jsonb_build_object(
        'media_item_id', v_effective_media_id,
        'original_media_item_id', v_next_queue_item.media_item_id,
        'type', v_next_queue_item.type,
        'source_type', v_media.source_type,
        'playback_source', v_playback_source,
        'youtube_id', v_youtube_id,
        'youtube_playability_status', v_media.youtube_playability_status
      )
    );

    RETURN QUERY
    SELECT
      m.id,
      m.title,
      CASE
        WHEN v_playback_source IN ('cloudflare', 'local') THEN v_playback_url
        ELSE m.url
      END,
      m.duration
    FROM public.media_items m
    WHERE m.id = v_effective_media_id;
    RETURN;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.queue_next(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.load_playlist(
  p_player_id    UUID,
  p_playlist_id  UUID,
  p_start_index  INT     DEFAULT 0,
  p_skip_shuffle BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(loaded_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loaded_count         INT := 0;
  v_shuffle              BOOLEAN := FALSE;
  v_current_media_id     UUID;
  v_current_state        TEXT;
  v_preserve_now_playing BOOLEAN := FALSE;
  v_current_playlist_position INT;
  v_started_media_item_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  SELECT COALESCE(ps.shuffle, FALSE)
    INTO v_shuffle
  FROM public.player_settings ps
  WHERE ps.player_id = p_player_id;

  SELECT st.current_media_id, st.state
    INTO v_current_media_id, v_current_state
  FROM public.player_status st
  WHERE st.player_id = p_player_id;

  v_preserve_now_playing := (
    v_current_media_id IS NOT NULL
    AND v_current_state IN ('playing', 'paused', 'loading')
  );

  IF v_preserve_now_playing THEN
    DELETE FROM public.queue q
    WHERE q.id IN (
      SELECT q2.id
      FROM public.queue q2
      WHERE q2.player_id = p_player_id
        AND q2.media_item_id = v_current_media_id
        AND q2.played_at IS NULL
      ORDER BY CASE WHEN q2.type = 'priority' THEN 0 ELSE 1 END,
               q2.position ASC
      LIMIT 1
    );

    SELECT MIN(pi.position)
      INTO v_current_playlist_position
    FROM public.playlist_items pi
    WHERE pi.playlist_id = p_playlist_id
      AND pi.media_item_id = v_current_media_id;
  END IF;

  DELETE FROM public.queue
  WHERE player_id = p_player_id
    AND type = 'normal';

  INSERT INTO public.queue (player_id, type, media_item_id, position, requested_by)
  SELECT
    p_player_id,
    'normal',
    pi.media_item_id,
    ROW_NUMBER() OVER (ORDER BY pi.position) - 1,
    'playlist'
  FROM public.playlist_items pi
  WHERE pi.playlist_id = p_playlist_id
    AND public.media_has_playable_route(pi.media_item_id)
    AND (
      NOT v_preserve_now_playing
      OR (
        pi.media_item_id IS DISTINCT FROM v_current_media_id
        AND (
          v_current_playlist_position IS NULL
          OR pi.position > v_current_playlist_position
        )
      )
    )
  ORDER BY pi.position;

  GET DIAGNOSTICS v_loaded_count = ROW_COUNT;

  UPDATE public.players
  SET
    active_playlist_id = p_playlist_id,
    updated_at = NOW()
  WHERE id = p_player_id;

  IF v_shuffle AND v_loaded_count > 1 AND NOT p_skip_shuffle THEN
    PERFORM public.queue_shuffle(p_player_id, 'normal');
  END IF;

  IF NOT v_preserve_now_playing THEN
    UPDATE public.player_status
    SET
      current_media_id = NULL,
      state = 'idle',
      progress = 0,
      now_playing_index = p_start_index - 1,
      queue_head_position = 0,
      source = 'youtube',
      local_url = NULL,
      playback_started_at = NULL,
      playback_error = NULL,
      playback_error_code = NULL,
      playback_error_at = NULL,
      last_recovery_reason = NULL,
      last_updated = NOW()
    WHERE player_id = p_player_id;

    IF v_loaded_count > 0
       OR EXISTS (
         SELECT 1
         FROM public.queue q
         WHERE q.player_id = p_player_id
           AND q.type = 'priority'
           AND q.played_at IS NULL
       ) THEN
      SELECT qn.media_item_id
        INTO v_started_media_item_id
      FROM public.queue_next(p_player_id, NULL) qn
      LIMIT 1;
    END IF;
  END IF;

  PERFORM public.log_event(
    p_player_id,
    'playlist_loaded',
    'info',
    jsonb_build_object(
      'playlist_id', p_playlist_id,
      'start_index', p_start_index,
      'loaded_count', v_loaded_count,
      'shuffled', v_shuffle AND v_loaded_count > 1 AND NOT p_skip_shuffle,
      'now_playing_preserved', v_preserve_now_playing,
      'started_media_item_id', v_started_media_item_id,
      'excluded_unplayable', TRUE
    )
  );

  RETURN QUERY SELECT v_loaded_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.load_playlist(UUID, UUID, INT, BOOLEAN) TO authenticated, service_role;
