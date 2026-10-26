-- Hotfix: guard queue_next R2 probe when no exact R2 match exists.
-- The 20260511120000 rollout introduced an exact youtube_id lookup into a
-- RECORD variable. When ordinary YouTube-only media has no matching R2 row,
-- reading v_r2_match.public_url can raise at runtime and make player-control
-- return 500 on natural end / skip.

CREATE OR REPLACE FUNCTION public.queue_next(
  p_player_id         UUID,
  p_expected_media_id UUID DEFAULT NULL
)
RETURNS TABLE(media_item_id UUID, title TEXT, url TEXT, duration INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_queue_item    RECORD;
  v_loop               BOOLEAN;
  v_active_playlist_id UUID;
  v_loaded_count       INT;
  v_media              RECORD;
  v_current_media_id   UUID;
  v_youtube_id         TEXT;
  v_r2_match           RECORD;
  v_override           RECORD;
  v_override_found     BOOLEAN := FALSE;
  v_effective_media_id UUID;
  v_playback_source    TEXT;
  v_playback_url       TEXT;
  v_skipped_count      INT := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('queue_' || p_player_id::text));

  IF p_expected_media_id IS NOT NULL THEN
    SELECT ps.current_media_id
      INTO v_current_media_id
    FROM public.player_status ps
    WHERE ps.player_id = p_player_id;

    IF v_current_media_id IS DISTINCT FROM p_expected_media_id THEN
      PERFORM public.log_event(
        p_player_id,
        'queue_next_skipped',
        'warn',
        jsonb_build_object(
          'reason', 'idempotency_guard',
          'expected_media_id', p_expected_media_id,
          'actual_media_id', v_current_media_id
        )
      );
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
      RETURN;
    END IF;
  END IF;

  LOOP
    v_next_queue_item := NULL;
    v_media := NULL;
    v_youtube_id := NULL;
    v_r2_match := NULL;
    v_override := NULL;
    v_override_found := FALSE;
    v_effective_media_id := NULL;
    v_playback_source := 'youtube';
    v_playback_url := NULL;

    IF EXISTS (
      SELECT 1
      FROM public.queue q
      WHERE q.player_id = p_player_id
        AND q.type = 'priority'
        AND q.played_at IS NULL
    ) THEN
      SELECT q.id, q.media_item_id, q.type
        INTO v_next_queue_item
      FROM public.queue q
      WHERE q.player_id = p_player_id
        AND q.type = 'priority'
        AND q.played_at IS NULL
      ORDER BY q.position ASC
      LIMIT 1;
    ELSE
      SELECT q.id, q.media_item_id, q.type
        INTO v_next_queue_item
      FROM public.queue q
      WHERE q.player_id = p_player_id
        AND q.type = 'normal'
        AND q.played_at IS NULL
      ORDER BY q.position ASC
      LIMIT 1;
    END IF;

    IF v_next_queue_item IS NULL THEN
      SELECT ps.loop
        INTO v_loop
      FROM public.player_settings ps
      WHERE ps.player_id = p_player_id;

      IF v_loop AND v_skipped_count < 200 THEN
        SELECT p.active_playlist_id
          INTO v_active_playlist_id
        FROM public.players p
        WHERE p.id = p_player_id;

        IF v_active_playlist_id IS NOT NULL THEN
          SELECT lp.loaded_count
            INTO v_loaded_count
          FROM public.load_playlist(p_player_id, v_active_playlist_id, 0, TRUE) lp;

          IF COALESCE(v_loaded_count, 0) > 0 THEN
            CONTINUE;
          END IF;
        END IF;
      END IF;

      UPDATE public.player_status
      SET
        current_media_id = NULL,
        state = 'idle',
        progress = 0,
        source = 'youtube',
        local_url = NULL,
        playback_started_at = NULL,
        playback_error = NULL,
        playback_error_code = NULL,
        playback_error_at = NULL,
        last_recovery_reason = NULL,
        last_updated = NOW()
      WHERE player_id = p_player_id;

      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
      RETURN;
    END IF;

    IF p_expected_media_id IS NOT NULL
       AND v_next_queue_item.media_item_id = p_expected_media_id THEN
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
        p_player_id,
        'queue_next_removed_stale_current_row',
        'warn',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'queue_id', v_next_queue_item.id,
          'type', v_next_queue_item.type
        )
      );

      IF v_skipped_count >= 200 THEN
        PERFORM public.log_event(
          p_player_id,
          'queue_next_skip_limit',
          'error',
          jsonb_build_object('skipped_count', v_skipped_count)
        );
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
        RETURN;
      END IF;

      CONTINUE;
    END IF;

    SELECT *
      INTO v_media
    FROM public.media_items m
    WHERE m.id = v_next_queue_item.media_item_id;

    IF NOT FOUND THEN
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
        p_player_id,
        'queue_next_missing_media',
        'error',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'queue_id', v_next_queue_item.id
        )
      );

      CONTINUE;
    END IF;

    v_effective_media_id := v_media.id;

    SELECT *
      INTO v_override
    FROM public.media_playback_overrides
    WHERE media_item_id = v_media.id;
    v_override_found := FOUND;

    IF v_override_found AND v_override.override_type = 'excluded' THEN
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
        p_player_id,
        'queue_next_skipped_excluded',
        'warn',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'reason', v_override.reason,
          'override_type', v_override.override_type
        )
      );

      CONTINUE;
    END IF;

    IF v_override_found AND v_override.override_type = 'replacement' THEN
      IF v_override.replacement_media_item_id IS NULL
         OR v_override.replacement_media_item_id = v_media.id
         OR NOT public.media_has_playable_route(v_override.replacement_media_item_id) THEN
        DELETE FROM public.queue
        WHERE id = v_next_queue_item.id;

        v_skipped_count := v_skipped_count + 1;

        PERFORM public.log_event(
          p_player_id,
          'queue_next_skipped_invalid_replacement',
          'warn',
          jsonb_build_object(
            'media_item_id', v_next_queue_item.media_item_id,
            'replacement_media_item_id', v_override.replacement_media_item_id,
            'reason', v_override.reason
          )
        );

        CONTINUE;
      END IF;

      v_effective_media_id := v_override.replacement_media_item_id;

      SELECT *
        INTO v_media
      FROM public.media_items m
      WHERE m.id = v_effective_media_id;

      SELECT *
        INTO v_override
      FROM public.media_playback_overrides
      WHERE media_item_id = v_effective_media_id;
      v_override_found := FOUND;
    END IF;

    IF NOT public.media_has_playable_route(v_effective_media_id) THEN
      DELETE FROM public.queue
      WHERE id = v_next_queue_item.id;

      v_skipped_count := v_skipped_count + 1;

      PERFORM public.log_event(
        p_player_id,
        'queue_next_skipped_unplayable',
        'warn',
        jsonb_build_object(
          'media_item_id', v_next_queue_item.media_item_id,
          'effective_media_item_id', v_effective_media_id,
          'type', v_next_queue_item.type,
          'playability_status', v_media.youtube_playability_status,
          'playability_reason', v_media.youtube_playability_reason,
          'excluded_from_playback', v_media.excluded_from_playback,
          'excluded_reason', v_media.excluded_reason
        )
      );

      IF v_skipped_count >= 200 THEN
        PERFORM public.log_event(
          p_player_id,
          'queue_next_unplayable_skip_limit',
          'error',
          jsonb_build_object('skipped_count', v_skipped_count)
        );
        RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::INT WHERE FALSE;
        RETURN;
      END IF;

      CONTINUE;
    END IF;

    v_playback_source := CASE
      WHEN v_media.source_type = 'cloudflare' THEN 'cloudflare'
      WHEN v_media.source_type = 'local' THEN 'local'
      ELSE 'youtube'
    END;
    v_playback_url := CASE
      WHEN v_media.source_type IN ('cloudflare', 'local') THEN v_media.url
      ELSE NULL
    END;

    IF v_media.source_type = 'youtube' THEN
      v_youtube_id := COALESCE(v_media.youtube_id, public.extract_youtube_id(v_media.source_id), public.extract_youtube_id(v_media.url));

      IF v_override_found AND v_override.override_type = 'cloudflare' AND COALESCE(v_override.playback_url, '') <> '' THEN
        v_playback_source := 'cloudflare';
        v_playback_url := v_override.playback_url;
      ELSIF v_youtube_id IS NOT NULL THEN
        SELECT r.public_url, r.object_key
          INTO v_r2_match
        FROM public.r2_files r
        WHERE r.youtube_id = v_youtube_id
        ORDER BY r.synced_at DESC, r.created_at DESC
        LIMIT 1;

        IF FOUND AND v_r2_match.public_url IS NOT NULL THEN
          v_playback_source := 'cloudflare';
          v_playback_url := v_r2_match.public_url;
        END IF;
      END IF;
    END IF;

    DELETE FROM public.queue
    WHERE id = v_next_queue_item.id;

    UPDATE public.player_status
    SET
      current_media_id = v_effective_media_id,
      state = 'loading',
      progress = 0,
      now_playing_index = CASE
        WHEN v_next_queue_item.type = 'normal' THEN COALESCE(now_playing_index, -1) + 1
        ELSE now_playing_index
      END,
      source = v_playback_source,
      local_url = CASE
        WHEN v_playback_source IN ('cloudflare', 'local') THEN v_playback_url
        ELSE NULL
      END,
      playback_started_at = NULL,
      playback_error = NULL,
      playback_error_code = NULL,
      playback_error_at = NULL,
      last_recovery_reason = NULL,
      last_updated = NOW()
    WHERE player_id = p_player_id;

    PERFORM public.log_event(
      p_player_id,
      'queue_next',
      'info',
      jsonb_build_object(
        'media_item_id', v_effective_media_id,
        'original_media_item_id', v_next_queue_item.media_item_id,
        'type', v_next_queue_item.type,
        'source_type', v_media.source_type,
        'playback_source', v_playback_source,
        'youtube_id', v_youtube_id,
        'youtube_playability_status', v_media.youtube_playability_status
      )
    );

    RETURN QUERY
    SELECT
      m.id,
      m.title,
      CASE
        WHEN v_playback_source IN ('cloudflare', 'local') THEN v_playback_url
        ELSE m.url
      END,
      m.duration
    FROM public.media_items m
    WHERE m.id = v_effective_media_id;
    RETURN;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.queue_next(UUID, UUID) TO authenticated, service_role;
