-- Fix function search_path mutable security warnings
-- Set explicit search_path to prevent mutable search_path vulnerabilities

ALTER FUNCTION update_updated_at() SET search_path = public;
ALTER FUNCTION cleanup_expired_queue() SET search_path = public;
ALTER FUNCTION kiosk_decrement_credit(UUID, INT) SET search_path = public;
ALTER FUNCTION log_event(UUID, TEXT, TEXT, JSONB) SET search_path = public;
ALTER FUNCTION player_heartbeat(UUID) SET search_path = public;
ALTER FUNCTION queue_add(UUID, UUID, TEXT, TEXT) SET search_path = public;
ALTER FUNCTION queue_remove(UUID) SET search_path = public;
ALTER FUNCTION queue_skip(UUID) SET search_path = public;
ALTER FUNCTION queue_clear(UUID, TEXT) SET search_path = public;
ALTER FUNCTION kiosk_increment_credit(UUID, INT) SET search_path = public;
ALTER FUNCTION load_playlist(UUID, UUID, INT) SET search_path = public;
ALTER FUNCTION get_default_playlist(UUID) SET search_path = public;
ALTER FUNCTION initialize_player_playlist(UUID) SET search_path = public;
ALTER FUNCTION queue_reorder(UUID, UUID[], TEXT) SET search_path = public;
ALTER FUNCTION queue_next(UUID) SET search_path = public;