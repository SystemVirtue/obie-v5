-- Queue engine hardening.
--
-- Production invariants:
-- - player_status.current_media_id is the only now-playing pointer.
-- - queue contains future playable items only.
-- - queue_next is the only path that promotes a future queue row to now-playing.
-- - every promotion recomputes source/local_url and clears stale playback flags.

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
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
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

    DELETE FROM public.queue
    WHERE id = v_next_queue_item.id;

    UPDATE public.player_status
    SET
      current_media_id = v_next_queue_item.media_item_id,
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
        'media_item_id', v_next_queue_item.media_item_id,
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
    WHERE m.id = v_next_queue_item.media_item_id;
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
      'started_media_item_id', v_started_media_item_id
    )
  );

  RETURN QUERY SELECT v_loaded_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.load_playlist(UUID, UUID, INT, BOOLEAN) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.player_endpoint_heartbeat(
  p_player_id UUID,
  p_endpoint_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_priority_endpoint_id UUID;
  v_promoted_endpoint_id UUID;
  v_current_session_id UUID;
BEGIN
  SELECT pe.session_id
    INTO v_current_session_id
  FROM public.player_endpoints pe
  WHERE pe.player_id = p_player_id
    AND pe.endpoint_id = p_endpoint_id;

  IF v_current_session_id IS NOT NULL AND v_current_session_id <> p_session_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'ignored', true,
      'reason', 'stale_session',
      'player_id', p_player_id,
      'endpoint_id', p_endpoint_id
    );
  END IF;

  UPDATE public.player_endpoints
  SET
    session_id = p_session_id,
    status = 'connected',
    last_seen = now(),
    disconnected_at = NULL,
    updated_at = now()
  WHERE player_id = p_player_id
    AND endpoint_id = p_endpoint_id;

  UPDATE public.player_endpoints
  SET
    status = 'disconnected',
    role = 'slave',
    disconnected_at = COALESCE(disconnected_at, now()),
    updated_at = now()
  WHERE player_id = p_player_id
    AND endpoint_id <> p_endpoint_id
    AND status = 'connected'
    AND last_seen < now() - interval '45 seconds';

  SELECT priority_endpoint_id
    INTO v_priority_endpoint_id
  FROM public.players
  WHERE id = p_player_id;

  IF v_priority_endpoint_id = p_endpoint_id THEN
    PERFORM public.player_heartbeat(p_player_id);
  ELSIF v_priority_endpoint_id IS NOT NULL THEN
    UPDATE public.player_endpoints
    SET
      role = 'slave',
      updated_at = now()
    WHERE player_id = p_player_id
      AND endpoint_id = v_priority_endpoint_id
      AND (status <> 'connected' OR last_seen < now() - interval '45 seconds');

    UPDATE public.players
    SET
      priority_player_id = NULL,
      priority_endpoint_id = NULL,
      updated_at = now()
    WHERE id = p_player_id
      AND priority_endpoint_id = v_priority_endpoint_id
      AND EXISTS (
        SELECT 1
        FROM public.player_endpoints pe
        WHERE pe.player_id = p_player_id
          AND pe.endpoint_id = v_priority_endpoint_id
          AND (pe.status <> 'connected' OR pe.last_seen < now() - interval '45 seconds')
      );
  END IF;

  SELECT priority_endpoint_id
    INTO v_priority_endpoint_id
  FROM public.players
  WHERE id = p_player_id;

  IF v_priority_endpoint_id IS NULL THEN
    SELECT endpoint_id
      INTO v_promoted_endpoint_id
    FROM public.player_endpoints
    WHERE player_id = p_player_id
      AND status = 'connected'
      AND last_seen >= now() - interval '45 seconds'
    ORDER BY
      CASE WHEN endpoint_id = p_endpoint_id THEN 0 ELSE 1 END,
      last_seen DESC
    LIMIT 1;

    IF v_promoted_endpoint_id IS NOT NULL THEN
      PERFORM public.assign_priority_endpoint(p_player_id, v_promoted_endpoint_id);
      IF v_promoted_endpoint_id = p_endpoint_id THEN
        PERFORM public.player_heartbeat(p_player_id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'endpoint_id', p_endpoint_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.player_endpoint_heartbeat(UUID, UUID, UUID) TO authenticated, service_role;
