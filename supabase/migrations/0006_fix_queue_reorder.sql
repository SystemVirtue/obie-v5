-- Improved queue_reorder: Update positions using two-step approach to avoid conflicts
-- Step 1: Set all positions to negative values (temporary)
-- Step 2: Update to final positions atomically
-- This prevents unique constraint violations and reduces WebSocket notifications

CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id UUID,
  p_queue_ids UUID[],
  p_type TEXT DEFAULT 'normal'
)
RETURNS void AS $$
BEGIN
  -- Acquire lock
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));
  
  -- Step 1: Set positions to negative values to avoid conflicts
  UPDATE queue
  SET position = -position - 1
  WHERE player_id = p_player_id 
    AND type = p_type
    AND id = ANY(p_queue_ids);
  
  -- Step 2: Update to final positions in a single statement
  WITH new_positions AS (
    SELECT 
      unnest(p_queue_ids) AS queue_id,
      generate_series(0, array_length(p_queue_ids, 1) - 1) AS new_position
  )
  UPDATE queue q
  SET position = np.new_position
  FROM new_positions np
  WHERE q.id = np.queue_id 
    AND q.player_id = p_player_id 
    AND q.type = p_type;
  
  -- Log event
  PERFORM log_event(p_player_id, 'queue_reorder', 'info', jsonb_build_object('count', array_length(p_queue_ids, 1)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
