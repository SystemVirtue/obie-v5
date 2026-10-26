-- Harden function search_paths (idempotent).
--
-- Every ALTER FUNCTION below is guarded through to_regprocedure() so this
-- migration can be replayed against a database where an optional or
-- overloaded function is absent (fresh local reset, partial restore, or a
-- branch that dropped an overload). Missing functions are reported via
-- NOTICE rather than aborting the migration.
--
-- security definer functions without an explicit search_path are a privilege
-- escalation vector, so the ones that DO exist are always hardened.

DO $harden$
DECLARE
  v_signatures text[] := ARRAY[
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
    'public.create_or_get_media_item(text, text, text, text, text, integer, text, jsonb)'
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

  RAISE NOTICE 'search_path hardened on % function(s)', v_applied;
  IF array_length(v_skipped, 1) > 0 THEN
    RAISE NOTICE 'skipped % absent function(s): %',
      array_length(v_skipped, 1), array_to_string(v_skipped, ', ');
  END IF;
END
$harden$;
