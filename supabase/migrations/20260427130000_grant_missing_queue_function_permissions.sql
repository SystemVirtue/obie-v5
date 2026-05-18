-- Grant execute permissions on queue management functions that were missing
-- after the YouTube playability migration broke SKIP and queue advance functionality.

-- These functions were created in 0001_initial_schema.sql with SECURITY DEFINER
-- but never had execute grants, causing permission errors when Edge Functions call them.

-- Set search_path and grant execute on log_event (used by queue_skip and queue_next)
ALTER FUNCTION public.log_event(uuid, text, text, jsonb) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.log_event(uuid, text, text, jsonb) TO authenticated, service_role;

-- Set search_path and grant execute on queue management functions
ALTER FUNCTION public.queue_skip(uuid) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.queue_skip(uuid) TO authenticated, service_role;

ALTER FUNCTION public.queue_add(uuid, uuid, text, text) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.queue_add(uuid, uuid, text, text) TO authenticated, service_role;

ALTER FUNCTION public.queue_clear(uuid, text) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.queue_clear(uuid, text) TO authenticated, service_role;

ALTER FUNCTION public.queue_remove(uuid) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.queue_remove(uuid) TO authenticated, service_role;

ALTER FUNCTION public.queue_reorder(uuid, uuid[], text) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.queue_reorder(uuid, uuid[], text) TO authenticated, service_role;

ALTER FUNCTION public.queue_reorder(uuid, uuid[], text, integer) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.queue_reorder(uuid, uuid[], text, integer) TO authenticated, service_role;
