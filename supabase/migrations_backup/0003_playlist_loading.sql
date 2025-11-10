-- Add function to load playlist and set as active
-- This function loads a playlist into the player's queue for continuous playback

-- Function to load playlist into queue
CREATE OR REPLACE FUNCTION load_playlist(
  p_player_id UUID,
  p_playlist_id UUID,
  p_start_index INT DEFAULT 0
)
RETURNS TABLE(loaded_count INT) AS $$
DECLARE
  v_loaded_count INT := 0;
  v_item RECORD;
  v_position INT := 0;
BEGIN
  -- Acquire lock
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));
  
  -- Clear existing normal queue (keep priority queue)
  DELETE FROM queue 
  WHERE player_id = p_player_id 
    AND type = 'normal';
  
  -- Load playlist items starting from start_index
  FOR v_item IN 
    SELECT 
      pi.media_item_id,
      pi.position as original_position
    FROM playlist_items pi
    WHERE pi.playlist_id = p_playlist_id
    ORDER BY 
      -- Start from start_index, wrap around
      (pi.position + (SELECT MAX(position) + 1 FROM playlist_items WHERE playlist_id = p_playlist_id) - p_start_index) 
      % (SELECT MAX(position) + 1 FROM playlist_items WHERE playlist_id = p_playlist_id)
  LOOP
    INSERT INTO queue (player_id, type, media_item_id, position, requested_by)
    VALUES (p_player_id, 'normal', v_item.media_item_id, v_position, 'playlist');
    
    v_position := v_position + 1;
    v_loaded_count := v_loaded_count + 1;
  END LOOP;
  
  -- Update player's active playlist
  UPDATE players
  SET 
    active_playlist_id = p_playlist_id,
    updated_at = NOW()
  WHERE id = p_player_id;
  
  -- If queue has items, set first as current (priority first, then normal)
  IF v_loaded_count > 0 OR EXISTS (SELECT 1 FROM queue WHERE player_id = p_player_id AND type = 'priority' AND played_at IS NULL) THEN
    UPDATE player_status ps
    SET 
      current_media_id = (
        SELECT media_item_id 
        FROM queue 
        WHERE player_id = p_player_id 
          AND played_at IS NULL 
        ORDER BY 
          CASE WHEN type = 'priority' THEN 0 ELSE 1 END,
          position ASC
        LIMIT 1
      ),
      state = 'loading',
      progress = 0,
      now_playing_index = CASE 
        WHEN EXISTS (SELECT 1 FROM queue WHERE player_id = p_player_id AND type = 'priority' AND played_at IS NULL) THEN now_playing_index
        ELSE p_start_index
      END,
      last_updated = NOW()
    WHERE ps.player_id = p_player_id;
  END IF;
  
  -- Log event
  PERFORM log_event(p_player_id, 'playlist_loaded', 'info', jsonb_build_object(
    'playlist_id', p_playlist_id,
    'start_index', p_start_index,
    'loaded_count', v_loaded_count
  ));
  
  RETURN QUERY SELECT v_loaded_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get or create default playlist for a player
CREATE OR REPLACE FUNCTION get_default_playlist(
  p_player_id UUID
)
RETURNS TABLE(playlist_id UUID, playlist_name TEXT) AS $$
DECLARE
  v_playlist_id UUID;
  v_playlist_name TEXT;
BEGIN
  -- First, check if player has an active playlist set
  SELECT active_playlist_id INTO v_playlist_id
  FROM players
  WHERE id = p_player_id;
  
  -- If active playlist exists and is valid, return it
  IF v_playlist_id IS NOT NULL THEN
    SELECT id, name INTO v_playlist_id, v_playlist_name
    FROM playlists
    WHERE id = v_playlist_id;
    
    IF FOUND THEN
      RETURN QUERY SELECT v_playlist_id, v_playlist_name;
      RETURN;
    END IF;
  END IF;
  
  -- Try to find "Obie Playlist" as default
  SELECT id, name INTO v_playlist_id, v_playlist_name
  FROM playlists
  WHERE name = 'Obie Playlist'
  LIMIT 1;
  
  IF FOUND THEN
    RETURN QUERY SELECT v_playlist_id, v_playlist_name;
    RETURN;
  END IF;
  
  -- Fall back to any playlist with items
  SELECT p.id, p.name INTO v_playlist_id, v_playlist_name
  FROM playlists p
  WHERE EXISTS (
    SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = p.id
  )
  ORDER BY p.created_at DESC
  LIMIT 1;
  
  IF FOUND THEN
    RETURN QUERY SELECT v_playlist_id, v_playlist_name;
  ELSE
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT
    WHERE FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to initialize player with default playlist
CREATE OR REPLACE FUNCTION initialize_player_playlist(
  p_player_id UUID
)
RETURNS TABLE(success BOOLEAN, playlist_id UUID, playlist_name TEXT, loaded_count INT) AS $$
DECLARE
  v_playlist RECORD;
  v_current_index INT := 0;
  v_loaded_count INT := 0;
BEGIN
  -- Get player's current index if resuming
  SELECT COALESCE(now_playing_index, 0) INTO v_current_index
  FROM player_status
  WHERE player_id = p_player_id;
  
  -- Get default playlist
  SELECT * INTO v_playlist
  FROM get_default_playlist(p_player_id);
  
  IF v_playlist.playlist_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0;
    RETURN;
  END IF;
  
  -- Load the playlist
  SELECT lp.loaded_count INTO v_loaded_count
  FROM load_playlist(p_player_id, v_playlist.playlist_id, v_current_index) lp;
  
  RETURN QUERY SELECT TRUE, v_playlist.playlist_id, v_playlist.playlist_name, v_loaded_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
