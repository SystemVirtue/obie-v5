-- Robust queue_reorder: compute full final ordering and update all positions atomically
-- This avoids any collisions by updating every relevant row in a single UPDATE

CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text DEFAULT 'normal'::text
) RETURNS void AS $$
DECLARE
  v_start_position int;
  v_playing_id uuid;
  v_has_playing boolean;
  v_remaining_ids uuid[];
  v_combined_ids uuid[];
  v_count int;
  v_max_position int;
  v_temp_offset int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  -- Detect if there is a currently-playing item at position 0
  SELECT id INTO v_playing_id
  FROM queue
  WHERE player_id = p_player_id
    AND type = p_type
    AND position = 0
  LIMIT 1;

  v_has_playing := v_playing_id IS NOT NULL;

  -- Determine start position
  v_start_position := CASE WHEN v_has_playing THEN 0 ELSE 1 END;

  -- Build remaining ids: all queue ids for this player/type not included in p_queue_ids and not the playing id
  SELECT COALESCE(array_agg(id ORDER BY position), ARRAY[]::uuid[]) INTO v_remaining_ids
  FROM queue
  WHERE player_id = p_player_id
    AND type = p_type
    AND (NOT (id = ANY(p_queue_ids)))
    AND (NOT (v_has_playing AND id = v_playing_id));

  -- Build the full combined array: playing id (if exists and not in p_queue_ids) + p_queue_ids + remaining_ids
  IF v_has_playing AND NOT (v_playing_id = ANY(p_queue_ids)) THEN
    v_combined_ids := array_cat(ARRAY[v_playing_id], array_cat(COALESCE(p_queue_ids, ARRAY[]::uuid[]), v_remaining_ids));
  ELSE
    v_combined_ids := array_cat(COALESCE(p_queue_ids, ARRAY[]::uuid[]), v_remaining_ids);
  END IF;

  -- Ensure combined is not null
  IF v_combined_ids IS NULL THEN
    v_combined_ids := ARRAY[]::uuid[];
  END IF;

  v_count := array_length(v_combined_ids, 1);
  IF v_count IS NULL OR v_count = 0 THEN
    RETURN; -- nothing to do
  END IF;

  -- To avoid unique-constraint collisions during the positional update we
  -- perform a two-phase update: first write temporary positions offset by a
  -- large number, then subtract the offset to set the final positions. The
  -- offset is computed from the current max position so it's safe.
  SELECT COALESCE(MAX(position), 0) INTO v_max_position
  FROM queue
  WHERE player_id = p_player_id AND type = p_type AND played_at IS NULL;

  v_temp_offset := v_max_position + v_count + 1000;

  WITH new_positions AS (
    SELECT unnest(v_combined_ids) AS queue_id,
           generate_series(v_start_position, v_start_position + v_count - 1) AS new_position
  )
  -- Phase 1: write to temporary high positions
  UPDATE queue q
  SET position = np.new_position + v_temp_offset
  FROM new_positions np
  WHERE q.id = np.queue_id
    AND q.player_id = p_player_id
    AND q.type = p_type
    AND q.played_at IS NULL;

  -- Phase 2: shift back into final positions
  UPDATE queue
  SET position = position - v_temp_offset
  WHERE player_id = p_player_id
    AND type = p_type
    AND played_at IS NULL
    AND position > v_temp_offset - 1; -- only touch the temporary positions we set

  PERFORM log_event(p_player_id, 'queue_reorder', 'info', jsonb_build_object('count', v_count, 'start_position', v_start_position));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
