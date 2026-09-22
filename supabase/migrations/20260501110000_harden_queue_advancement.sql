-- Harden queue advancement against stale playback state, legacy queue rows,
-- and stale master endpoints.

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

  IF EXISTS (
    SELECT 1 FROM public.queue
    WHERE player_id = p_player_id
      AND type = 'priority'
      AND played_at IS NULL
  ) THEN
    SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
    FROM public.queue q
    WHERE q.player_id = p_player_id
      AND q.type = 'priority'
      AND q.played_at IS NULL
    ORDER BY q.position ASC
    LIMIT 1;
  ELSE
    SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
    FROM public.queue q
    WHERE q.player_id = p_player_id
      AND q.type = 'normal'
      AND q.played_at IS NULL
    ORDER BY q.position ASC
    LIMIT 1;
  END IF;

  IF v_next_queue_item IS NULL THEN
    SELECT ps.loop INTO v_loop
    FROM public.player_settings ps
    WHERE ps.player_id = p_player_id;

    IF v_loop THEN
      SELECT active_playlist_id INTO v_active_playlist_id
      FROM public.players
      WHERE id = p_player_id;

      IF v_active_playlist_id IS NOT NULL THEN
        SELECT lp.loaded_count INTO v_loaded_count
        FROM public.load_playlist(p_player_id, v_active_playlist_id, 0, TRUE) lp;

        IF v_loaded_count > 0 THEN
          SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
          FROM public.queue q
          WHERE q.player_id = p_player_id
            AND q.type = 'normal'
            AND q.played_at IS NULL
          ORDER BY q.position ASC
          LIMIT 1;
        END IF;
      END IF;
    END IF;

    IF v_next_queue_item IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
      RETURN;
    END IF;
  END IF;

  DELETE FROM public.queue WHERE id = v_next_queue_item.id;

  SELECT m.id, m.source_id, m.source_type, m.url, m.title, m.duration
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

  UPDATE public.player_status
  SET
    current_media_id = v_next_queue_item.media_item_id,
    state = 'loading',
    progress = 0,
    now_playing_index = CASE
      WHEN v_next_queue_item.type = 'normal' THEN COALESCE(now_playing_index, 0) + 1
      ELSE now_playing_index
    END,
    source = v_playback_source,
    local_url = CASE
      WHEN v_playback_source = 'cloudflare' THEN v_playback_url
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
      'youtube_id', v_youtube_id
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.queue_next(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.player_endpoint_heartbeat(
  p_player_id UUID,
  p_endpoint_id UUID,
  p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_priority_endpoint_id UUID;
  v_promoted_endpoint_id UUID;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.player_endpoint_heartbeat(UUID, UUID, UUID) TO authenticated, service_role;
