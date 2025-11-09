-- Clean up all queue_reorder(uuid, uuid[], text) duplicates and re-create the correct forwarder
DROP FUNCTION IF EXISTS queue_reorder(uuid, uuid[], text);

CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text DEFAULT 'normal'::text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM queue_reorder(p_player_id, p_queue_ids, p_type, 0);
END;
$$;
