-- 0018_fix_queue_reorder_full_update.sql
-- Replace queue_reorder with a robust implementation that computes
-- a canonical final ordering for the given player/type and updates
-- positions in a single atomic statement to avoid unique constraint conflicts.

CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text DEFAULT 'normal'::text
) RETURNS void AS $$
DECLARE
  v_start_position int;
  v_has_position_zero boolean;
  v_count int := coalesce(array_length(p_queue_ids,1), 0);
  v_affected int := 0;
BEGIN
  -- Serialize reorder operations per player
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  -- Detect zero-based positions if any provided id currently lives at 0
  SELECT EXISTS (
    SELECT 1
    FROM queue
    WHERE player_id = p_player_id
      AND type = p_type
      AND position = 0
      AND id = ANY(p_queue_ids)
  ) INTO v_has_position_zero;

  v_start_position := CASE WHEN v_has_position_zero THEN 0 ELSE 1 END;

  -- Build combined ordering: provided ids (in their provided order) first,
  -- then any remaining items for the same player/type in their existing order.
  WITH provided AS (
    SELECT id, ord
    FROM unnest(p_queue_ids) WITH ORDINALITY AS t(id, ord)
    WHERE id IS NOT NULL
  ),
  remaining AS (
    SELECT q.id
    FROM queue q
    WHERE q.player_id = p_player_id
      AND q.type = p_type
      AND (p_queue_ids IS NULL OR NOT (q.id = ANY (p_queue_ids)))
    ORDER BY q.position, q.requested_at NULLS LAST, q.id
  ),
  combined AS (
    SELECT id, ord FROM provided
    UNION ALL
    SELECT id, (v_count + ROW_NUMBER() OVER (ORDER BY (SELECT 1))) AS ord FROM remaining
  ),
  numbered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY ord) - 1 AS new_pos_offset
    FROM combined
  )
  UPDATE queue q
  SET position = v_start_position + n.new_pos_offset
  FROM numbered n
  WHERE q.id = n.id
    AND q.player_id = p_player_id
    AND q.type = p_type;
  -- How many rows were affected by the update
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  PERFORM log_event(p_player_id, 'queue_reorder', 'info', jsonb_build_object(
    'count_provided', v_count,
    'affected_count', v_affected,
    'start_position', v_start_position,
    'type', p_type,
    'provided_ids', to_jsonb(p_queue_ids)
  ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
