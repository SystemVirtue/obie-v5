-- Fix queue_reorder to handle currently playing song
-- When reordering, if items don't include position 0, start from position 1

CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id UUID,
  p_queue_ids UUID[],
  p_type TEXT DEFAULT 'normal'
)
RETURNS void AS $$
DECLARE
  v_start_position INT;
  v_has_position_zero BOOLEAN;
BEGIN
  -- Acquire lock
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));
  
  -- Check if any item in the reorder list is currently at position 0
  SELECT EXISTS (
    SELECT 1 
    FROM queue 
    WHERE player_id = p_player_id 
      AND type = p_type 
      AND position = 0 
      AND id = ANY(p_queue_ids)
  ) INTO v_has_position_zero;
  
  -- If position 0 is not being reordered (currently playing), start from 1
  v_start_position := CASE WHEN v_has_position_zero THEN 0 ELSE 1 END;
  
  -- Step 1: Set positions to negative values to avoid conflicts
  UPDATE queue
  SET position = -position - 1000
  WHERE player_id = p_player_id 
    AND type = p_type
    AND id = ANY(p_queue_ids);
  
  -- Step 2: Update to final positions in a single statement
  WITH new_positions AS (
    SELECT 
      unnest(p_queue_ids) AS queue_id,
      generate_series(v_start_position, v_start_position + array_length(p_queue_ids, 1) - 1) AS new_position
  )
  UPDATE queue q
  SET position = np.new_position
  FROM new_positions np
  WHERE q.id = np.queue_id 
    AND q.player_id = p_player_id 
    AND q.type = p_type;
  
  -- Log event
  PERFORM log_event(p_player_id, 'queue_reorder', 'info', jsonb_build_object('count', array_length(p_queue_ids, 1), 'start_position', v_start_position));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
