-- Ensure no ambiguity: remove default from 4-arg version, keep default only on 3-arg version
DROP FUNCTION IF EXISTS queue_reorder(uuid, uuid[], text, integer);

-- Re-create the 4-argument implementation WITHOUT any default values
CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text,
  p_start_position integer
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Your actual implementation here
  -- ...
END;
$$;

-- Re-create the 3-argument forwarder (with default for p_type)
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
