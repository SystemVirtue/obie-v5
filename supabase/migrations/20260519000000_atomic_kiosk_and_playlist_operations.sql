CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.players WHERE owner_id = NEW.id
  ) THEN
    UPDATE public.players
    SET owner_id = NEW.id
    WHERE id = '00000000-0000-0000-0000-000000000001'
      AND owner_id IS NULL;

    IF NOT FOUND THEN
      PERFORM public.create_player_for_user(
        NEW.id,
        COALESCE(NEW.email, 'user@obie')
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_add_credits(
  p_session_id UUID,
  p_amount INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive' USING ERRCODE = '22023';
  END IF;

  UPDATE public.kiosk_sessions
  SET credits = credits + p_amount,
      last_active = NOW()
  WHERE session_id = p_session_id
  RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_credits;
END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_request_enqueue(
  p_session_id UUID,
  p_media_item_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id UUID;
  v_credits INT;
  v_coin_per_song INT := 1;
  v_freeplay BOOLEAN := FALSE;
  v_queue_id UUID;
BEGIN
  SELECT ks.player_id, ks.credits
  INTO v_player_id, v_credits
  FROM public.kiosk_sessions ks
  WHERE ks.session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(ps.freeplay, FALSE), COALESCE(ps.coin_per_song, 1)
  INTO v_freeplay, v_coin_per_song
  FROM public.player_settings ps
  WHERE ps.player_id = v_player_id;

  IF NOT FOUND THEN
    v_freeplay := FALSE;
    v_coin_per_song := 1;
  END IF;

  IF NOT v_freeplay THEN
    IF COALESCE(v_credits, 0) < v_coin_per_song THEN
      RAISE EXCEPTION 'Insufficient credits' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.kiosk_sessions
    SET credits = credits - v_coin_per_song,
        last_active = NOW()
    WHERE session_id = p_session_id;
  END IF;

  v_queue_id := public.queue_add(
    v_player_id,
    p_media_item_id,
    'priority',
    p_session_id::TEXT
  );

  PERFORM public.log_event(
    v_player_id,
    'kiosk_request_enqueue',
    'info',
    jsonb_build_object(
      'session_id', p_session_id,
      'media_item_id', p_media_item_id,
      'queue_id', v_queue_id
    )
  );

  RETURN v_queue_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.playlist_add_item(
  p_playlist_id UUID,
  p_media_item_id UUID
)
RETURNS SETOF public.playlist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('playlist_' || p_playlist_id::TEXT));

  SELECT COALESCE(MAX(position) + 1, 0)
  INTO v_position
  FROM public.playlist_items
  WHERE playlist_id = p_playlist_id;

  RETURN QUERY
  INSERT INTO public.playlist_items (playlist_id, media_item_id, position)
  VALUES (p_playlist_id, p_media_item_id, v_position)
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.playlist_remove_item(
  p_playlist_id UUID,
  p_media_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('playlist_' || p_playlist_id::TEXT));

  DELETE FROM public.playlist_items
  WHERE playlist_id = p_playlist_id
    AND media_item_id = p_media_item_id;

  SELECT COALESCE(MAX(position)::BIGINT, 0) + COUNT(*) + 1
  INTO v_offset
  FROM public.playlist_items
  WHERE playlist_id = p_playlist_id;

  UPDATE public.playlist_items
  SET position = position + v_offset
  WHERE playlist_id = p_playlist_id;

  WITH ordered_items AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS new_position
    FROM public.playlist_items
    WHERE playlist_id = p_playlist_id
  )
  UPDATE public.playlist_items pi
  SET position = oi.new_position
  FROM ordered_items oi
  WHERE pi.id = oi.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.playlist_reorder_items(
  p_playlist_id UUID,
  p_item_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_count BIGINT;
  v_offset BIGINT;
BEGIN
  IF p_item_ids IS NULL THEN
    RAISE EXCEPTION 'Item IDs are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('playlist_' || p_playlist_id::TEXT));

  SELECT COUNT(*)
  INTO v_item_count
  FROM public.playlist_items
  WHERE playlist_id = p_playlist_id;

  IF cardinality(p_item_ids) <> v_item_count
     OR cardinality(p_item_ids) <> (
       SELECT COUNT(DISTINCT item_id)
       FROM unnest(p_item_ids) AS requested(item_id)
     )
     OR EXISTS (
       SELECT 1
       FROM unnest(p_item_ids) AS requested(item_id)
       WHERE NOT EXISTS (
         SELECT 1
         FROM public.playlist_items pi
         WHERE pi.playlist_id = p_playlist_id
           AND pi.id = requested.item_id
       )
     ) THEN
    RAISE EXCEPTION 'Item IDs must be a complete permutation of the playlist items'
      USING ERRCODE = '22023';
  END IF;

  IF v_item_count = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(MAX(position)::BIGINT, 0) + v_item_count + 1
  INTO v_offset
  FROM public.playlist_items
  WHERE playlist_id = p_playlist_id;

  UPDATE public.playlist_items
  SET position = position + v_offset
  WHERE playlist_id = p_playlist_id;

  WITH requested_order AS (
    SELECT item_id, ordinality - 1 AS new_position
    FROM unnest(p_item_ids) WITH ORDINALITY AS requested(item_id, ordinality)
  )
  UPDATE public.playlist_items pi
  SET position = requested_order.new_position
  FROM requested_order
  WHERE pi.playlist_id = p_playlist_id
    AND pi.id = requested_order.item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.playlist_append_items(
  p_playlist_id UUID,
  p_media_item_ids UUID[]
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_position INT;
  v_inserted_count INT;
BEGIN
  IF p_media_item_ids IS NULL THEN
    RAISE EXCEPTION 'Media item IDs are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('playlist_' || p_playlist_id::TEXT));

  SELECT COALESCE(MAX(position) + 1, 0)
  INTO v_start_position
  FROM public.playlist_items
  WHERE playlist_id = p_playlist_id;

  INSERT INTO public.playlist_items (playlist_id, media_item_id, position)
  SELECT p_playlist_id, requested.media_item_id, v_start_position + requested.ordinality - 1
  FROM unnest(p_media_item_ids) WITH ORDINALITY AS requested(media_item_id, ordinality);

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RETURN v_inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.playlist_set_active(
  p_player_id UUID,
  p_playlist_id UUID,
  p_current_index INT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_playlist_' || p_player_id::TEXT));

  IF NOT EXISTS (
    SELECT 1
    FROM public.playlists
    WHERE id = p_playlist_id
      AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION 'Playlist not found for player' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.playlists
  SET is_active = (id = p_playlist_id)
  WHERE player_id = p_player_id;

  UPDATE public.players
  SET active_playlist_id = p_playlist_id,
      updated_at = NOW()
  WHERE id = p_player_id;

  IF p_current_index IS NOT NULL THEN
    UPDATE public.player_status
    SET now_playing_index = p_current_index
    WHERE player_id = p_player_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_reorder(
  p_player_id UUID,
  p_queue_ids UUID[],
  p_type TEXT,
  p_start_position INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset BIGINT;
BEGIN
  IF p_type IS NULL
     OR p_type NOT IN ('normal', 'priority')
     OR p_start_position IS NULL
     OR p_start_position < 0 THEN
    RAISE EXCEPTION 'Invalid queue reorder parameters' USING ERRCODE = '22023';
  END IF;

  IF p_queue_ids IS NOT NULL
     AND cardinality(p_queue_ids) <> (
       SELECT COUNT(DISTINCT queue_id)
       FROM unnest(p_queue_ids) AS requested(queue_id)
     ) THEN
    RAISE EXCEPTION 'Queue IDs must not contain duplicates' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::TEXT));

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::UUID[])) AS requested(queue_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.queue q
      WHERE q.id = requested.queue_id
        AND q.player_id = p_player_id
        AND q.type = p_type
        AND q.played_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'Queue IDs must belong to the active queue being reordered'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(position)::BIGINT, 0) + COUNT(*) + p_start_position + 1
  INTO v_offset
  FROM public.queue
  WHERE player_id = p_player_id
    AND type = p_type
    AND played_at IS NULL;

  UPDATE public.queue
  SET position = position + v_offset
  WHERE player_id = p_player_id
    AND type = p_type
    AND played_at IS NULL;

  WITH provided AS (
    SELECT requested.queue_id AS id, requested.ordinality AS ordering
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::UUID[])) WITH ORDINALITY
      AS requested(queue_id, ordinality)
  ),
  remaining AS (
    SELECT q.id,
      ROW_NUMBER() OVER (ORDER BY q.position, q.requested_at NULLS LAST, q.id) AS remaining_order
    FROM public.queue q
    WHERE q.player_id = p_player_id
      AND q.type = p_type
      AND q.played_at IS NULL
      AND NOT (q.id = ANY(COALESCE(p_queue_ids, ARRAY[]::UUID[])))
  ),
  combined AS (
    SELECT id, ordering FROM provided
    UNION ALL
    SELECT id, cardinality(COALESCE(p_queue_ids, ARRAY[]::UUID[])) + remaining_order
    FROM remaining
  ),
  numbered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY ordering) - 1 AS position_offset
    FROM combined
  )
  UPDATE public.queue q
  SET position = p_start_position + numbered.position_offset
  FROM numbered
  WHERE q.id = numbered.id
    AND q.player_id = p_player_id
    AND q.type = p_type
    AND q.played_at IS NULL;

  PERFORM public.log_event(
    p_player_id,
    'queue_reorder',
    'info',
    jsonb_build_object(
      'provided_count', cardinality(COALESCE(p_queue_ids, ARRAY[]::UUID[])),
      'start_position', p_start_position,
      'type', p_type
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_reorder(
  p_player_id UUID,
  p_queue_ids UUID[],
  p_type TEXT DEFAULT 'normal'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.queue_reorder(p_player_id, p_queue_ids, p_type, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_add_credits(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kiosk_request_enqueue(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.playlist_add_item(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.playlist_remove_item(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.playlist_reorder_items(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.playlist_append_items(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.playlist_set_active(UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_add(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_remove(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_reorder(UUID, UUID[], TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_reorder(UUID, UUID[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_next(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_skip(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_clear(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_shuffle(UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kiosk_add_credits(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_request_enqueue(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.playlist_add_item(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.playlist_remove_item(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.playlist_reorder_items(UUID, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.playlist_append_items(UUID, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.playlist_set_active(UUID, UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_add(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_remove(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_reorder(UUID, UUID[], TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_reorder(UUID, UUID[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_next(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_skip(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_clear(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_shuffle(UUID, TEXT) TO service_role;
