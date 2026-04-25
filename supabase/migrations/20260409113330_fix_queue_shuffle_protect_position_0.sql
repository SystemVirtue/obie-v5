
CREATE OR REPLACE FUNCTION queue_shuffle(
  p_player_id UUID,
  p_type      TEXT DEFAULT 'normal'
)
RETURNS void AS $$
DECLARE
  v_position_0_id    UUID;
  v_orig_positions   INT[];
  v_shuffled_ids       UUID[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  SELECT q.id INTO v_position_0_id
  FROM   queue q
  WHERE  q.player_id = p_player_id
    AND  q.type      = p_type
    AND  q.position  = 0
  LIMIT  1;

  SELECT
    array_agg(position ORDER BY position),
    array_agg(id       ORDER BY RANDOM())
  INTO v_orig_positions, v_shuffled_ids
  FROM queue
  WHERE player_id = p_player_id
    AND type      = p_type
    AND position  >= 1;

  IF v_orig_positions IS NULL OR array_length(v_orig_positions, 1) < 2 THEN
    RETURN;
  END IF;

  UPDATE queue q
  SET    position = temp.neg_pos
  FROM (
    SELECT id,
           (-ROW_NUMBER() OVER (ORDER BY id))::int AS neg_pos
    FROM   queue
    WHERE  player_id = p_player_id
      AND  type      = p_type
      AND  position  >= 1
  ) temp
  WHERE q.id = temp.id;

  UPDATE queue q
  SET    position = t.new_pos
  FROM   unnest(v_shuffled_ids, v_orig_positions) AS t(item_id, new_pos)
  WHERE  q.id = t.item_id;

  PERFORM log_event(
    p_player_id,
    'queue_shuffle',
    'info',
    jsonb_build_object(
      'type',               p_type,
      'position_0_protected', v_position_0_id IS NOT NULL,
      'shuffled_count',   array_length(v_shuffled_ids, 1)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION queue_shuffle(UUID, TEXT) TO authenticated, service_role;
;
