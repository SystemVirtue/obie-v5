-- Make player heartbeat/offline detection more tolerant of transient
-- Edge Function failures and short-lived network interruptions.
-- The player sends heartbeats every 10 seconds; using a 10-second stale
-- threshold means a single missed heartbeat can incorrectly mark the
-- active master offline. Extend the grace period to 30 seconds.

CREATE OR REPLACE FUNCTION player_heartbeat(
  p_player_id UUID
)
RETURNS void AS $$
BEGIN
  UPDATE players
  SET
    status = 'online',
    last_heartbeat = NOW(),
    updated_at = NOW()
  WHERE id = p_player_id;

  -- Mark other players offline only after a more forgiving timeout.
  UPDATE players
  SET status = 'offline'
  WHERE id != p_player_id
    AND status = 'online'
    AND last_heartbeat < NOW() - INTERVAL '30 seconds';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
