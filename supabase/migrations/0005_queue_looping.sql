-- Queue Looping: Played songs from normal queue go to the end
-- Priority queue songs are deleted after playing

CREATE OR REPLACE FUNCTION queue_next(
  p_player_id UUID
)
RETURNS TABLE(media_item_id UUID, title TEXT, url TEXT, duration INT) AS $$
DECLARE
  v_next_queue_item RECORD;
  v_shuffle BOOLEAN;
  v_max_position INT;
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
    -- No items in queue - reset all played_at for normal queue to loop
    UPDATE queue
    SET played_at = NULL
    WHERE player_id = p_player_id 
      AND type = 'normal';
    
    -- Try again to get next item
    IF v_shuffle THEN
      SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
      FROM queue q
      WHERE q.player_id = p_player_id 
        AND q.type = 'normal'
      ORDER BY RANDOM()
      LIMIT 1;
    ELSE
      SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
      FROM queue q
      WHERE q.player_id = p_player_id 
        AND q.type = 'normal'
      ORDER BY q.position ASC
      LIMIT 1;
    END IF;
    
    -- If still no items, return empty
    IF v_next_queue_item IS NULL THEN
      RETURN QUERY
      SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT
      WHERE FALSE;
      RETURN;
    END IF;
  END IF;
  
  -- Handle played item based on type
  IF v_next_queue_item.type = 'priority' THEN
    -- Priority queue: delete after playing
    DELETE FROM queue WHERE id = v_next_queue_item.id;
  ELSE
    -- Normal queue: mark as played (will be reset when queue loops)
    UPDATE queue
    SET played_at = NOW()
    WHERE id = v_next_queue_item.id;
  END IF;
  
  -- Update player status
  UPDATE player_status
  SET 
    current_media_id = v_next_queue_item.media_item_id,
    state = 'loading',
    progress = 0,
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
