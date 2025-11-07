-- Initialize Production Database
-- Run this in Supabase Dashboard SQL Editor: https://supabase.com/dashboard/project/syccqoextpxifmumvxqw/sql/new

-- 1. Create default player
INSERT INTO players (id, name, status, last_heartbeat, active_playlist_id, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Player', 'offline', NOW(), NULL, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 2. Create default player_status
INSERT INTO player_status (player_id, state, progress, current_media_id, now_playing_index, queue_head_position, last_updated)
VALUES ('00000000-0000-0000-0000-000000000001', 'idle', 0, NULL, 0, 0, NOW())
ON CONFLICT (player_id) DO NOTHING;

-- 3. Create default player_settings
INSERT INTO player_settings (player_id, loop, shuffle, volume, freeplay, coin_per_song, search_enabled)
VALUES ('00000000-0000-0000-0000-000000000001', false, false, 75, false, 1, true)
ON CONFLICT (player_id) DO NOTHING;

-- 3. Verify tables exist
SELECT 'Players:' as check_name, COUNT(*) as count FROM players
UNION ALL
SELECT 'Player Status:', COUNT(*) FROM player_status
UNION ALL
SELECT 'Playlists:', COUNT(*) FROM playlists
UNION ALL
SELECT 'Media Items:', COUNT(*) FROM media_items
UNION ALL
SELECT 'Queue:', COUNT(*) FROM queue;
