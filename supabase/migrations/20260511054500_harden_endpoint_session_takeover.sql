-- Harden endpoint session ownership after the queue engine deploy.
--
-- A healthy endpoint should keep its session authoritative. A stale endpoint
-- should be able to reconnect with a new browser session using the same stable
-- endpoint_id, otherwise a production screen can get stuck as disconnected
-- until somebody physically refreshes storage at the device.

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
  v_current_last_seen TIMESTAMPTZ;
  v_current_status TEXT;
  v_session_is_fresh BOOLEAN := FALSE;
BEGIN
  SELECT pe.session_id, pe.last_seen, pe.status
    INTO v_current_session_id, v_current_last_seen, v_current_status
  FROM public.player_endpoints pe
  WHERE pe.player_id = p_player_id
    AND pe.endpoint_id = p_endpoint_id;

  IF v_current_session_id IS NOT NULL AND v_current_session_id <> p_session_id THEN
    v_session_is_fresh := (
      v_current_status = 'connected'
      AND v_current_last_seen >= now() - interval '45 seconds'
    );

    IF v_session_is_fresh THEN
      RETURN jsonb_build_object(
        'success', false,
        'ignored', true,
        'reason', 'stale_session',
        'player_id', p_player_id,
        'endpoint_id', p_endpoint_id
      );
    END IF;

    PERFORM public.log_event(
      p_player_id,
      'endpoint_session_takeover',
      'warn',
      jsonb_build_object(
        'endpoint_id', p_endpoint_id,
        'previous_session_id', v_current_session_id,
        'next_session_id', p_session_id,
        'previous_last_seen', v_current_last_seen,
        'previous_status', v_current_status
      )
    );
  END IF;

  INSERT INTO public.player_endpoints (
    endpoint_id,
    player_id,
    session_id,
    role,
    status,
    last_seen,
    connected_at,
    disconnected_at,
    updated_at
  )
  VALUES (
    p_endpoint_id,
    p_player_id,
    p_session_id,
    'slave',
    'connected',
    now(),
    now(),
    NULL,
    now()
  )
  ON CONFLICT (endpoint_id) DO UPDATE
  SET
    player_id = EXCLUDED.player_id,
    session_id = EXCLUDED.session_id,
    status = 'connected',
    last_seen = now(),
    disconnected_at = NULL,
    updated_at = now();

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
