CREATE OR REPLACE FUNCTION public.queue_reorder_wrapper(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text DEFAULT 'normal'::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM queue_reorder(p_player_id => p_player_id, p_queue_ids => p_queue_ids, p_type => p_type);
END;
$$;
