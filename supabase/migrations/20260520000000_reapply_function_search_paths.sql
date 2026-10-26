-- Reapply search_path hardening to SECURITY DEFINER functions (idempotent).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- 20260409111138 and 20260409113429 hardened 19 SECURITY DEFINER functions by
-- setting an explicit `search_path = public`. Both were applied to production
-- long ago, so they will never run there again.
--
-- Two things defeated that hardening in production:
--
--   1. Postgres RESETS a function's search_path whenever the function is
--      replaced by `CREATE OR REPLACE FUNCTION` without an explicit search_path
--      clause. Later migrations that redefined already-hardened functions
--      (0032, 20251109233222, 20260426000004/5, ...) silently wiped it.
--
--   2. Several SECURITY DEFINER functions were introduced AFTER the 20260409
--      pair and were never in that migration's signature list at all
--      (0025's create_player_for_user / handle_new_user / get_my_player_id),
--      so they were never hardened in the first place.
--
-- Editing the already-applied 20260409 migrations repairs fresh replays but
-- does nothing for production. This forward-only migration re-asserts the
-- hardening for every affected signature, so production converges on the same
-- state as a clean replay of the whole migration set.
--
-- WHY IT MATTERS
-- --------------
-- A SECURITY DEFINER function runs with the privileges of its owner. If its
-- search_path is caller-controlled, a caller can create objects in a schema
-- earlier on their search_path and shadow the unqualified references in the
-- function body, executing their own code as the owner. Pinning search_path is
-- the standard mitigation.
--
-- SAFETY
-- ------
-- Every ALTER FUNCTION is guarded through to_regprocedure(), so this migration
-- replays cleanly against a database where an optional or overloaded function is
-- absent (fresh local reset, partial restore, or a branch that dropped an
-- overload). Absent signatures are reported via NOTICE rather than aborting.
-- Re-running is a no-op: setting search_path to the value it already has is
-- harmless.
--
-- This is catalog-only DDL. No table rewrite, no data movement, no lock held
-- beyond the catalog update, so it is safe to run during a deploy window.

DO $harden$
DECLARE
  v_signatures text[] := ARRAY[
    -- ---------------------------------------------------------------------
    -- Originally hardened by 20260409111138 / 20260409113429 (19 signatures)
    -- ---------------------------------------------------------------------
    'public.update_updated_at()',
    'public.cleanup_expired_queue()',
    'public.player_heartbeat(uuid)',
    'public.log_event(uuid, text, text, jsonb)',
    'public.queue_add(uuid, uuid, text, text)',
    'public.queue_skip(uuid)',
    'public.queue_clear(uuid, text)',
    'public.queue_remove(uuid)',
    'public.queue_reorder(uuid, uuid[], text)',
    'public.queue_reorder(uuid, uuid[], text, integer)',
    'public.queue_shuffle(uuid, text)',
    'public.queue_next(uuid, uuid)',
    'public.queue_reorder_wrapper(uuid, uuid[], text)',
    'public.load_playlist(uuid, uuid, integer, boolean)',
    'public.kiosk_increment_credit(uuid, integer)',
    'public.kiosk_decrement_credit(uuid, integer)',
    'public.kiosk_request_enqueue(uuid, uuid)',
    'public.initialize_player_playlist(uuid)',
    'public.create_or_get_media_item(text, text, text, text, text, integer, text, jsonb)',

    -- ---------------------------------------------------------------------
    -- Overloads that were NEVER in the 20260409 lists, yet exist in
    -- production because 0001 / 0032 / 20251109233222 define them without a
    -- search_path clause. These are the functions that actually leave
    -- production exposed today.
    -- ---------------------------------------------------------------------
    'public.queue_next(uuid)',
    'public.load_playlist(uuid, uuid, integer)',

    -- ---------------------------------------------------------------------
    -- SECURITY DEFINER functions introduced by 0025 that were never hardened
    -- (they postdate the 20260409 pair and are absent from its lists).
    -- 20260519000000 already gives handle_new_user() search_path = public,
    -- so this is a no-op wherever that migration has run.
    -- ---------------------------------------------------------------------
    'public.create_player_for_user(uuid, text)',
    'public.handle_new_user()',
    'public.get_my_player_id()',

    -- ---------------------------------------------------------------------
    -- Multi-endpoint master/slave controls introduced by 20260427090000.
    -- Also SECURITY DEFINER with no search_path clause of their own. Their
    -- bodies fully qualify public.* objects, so pinning public is safe.
    -- ---------------------------------------------------------------------
    'public.clear_priority_endpoint(uuid)',
    'public.assign_priority_endpoint(uuid, uuid)',

    -- ---------------------------------------------------------------------
    -- Playback-lifecycle functions introduced by 20260513000000. Guarded, so
    -- they are simply skipped on a database where that migration has not run.
    -- ---------------------------------------------------------------------
    'public.confirm_queue_playback(uuid, uuid)',
    'public.mark_queue_playback_failed(uuid, uuid, text)'
  ];
  v_sig text;
  v_applied int := 0;
  v_skipped text[] := '{}';
BEGIN
  FOREACH v_sig IN ARRAY v_signatures LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_sig);
      v_applied := v_applied + 1;
    ELSE
      v_skipped := v_skipped || v_sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'search_path re-hardened on % function(s)', v_applied;
  IF array_length(v_skipped, 1) > 0 THEN
    RAISE NOTICE 'skipped % absent function(s): %',
      array_length(v_skipped, 1), array_to_string(v_skipped, ', ');
  END IF;
END
$harden$;
