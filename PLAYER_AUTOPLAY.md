# Player Auto-Play Implementation

## Overview
Implemented automatic playlist loading and playback for the Player app. When the Player loads, it now automatically:
1. Loads the active playlist (or "Obie Playlist" as default)
2. Starts from the previously stored `current_index`
3. Begins playback automatically

## Changes Made

### 1. Database Migration (`0003_playlist_loading.sql`)

Added three new SQL RPC functions:

#### `load_playlist(player_id, playlist_id, start_index)`
- Loads a playlist into the player's normal queue
- Clears existing normal queue (preserves priority queue)
- Starts from specified index, wrapping around
- Updates player's `active_playlist_id`
- Sets first item as current_media and state to 'loading'
- Stores `now_playing_index` for resume functionality

#### `get_default_playlist(player_id)`
- Returns the player's active playlist if set
- Falls back to "Obie Playlist" if no active playlist
- Falls back to any playlist with items
- Returns null if no playlists available

#### `initialize_player_playlist(player_id)`
- Combines the above two functions
- Gets current `now_playing_index` from player_status
- Loads the default playlist starting from that index
- Returns success status, playlist info, and loaded count

### 2. Shared Client (`web/shared/supabase-client.ts`)

Added three new exported functions:
```typescript
initializePlayerPlaylist(playerId: string)
loadPlaylist(playerId: string, playlistId: string, startIndex: number)
getDefaultPlaylist(playerId: string)
```

### 3. Player App (`web/player/src/App.tsx`)

Added auto-initialization logic:
- Calls `initializePlayerPlaylist()` on mount (once)
- Logs detailed debugging information to console
- Shows init status in debug overlay
- Displays current index and media ID for troubleshooting

Debug overlay now shows:
- Init status (initializing → loading_playlist → ready/error)
- Player state (idle/playing/paused/etc)
- Current track title and artist
- Playback progress percentage
- Now playing index and media ID

## Testing

### Test Results
```sql
-- Player status after initialization
player_id: 00000000-0000-0000-0000-000000000001
state: playing
now_playing_index: 0
current_media: "Sonnentanz ft. Will Heard" by Klangkarussell

-- Queue loaded
35 items in normal queue
```

### How to Test

1. **Start the Player:**
   ```bash
   cd web/player && npm run dev
   # Open http://localhost:5174
   ```

2. **Check Console Logs:**
   ```
   [Player] Initializing player with default playlist...
   [Player] Playlist loaded: {playlist_name: "Obie Playlist", loaded_count: 35}
   [Player] Status update: {state: "loading", current_media_id: "...", now_playing_index: 0}
   [Player] Status update: {state: "playing", ...}
   ```

3. **Verify Auto-Play:**
   - Player should show "Init: ready" in debug overlay
   - Status should change from "loading" to "playing"
   - YouTube video should start playing automatically
   - Debug overlay shows track info and progress

4. **Test Resume Functionality:**
   ```sql
   -- Set player to middle of playlist
   UPDATE player_status 
   SET now_playing_index = 10 
   WHERE player_id = '00000000-0000-0000-0000-000000000001';
   ```
   - Refresh player
   - Should start from song #10

## Behavior

### Startup Flow
1. Player app loads
2. Calls `initialize_player_playlist()`
3. Function finds "Obie Playlist" (or active_playlist)
4. Loads all 35 songs into queue starting from `now_playing_index`
5. Sets first song as `current_media_id`
6. Sets state to 'loading'
7. Realtime subscription updates Player app
8. Player iframe loads YouTube video with autoplay
9. Video starts playing, state updates to 'playing'

### Fallback Logic
- **Primary:** Use player's `active_playlist_id` if set
- **Secondary:** Find "Obie Playlist" by name
- **Tertiary:** Use any playlist with items (newest first)
- **Failure:** Returns success=false, shows "No playlist available"

### Queue Management
- Normal queue is cleared and replaced with playlist
- Priority queue is preserved (user requests)
- Priority items play before normal playlist items
- Shuffle setting respected (if enabled)

## Debug Information

### Console Logs
All player operations log to console with `[Player]` prefix:
- Initialization steps
- Playlist loading results
- Status updates (state, media_id, index, progress)

### Debug Overlay
Shows real-time information:
- Init status (initialization state)
- Player state (idle/playing/paused/loading/error)
- Current track (title, artist)
- Progress (0-100%)
- Index (now_playing_index)
- Media ID (first 8 chars of UUID)

## API Reference

### `initialize_player_playlist(p_player_id UUID)`
**Returns:**
```sql
TABLE(success BOOLEAN, playlist_id UUID, playlist_name TEXT, loaded_count INT)
```

**Example:**
```sql
SELECT * FROM initialize_player_playlist('00000000-0000-0000-0000-000000000001');
-- Returns: {success: true, playlist_id: "...", playlist_name: "Obie Playlist", loaded_count: 35}
```

### `load_playlist(p_player_id UUID, p_playlist_id UUID, p_start_index INT)`
**Returns:**
```sql
TABLE(loaded_count INT)
```

**Example:**
```sql
SELECT * FROM load_playlist(
  '00000000-0000-0000-0000-000000000001',
  'bcb2dffe-bf60-4452-8b61-7f6af702c744',
  0
);
-- Returns: {loaded_count: 35}
```

### `get_default_playlist(p_player_id UUID)`
**Returns:**
```sql
TABLE(playlist_id UUID, playlist_name TEXT)
```

**Example:**
```sql
SELECT * FROM get_default_playlist('00000000-0000-0000-0000-000000000001');
-- Returns: {playlist_id: "...", playlist_name: "Obie Playlist"}
```

## Future Enhancements

1. **Loop Playlist:** When queue ends, reload from beginning if loop enabled
2. **Shuffle Mode:** Randomize queue order if shuffle enabled
3. **Resume Progress:** Store and resume from exact playback position (not just index)
4. **Multi-Playlist Queue:** Queue from multiple playlists
5. **Auto-Advance:** Automatically call `queue_next()` when song ends

## Notes

- Large playlists (1000+ songs) may hit Edge Function worker limits during import
- Recommended to use playlists under 100 songs for reliable operation
- Player requires at least one playlist with items to function
- Default playlist name is "Obie Playlist" (can be changed in SQL function)
