-- Fix queue_reorder: use array_position with uuid element type
-- Previous implementation called array_position(p_queue_ids, id::text)
-- which caused: function array_position(uuid[], text) does not exist

CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text DEFAULT 'normal'::text
) RETURNS void AS $$
DECLARE
  v_start_position int;
  v_has_position_zero boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  SELECT EXISTS (
    SELECT 1
    FROM queue
    WHERE player_id = p_player_id
      AND type = p_type
      AND position = 0
      AND id = ANY(p_queue_ids)
  ) INTO v_has_position_zero;

  v_start_position := CASE WHEN v_has_position_zero THEN 0 ELSE 1 END;

  -- Atomic single UPDATE assigning new positions based on the order
  -- of IDs provided in p_queue_ids. Use array_position with UUID
  -- element type (array and element both uuid).
  WITH ordered_items AS (
    SELECT q.id,
      ROW_NUMBER() OVER (ORDER BY array_position(p_queue_ids, q.id)) - 1 AS new_position_offset
    FROM queue q
    WHERE q.player_id = p_player_id
      AND q.type = p_type
      AND q.id = ANY(p_queue_ids)
  )
  UPDATE queue q
  SET position = v_start_position + oi.new_position_offset
  FROM ordered_items oi
  WHERE q.id = oi.id
    AND q.player_id = p_player_id
    AND q.type = p_type;

  PERFORM log_event(p_player_id, 'queue_reorder', 'info', jsonb_build_object(
    'count', array_length(p_queue_ids, 1),
    'start_position', v_start_position,
    'type', p_type
  ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
