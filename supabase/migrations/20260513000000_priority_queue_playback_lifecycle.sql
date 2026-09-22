-- Keep priority/kiosk requests recoverable until playback is confirmed.
--
-- Before this migration, queue_next deleted the selected queue row immediately.
-- If the player failed to start the media, a paid priority request could be
-- consumed with no durable queue row left to retry or audit.

ALTER TABLE public.queue
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_queue_player_reserved
  ON public.queue(player_id, reserved_at)
  WHERE played_at IS NULL AND reserved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_queue_player_failed
  ON public.queue(player_id, failed_at)
  WHERE failed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.confirm_queue_playback(
  p_player_id UUID,
  p_media_item_id UUID
)
RETURNS TABLE(queue_id UUID, queue_type TEXT, requested_by TEXT) AS $$
DECLARE
  v_queue RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  SELECT q.id, q.type, q.requested_by
    INTO v_queue
  FROM public.queue q
  WHERE q.player_id = p_player_id
    AND q.media_item_id = p_media_item_id
    AND q.played_at IS NULL
    AND q.failed_at IS NULL
    AND q.reserved_at IS NOT NULL
  ORDER BY q.reserved_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_queue.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.queue
  SET started_at = COALESCE(started_at, NOW()),
      played_at = COALESCE(played_at, NOW()),
      last_error = NULL,
      last_error_at = NULL
  WHERE id = v_queue.id;

  RETURN QUERY SELECT v_queue.id, v_queue.type, v_queue.requested_by;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.mark_queue_playback_failed(
  p_player_id UUID,
  p_media_item_id UUID,
  p_reason TEXT DEFAULT 'playback_failed'
)
RETURNS TABLE(queue_id UUID, queue_type TEXT, requested_by TEXT, action TEXT, retry_count INT) AS $$
DECLARE
  v_queue RECORD;
  v_next_retry_count INT;
  v_action TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  SELECT q.id, q.type, q.requested_by, q.retry_count
    INTO v_queue
  FROM public.queue q
  WHERE q.player_id = p_player_id
    AND q.media_item_id = p_media_item_id
    AND q.played_at IS NULL
    AND q.failed_at IS NULL
    AND q.reserved_at IS NOT NULL
  ORDER BY q.reserved_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_queue.id IS NULL THEN
    RETURN;
  END IF;

  v_next_retry_count := COALESCE(v_queue.retry_count, 0) + 1;

  IF v_queue.type = 'priority' AND v_next_retry_count <= 1 THEN
    UPDATE public.queue
    SET reserved_at = NULL,
        retry_count = v_next_retry_count,
        last_error = p_reason,
        last_error_at = NOW()
    WHERE id = v_queue.id;
    v_action := 'requeued';
  ELSE
    UPDATE public.queue
    SET failed_at = NOW(),
        played_at = NOW(),
        retry_count = v_next_retry_count,
        last_error = p_reason,
        last_error_at = NOW()
    WHERE id = v_queue.id;
    v_action := 'failed';
  END IF;

  PERFORM log_event(
    p_player_id,
    'queue_playback_failed',
    CASE WHEN v_action = 'requeued' THEN 'warn' ELSE 'error' END,
    jsonb_build_object(
      'queue_id', v_queue.id,
      'media_item_id', p_media_item_id,
      'type', v_queue.type,
      'requested_by', v_queue.requested_by,
      'reason', p_reason,
      'action', v_action,
      'retry_count', v_next_retry_count
    )
  );

  RETURN QUERY SELECT v_queue.id, v_queue.type, v_queue.requested_by, v_action, v_next_retry_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.queue_add(
  p_player_id UUID,
  p_media_item_id UUID,
  p_type TEXT DEFAULT 'normal',
  p_requested_by TEXT DEFAULT 'admin'
)
RETURNS UUID AS $$
DECLARE
  v_queue_id UUID;
  v_next_position INT;
  v_max_size INT;
  v_current_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  SELECT max_queue_size INTO v_max_size
  FROM public.player_settings
  WHERE player_id = p_player_id;

  SELECT COUNT(*) INTO v_current_count
  FROM public.queue
  WHERE player_id = p_player_id
    AND played_at IS NULL
    AND failed_at IS NULL;

  IF v_current_count >= COALESCE(v_max_size, 50) THEN
    RAISE EXCEPTION 'Queue is full (max: %)', COALESCE(v_max_size, 50);
  END IF;

  SELECT COALESCE(MAX(position) + 1, 0) INTO v_next_position
  FROM public.queue
  WHERE player_id = p_player_id
    AND type = p_type
    AND played_at IS NULL
    AND failed_at IS NULL;

  INSERT INTO public.queue (player_id, media_item_id, type, position, requested_by)
  VALUES (p_player_id, p_media_item_id, p_type, v_next_position, p_requested_by)
  RETURNING id INTO v_queue_id;

  PERFORM log_event(p_player_id, 'queue_add', 'info', jsonb_build_object(
    'queue_id', v_queue_id,
    'type', p_type,
    'position', v_next_position,
    'media_item_id', p_media_item_id,
    'requested_by', p_requested_by
  ));

  RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.queue_next(
  p_player_id         UUID,
  p_expected_media_id UUID DEFAULT NULL
)
RETURNS TABLE(media_item_id UUID, title TEXT, url TEXT, duration INT) AS $$
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
    FROM public.player_status ps
    WHERE ps.player_id = p_player_id;

    IF v_current_media_id IS DISTINCT FROM p_expected_media_id THEN
      PERFORM log_event(
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

  -- Recover stale reservations left by a crashed/offline player. Fresh failures
  -- are handled by mark_queue_playback_failed from player-control.
  UPDATE public.queue
  SET reserved_at = NULL,
      retry_count = retry_count + 1,
      last_error = COALESCE(last_error, 'stale_reservation_recovered'),
      last_error_at = NOW()
  WHERE player_id = p_player_id
    AND type = 'priority'
    AND played_at IS NULL
    AND failed_at IS NULL
    AND reserved_at < NOW() - INTERVAL '5 minutes'
    AND retry_count < 1;

  UPDATE public.queue
  SET failed_at = NOW(),
      played_at = NOW(),
      retry_count = retry_count + 1,
      last_error = COALESCE(last_error, 'stale_reservation_failed'),
      last_error_at = NOW()
  WHERE player_id = p_player_id
    AND played_at IS NULL
    AND failed_at IS NULL
    AND reserved_at < NOW() - INTERVAL '5 minutes'
    AND retry_count >= 1;

  LOOP
    v_next_queue_item := NULL;
    v_media := NULL;
    v_youtube_id := NULL;
    v_r2_match := NULL;
    v_playback_url := NULL;

    IF EXISTS (
      SELECT 1 FROM public.queue
      WHERE player_id = p_player_id
        AND type = 'priority'
        AND played_at IS NULL
        AND reserved_at IS NULL
        AND failed_at IS NULL
    ) THEN
      SELECT q.id, q.media_item_id, q.type, q.position, q.requested_by
        INTO v_next_queue_item
      FROM public.queue q
      WHERE q.player_id = p_player_id
        AND q.type = 'priority'
        AND q.played_at IS NULL
        AND q.reserved_at IS NULL
        AND q.failed_at IS NULL
      ORDER BY q.position ASC
      LIMIT 1;
    ELSE
      SELECT q.id, q.media_item_id, q.type, q.position, q.requested_by
        INTO v_next_queue_item
      FROM public.queue q
      WHERE q.player_id = p_player_id
        AND q.type = 'normal'
        AND q.played_at IS NULL
        AND q.reserved_at IS NULL
        AND q.failed_at IS NULL
      ORDER BY q.position ASC
      LIMIT 1;
    END IF;

    IF v_next_queue_item IS NULL THEN
      SELECT ps.loop INTO v_loop
      FROM public.player_settings ps
      WHERE ps.player_id = p_player_id;

      IF v_loop AND v_skipped_count < 200 THEN
        SELECT active_playlist_id INTO v_active_playlist_id
        FROM public.players
        WHERE id = p_player_id;

        IF v_active_playlist_id IS NOT NULL THEN
          SELECT lp.loaded_count INTO v_loaded_count
          FROM load_playlist(p_player_id, v_active_playlist_id, 0, TRUE) lp;

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
      UPDATE public.queue
      SET failed_at = NOW(),
          played_at = NOW(),
          last_error = COALESCE(v_media.youtube_playability_reason, v_media.youtube_playability_status),
          last_error_at = NOW()
      WHERE id = v_next_queue_item.id;
      v_skipped_count := v_skipped_count + 1;

      PERFORM log_event(
        p_player_id,
        'queue_next_skipped_unplayable',
        'warn',
        jsonb_build_object(
          'queue_id', v_next_queue_item.id,
          'media_item_id', v_next_queue_item.media_item_id,
          'youtube_id', v_youtube_id,
          'type', v_next_queue_item.type,
          'requested_by', v_next_queue_item.requested_by,
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

    UPDATE public.queue
    SET reserved_at = NOW(),
        last_error = NULL,
        last_error_at = NULL
    WHERE id = v_next_queue_item.id;

    UPDATE public.player_status
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
        'queue_id', v_next_queue_item.id,
        'media_item_id', v_next_queue_item.media_item_id,
        'type', v_next_queue_item.type,
        'position', v_next_queue_item.position,
        'requested_by', v_next_queue_item.requested_by,
        'source_type', v_media.source_type,
        'playback_source', v_playback_source,
        'playback_url', v_playback_url,
        'youtube_id', v_youtube_id,
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
    FROM public.media_items m
    WHERE m.id = v_next_queue_item.media_item_id;
    RETURN;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.confirm_queue_playback(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_queue_playback_failed(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.queue_add(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.queue_next(UUID, UUID) TO authenticated, service_role;

ALTER FUNCTION public.confirm_queue_playback(UUID, UUID) SET search_path = public;
ALTER FUNCTION public.mark_queue_playback_failed(UUID, UUID, TEXT) SET search_path = public;
ALTER FUNCTION public.queue_add(UUID, UUID, TEXT, TEXT) SET search_path = public;
ALTER FUNCTION public.queue_next(UUID, UUID) SET search_path = public;
