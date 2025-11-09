-- Update queue_reorder_wrapper to set now_playing_index to -1 after reordering
-- so that the first song in the reordered queue plays next

CREATE OR REPLACE FUNCTION queue_reorder_wrapper(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text DEFAULT 'normal'::text
) RETURNS void AS $$
BEGIN
  -- Call the canonical queue_reorder implementation. If you later replace
  -- queue_reorder or add overloads, keep this wrapper pointing to the
  -- desired implementation.
  PERFORM queue_reorder(p_player_id => p_player_id, p_queue_ids => p_queue_ids, p_type => p_type);

  -- After reordering, reset now_playing_index to -1 so the first song in the reordered queue plays next
  UPDATE player_status
  SET now_playing_index = -1
  WHERE player_id = p_player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;