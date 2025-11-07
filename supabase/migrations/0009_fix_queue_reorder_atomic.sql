-- Fix queue reorder to use atomic single-step update
-- Previous two-step approach caused conflicts with large queues
-- New approach uses ROW_NUMBER() to assign positions in a single UPDATE

CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id UUID,
  p_queue_ids UUID[],
  p_type TEXT DEFAULT 'normal'::text
) RETURNS void AS $$
DECLARE
  v_start_position INT;
  v_has_position_zero BOOLEAN;
BEGIN
  -- Acquire lock to prevent concurrent modifications
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

  -- For reorder operations, start positions appropriately
  -- If position 0 is being reordered, start from 0; otherwise start from 1
  v_start_position := CASE WHEN v_has_position_zero THEN 0 ELSE 1 END;

  -- Single atomic update using window function to assign new positions
  -- This avoids the two-step approach that could cause conflicts
  WITH ordered_items AS (
    SELECT
      id,
      ROW_NUMBER() OVER (ORDER BY array_position(p_queue_ids, id::text)) - 1 AS new_position_offset
    FROM queue
    WHERE player_id = p_player_id
      AND type = p_type
      AND id = ANY(p_queue_ids)
  )
  UPDATE queue q
  SET position = v_start_position + oi.new_position_offset
  FROM ordered_items oi
  WHERE q.id = oi.id
    AND q.player_id = p_player_id
    AND q.type = p_type;

  -- Log event
  PERFORM log_event(p_player_id, 'queue_reorder', 'info', jsonb_build_object(
    'count', array_length(p_queue_ids, 1),
    'start_position', v_start_position,
    'type', p_type
  ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;