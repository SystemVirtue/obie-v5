-- Connected player endpoint roster and master promotion helpers.
-- Adds a real-time visible list of live player endpoints and allows explicit
-- master assignment to a selected connected slave endpoint.

CREATE TABLE IF NOT EXISTS public.player_endpoints (
  endpoint_id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'slave' CHECK (role IN ('master', 'slave')),
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  origin TEXT,
  user_agent TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  identify_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_endpoints_player_id
  ON public.player_endpoints (player_id);

CREATE INDEX IF NOT EXISTS idx_player_endpoints_player_status_last_seen
  ON public.player_endpoints (player_id, status, last_seen DESC);

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS priority_endpoint_id UUID;

COMMENT ON COLUMN public.players.priority_endpoint_id IS
  'Stable connected endpoint id that currently owns master playback responsibilities.';

ALTER TABLE public.player_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read player endpoints" ON public.player_endpoints;
CREATE POLICY "Public read player endpoints"
  ON public.player_endpoints FOR SELECT
  USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.player_endpoints;

CREATE OR REPLACE FUNCTION public.clear_priority_endpoint(
  p_player_id UUID
)
RETURNS JSONB AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_endpoint_master_' || p_player_id::text));

  UPDATE public.player_endpoints
  SET
    role = 'slave',
    updated_at = now()
  WHERE player_id = p_player_id;

  UPDATE public.players
  SET
    priority_player_id = NULL,
    priority_endpoint_id = NULL,
    updated_at = now()
  WHERE id = p_player_id;

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.assign_priority_endpoint(
  p_player_id UUID,
  p_endpoint_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_endpoint public.player_endpoints%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_endpoint_master_' || p_player_id::text));

  SELECT *
  INTO v_endpoint
  FROM public.player_endpoints
  WHERE player_id = p_player_id
    AND endpoint_id = p_endpoint_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'player endpoint % not found for player %', p_endpoint_id, p_player_id;
  END IF;

  IF v_endpoint.status <> 'connected' OR v_endpoint.last_seen < now() - interval '45 seconds' THEN
    RAISE EXCEPTION 'player endpoint % is not currently connected', p_endpoint_id;
  END IF;

  UPDATE public.player_endpoints
  SET
    role = CASE WHEN endpoint_id = p_endpoint_id THEN 'master' ELSE 'slave' END,
    updated_at = now()
  WHERE player_id = p_player_id;

  UPDATE public.players
  SET
    priority_player_id = p_player_id,
    priority_endpoint_id = p_endpoint_id,
    updated_at = now()
  WHERE id = p_player_id;

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'endpoint_id', p_endpoint_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.player_endpoint_heartbeat(
  p_player_id UUID,
  p_endpoint_id UUID,
  p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_priority_endpoint_id UUID;
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

  RETURN jsonb_build_object(
    'success', true,
    'player_id', p_player_id,
    'endpoint_id', p_endpoint_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.clear_priority_endpoint(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_priority_endpoint(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.player_endpoint_heartbeat(UUID, UUID, UUID) TO authenticated, service_role;
