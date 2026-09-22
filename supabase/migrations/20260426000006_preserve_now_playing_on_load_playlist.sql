-- Preserve the currently playing media when a playlist is loaded.
--
-- With the delete-based queue_next flow, the actively playing normal track is
-- often no longer present in `queue`. Older load_playlist variants inferred
-- "busy vs idle" by joining player_status.current_media_id back to a queue row.
-- That now fails, causing playlist loads to overwrite player_status and start
-- the first song immediately.
--
-- Fix:
-- - treat player_status.current_media_id + state as the source of truth
-- - when something is already playing/paused/loading, preserve it
-- - load the new playlist into queue positions 1..N (reserving 0 conceptually
--   for the current song) unless an existing queue row already occupies the
--   now-playing position

CREATE OR REPLACE FUNCTION load_playlist(
  p_player_id    UUID,
  p_playlist_id  UUID,
  p_start_index  INT     DEFAULT 0,
  p_skip_shuffle BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(loaded_count INT) AS $$
DECLARE
  v_loaded_count          INT := 0;
  v_shuffle               BOOLEAN;
  v_current_normal_id     UUID;
  v_current_normal_pos    INT;
  v_priority_is_playing   BOOLEAN := FALSE;
  v_insert_start_pos      INT;
  v_current_media_id      UUID;
  v_current_state         TEXT;
  v_preserve_now_playing  BOOLEAN := FALSE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  SELECT shuffle INTO v_shuffle
  FROM   player_settings
  WHERE  player_id = p_player_id;

  SELECT current_media_id, state
    INTO v_current_media_id, v_current_state
  FROM   player_status
  WHERE  player_id = p_player_id;

  -- If the current media still has a normal queue row, keep its position.
  SELECT q.id, q.position
    INTO v_current_normal_id, v_current_normal_pos
  FROM   queue q
  WHERE  q.player_id = p_player_id
    AND  q.type      = 'normal'
    AND  q.media_item_id = v_current_media_id
  LIMIT  1;

  -- Check whether a priority item is currently playing.
  SELECT EXISTS (
    SELECT 1
    FROM   queue q
    WHERE  q.player_id = p_player_id
      AND  q.type      = 'priority'
      AND  q.media_item_id = v_current_media_id
  ) INTO v_priority_is_playing;

  -- Current playback should be preserved whenever player_status says a track is
  -- active, even if the active normal song no longer exists as a queue row.
  v_preserve_now_playing := (
    v_current_media_id IS NOT NULL
    AND v_current_state IN ('playing', 'paused', 'loading')
  ) OR v_priority_is_playing;

  -- Clear the normal queue, keeping only the now-playing normal row if one
  -- still exists.
  DELETE FROM queue
  WHERE  player_id = p_player_id
    AND  type      = 'normal'
    AND  (v_current_normal_id IS NULL OR id != v_current_normal_id);

  -- Insert immediately after now playing when busy; otherwise start at 0.
  v_insert_start_pos := CASE
    WHEN v_current_normal_id IS NOT NULL THEN v_current_normal_pos + 1
    WHEN v_preserve_now_playing          THEN 1
    ELSE 0
  END;

  INSERT INTO queue (player_id, type, media_item_id, position, requested_by)
  SELECT
    p_player_id,
    'normal',
    pi.media_item_id,
    v_insert_start_pos + (ROW_NUMBER() OVER (ORDER BY pi.position) - 1),
    'playlist'
  FROM   playlist_items pi
  WHERE  pi.playlist_id = p_playlist_id
  ORDER  BY pi.position;

  GET DIAGNOSTICS v_loaded_count = ROW_COUNT;

  UPDATE players
  SET    active_playlist_id = p_playlist_id,
         updated_at         = NOW()
  WHERE  id = p_player_id;

  -- Only update player_status when nothing is currently active.
  IF NOT v_preserve_now_playing THEN
    IF v_loaded_count > 0
       OR EXISTS (
         SELECT 1 FROM queue
         WHERE  player_id = p_player_id AND type = 'priority' AND played_at IS NULL
       )
    THEN
      UPDATE player_status
      SET
        current_media_id = (
          SELECT media_item_id
          FROM   queue
          WHERE  player_id = p_player_id
            AND  played_at IS NULL
          ORDER  BY CASE WHEN type = 'priority' THEN 0 ELSE 1 END,
                    position ASC
          LIMIT  1
        ),
        state             = 'loading',
        progress          = 0,
        now_playing_index = p_start_index,
        last_updated      = NOW()
      WHERE player_id = p_player_id;
    END IF;
  END IF;

  IF v_shuffle AND v_loaded_count > 1 AND NOT p_skip_shuffle THEN
    PERFORM queue_shuffle(p_player_id, 'normal');
  END IF;

  PERFORM log_event(
    p_player_id,
    'playlist_loaded',
    'info',
    jsonb_build_object(
      'playlist_id',           p_playlist_id,
      'start_index',           p_start_index,
      'loaded_count',          v_loaded_count,
      'shuffled',              v_shuffle AND v_loaded_count > 1 AND NOT p_skip_shuffle,
      'now_playing_preserved', v_preserve_now_playing
    )
  );

  RETURN QUERY SELECT v_loaded_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION load_playlist(UUID, UUID, INT, BOOLEAN) TO authenticated, service_role;
