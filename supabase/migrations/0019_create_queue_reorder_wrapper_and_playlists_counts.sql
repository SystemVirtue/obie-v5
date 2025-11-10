-- 0019_create_queue_reorder_wrapper_and_playlists_counts.sql
-- Create a wrapper RPC to avoid overloaded queue_reorder ambiguity, and
-- add a view to return playlists with item counts for efficient fetching.

-- Wrapper function that forwards to existing queue_reorder implementation.
-- This wrapper has a unique name so PostgREST won't be ambiguous.
CREATE OR REPLACE FUNCTION queue_reorder_wrapper(
  p_player_id uuid,
  p_queue_ids uuid[],
  p_type text DEFAULT 'normal'::text
) RETURNS void AS $$
BEGIN
  -- Call the canonical queue_reorder implementation. If you later replace
  -- queue_reorder or add overloads, keep this wrapper pointing to the
  -- desired implementation.
  PERFORM queue_reorder(p_player_id => p_player_id, p_queue_ids => p_queue_ids, p_type => p_type);

  -- After reordering, reset now_playing_index to -1 so the first song in the reordered queue plays next
  UPDATE player_status
  SET now_playing_index = -1
  WHERE player_id = p_player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a view that shows playlists along with item counts to avoid
-- fetching items per-playlist from the client.
CREATE OR REPLACE VIEW playlists_with_counts AS
SELECT
  p.*,
  COALESCE(count(pi.id), 0) AS item_count
FROM playlists p
LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
GROUP BY p.id;

-- Grant select on the view to anon/public if needed (adjust for your RLS policies)
-- GRANT SELECT ON playlists_with_counts TO public;

-- ============================================================================
-- Enable RLS and create conservative policies for player_import_playlists
-- (Use DROP POLICY IF EXISTS before CREATE to support older Postgres versions)
-- NOTE: Skipping RLS setup for player_import_playlists as table doesn't exist
-- ============================================================================

-- Enable row level security on the import table
-- ALTER TABLE IF EXISTS public.player_import_playlists ENABLE ROW LEVEL SECURITY;

-- SELECT policy: only the owning player (via JWT claim) can select their row
-- DROP POLICY IF EXISTS player_import_playlists_select_authenticated ON public.player_import_playlists;
-- CREATE POLICY player_import_playlists_select_authenticated
--   ON public.player_import_playlists
--   FOR SELECT
--   USING (
--     player_id IS NOT NULL
--     AND player_id = (current_setting('request.jwt.claims.player_id', true))::uuid
--   );

-- INSERT policy: only allow a client to insert rows for their own player_id
-- DROP POLICY IF EXISTS player_import_playlists_insert_authenticated ON public.player_import_playlists;
-- CREATE POLICY player_import_playlists_insert_authenticated
--   ON public.player_import_playlists
--   FOR INSERT
--   WITH CHECK (
--     player_id = (current_setting('request.jwt.claims.player_id', true))::uuid
--   );

-- UPDATE policy: only owning player can update their own rows
-- DROP POLICY IF EXISTS player_import_playlists_update_authenticated ON public.player_import_playlists;
-- CREATE POLICY player_import_playlists_update_authenticated
--   ON public.player_import_playlists
--   FOR UPDATE
--   USING (player_id = (current_setting('request.jwt.claims.player_id', true))::uuid)
--   WITH CHECK (player_id = (current_setting('request.jwt.claims.player_id', true))::uuid);

-- DELETE policy: restrict deletes to admins (adjust role name as needed)
-- DROP POLICY IF EXISTS player_import_playlists_delete_admin ON public.player_import_playlists;
-- CREATE POLICY player_import_playlists_delete_admin
--   ON public.player_import_playlists
--   FOR DELETE
--   USING (current_setting('request.jwt.claims.role', true) = 'admin');

-- End of migration
