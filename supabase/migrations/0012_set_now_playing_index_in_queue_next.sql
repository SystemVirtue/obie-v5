-- Ensure now_playing_index is advanced when normal queue items are played
-- This prevents page reloads from resetting the playlist position to start

CREATE OR REPLACE FUNCTION queue_next(
  p_player_id UUID
)
RETURNS TABLE(media_item_id UUID, title TEXT, url TEXT, duration INT) AS $$
DECLARE
  v_next_queue_item RECORD;
  v_shuffle BOOLEAN;
BEGIN
  -- Acquire lock
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));
  
  -- Check shuffle setting
  SELECT shuffle INTO v_shuffle FROM player_settings WHERE player_id = p_player_id;
  
  -- Get next item (priority first, then normal)
  IF v_shuffle AND EXISTS (SELECT 1 FROM queue WHERE player_id = p_player_id AND type = 'normal' AND played_at IS NULL) THEN
    -- Random from normal queue if shuffle enabled
    SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
    FROM queue q
    WHERE q.player_id = p_player_id 
      AND q.type = 'normal'
      AND q.played_at IS NULL
    ORDER BY RANDOM()
    LIMIT 1;
  ELSE
    -- Priority first, then sequential
    SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
    FROM queue q
    WHERE q.player_id = p_player_id 
      AND q.played_at IS NULL
    ORDER BY 
      CASE WHEN q.type = 'priority' THEN 0 ELSE 1 END,
      q.position ASC
    LIMIT 1;
  END IF;
  
  IF v_next_queue_item IS NULL THEN
    -- No items in queue
    RETURN QUERY
    SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT
    WHERE FALSE;
    RETURN;
  END IF;
  
  -- Mark as played
  UPDATE queue
  SET played_at = NOW()
  WHERE id = v_next_queue_item.id;
  
  -- Update player status and advance now_playing_index for normal queue items
  UPDATE player_status
  SET 
    current_media_id = v_next_queue_item.media_item_id,
    state = 'loading',
    progress = 0,
    now_playing_index = CASE
      WHEN v_next_queue_item.type = 'normal' THEN COALESCE(now_playing_index, 0) + 1
      ELSE now_playing_index
    END,
    last_updated = NOW()
  WHERE player_id = p_player_id;
  
  -- Log event
  PERFORM log_event(p_player_id, 'queue_next', 'info', jsonb_build_object(
    'media_item_id', v_next_queue_item.media_item_id,
    'type', v_next_queue_item.type
  ));
  
  -- Return media details
  RETURN QUERY
  SELECT m.id, m.title, m.url, m.duration
  FROM media_items m
  WHERE m.id = v_next_queue_item.media_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
