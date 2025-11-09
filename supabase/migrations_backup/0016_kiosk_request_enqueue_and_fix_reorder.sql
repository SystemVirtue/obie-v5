-- 0016_kiosk_request_enqueue_and_fix_reorder.sql
-- Add an atomic RPC to debit kiosk session credits and enqueue a priority request.
-- Also replace queue_reorder with a robust UUID-aware, single-update implementation to avoid unique constraint conflicts.

-- 1) Atomic kiosk request enqueue
CREATE OR REPLACE FUNCTION kiosk_request_enqueue(
  p_session_id UUID,
  p_media_item_id UUID
) RETURNS UUID AS $$
DECLARE
  v_player_id UUID;
  v_credits INT;
  v_coin_per_song INT := 1;
  v_freeplay BOOLEAN := false;
  v_queue_id UUID;
BEGIN
  -- Lock the kiosk session row to prevent races
  SELECT player_id, credits
  INTO v_player_id, v_credits
  FROM kiosk_sessions
  WHERE session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  -- Load player settings
  SELECT freeplay, coin_per_song
  INTO v_freeplay, v_coin_per_song
  FROM player_settings
  WHERE player_id = v_player_id;

  IF v_freeplay IS NULL THEN
    v_freeplay := false;
  END IF;

  IF v_coin_per_song IS NULL THEN
    v_coin_per_song := 1;
  END IF;

  -- Deduct credits only when not freeplay
  IF NOT v_freeplay THEN
    IF v_credits < v_coin_per_song THEN
      RAISE EXCEPTION 'Insufficient credits';
    END IF;

    UPDATE kiosk_sessions
    SET credits = credits - v_coin_per_song
    WHERE session_id = p_session_id;
  END IF;

  -- Enqueue as priority (uses existing queue_add RPC which handles locks/limits)
  v_queue_id := queue_add(v_player_id, p_media_item_id, 'priority', p_session_id::text);

  PERFORM log_event(v_player_id, 'kiosk_request_enqueue', 'info', jsonb_build_object('session_id', p_session_id, 'media_item_id', p_media_item_id, 'queue_id', v_queue_id));

  RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2) Robust queue_reorder using UUID-aware array_position and a single UPDATE
CREATE OR REPLACE FUNCTION queue_reorder(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text DEFAULT 'normal'::text
) RETURNS void AS $$
DECLARE
  v_start_position int;
  v_has_position_zero boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  SELECT EXISTS (
    SELECT 1
    FROM queue
    WHERE player_id = p_player_id
      AND type = p_type
      AND position = 0
      AND id = ANY(p_queue_ids)
  ) INTO v_has_position_zero;

  v_start_position := CASE WHEN v_has_position_zero THEN 0 ELSE 1 END;

  WITH ordered_items AS (
    SELECT q.id,
      ROW_NUMBER() OVER (ORDER BY array_position(p_queue_ids, q.id)) - 1 AS new_position_offset
    FROM queue q
    WHERE q.player_id = p_player_id
      AND q.type = p_type
      AND q.id = ANY(p_queue_ids)
  )
  UPDATE queue q
  SET position = v_start_position + oi.new_position_offset
  FROM ordered_items oi
  WHERE q.id = oi.id
    AND q.player_id = p_player_id
    AND q.type = p_type;

  PERFORM log_event(p_player_id, 'queue_reorder', 'info', jsonb_build_object(
    'count', array_length(p_queue_ids, 1),
    'start_position', v_start_position,
    'type', p_type
  ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
