# Obie Jukebox v2 — Setup & User Guide

> **Version:** 2.0.0 | **Last Updated:** November 2025  
> A real-time, server-first jukebox system powered by Supabase. All business logic runs on the server. Clients are thin, stateless UIs that render Realtime data and send events.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Installation & First-Time Setup](#2-installation--first-time-setup)
3. [User Sign-Up / Log-In](#3-user-sign-up--log-in)
4. [The Admin Console](#4-the-admin-console)
   - [Queue Tab](#41-queue-tab)
   - [Playlists Tab](#42-playlists-tab)
   - [Settings Tab](#43-settings-tab)
   - [Logs Tab](#44-logs-tab)
5. [The Search Kiosk Webpage](#5-the-search-kiosk-webpage)
   - [Searching](#51-searching)
   - [Credits](#52-credits)
   - [Customise Kiosk Theme / Overlay](#53-customise-kiosk-theme--overlay)
6. [The Video Player Webpage](#6-the-video-player-webpage)
   - [Display Options](#61-display-options)
   - [Customise Player Theme / Overlay](#62-customise-player-theme--overlay)
7. [Edge Functions & Scripts](#7-edge-functions--scripts)
8. [YouTube API Setup](#8-youtube-api-setup)
9. [Importing Playlists](#9-importing-playlists)
10. [Production Deployment](#10-production-deployment)
11. [Troubleshooting](#11-troubleshooting)
12. [Performance & Free-Tier Compliance](#12-performance--free-tier-compliance)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE SERVER                          │
│  (Single Source of Truth)                                       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Postgres    │  │  Realtime    │  │    Edge      │         │
│  │   Database   │  │  Broadcast   │  │  Functions   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   ADMIN     │    │   PLAYER    │    │   KIOSK     │
│  Console    │    │   Window    │    │  Interface  │
│  :5173      │    │  :5174      │    │  :5175      │
└─────────────┘    └─────────────┘    └─────────────┘
```

### Key Design Principles

- **Server-First** — All state lives in Supabase database; clients are display-only
- **Real-time Sync** — Changes broadcast instantly via WebSockets (<100ms latency)
- **Stateless Clients** — No localStorage, no client-side queue logic
- **Priority Queue** — Paid kiosk requests play before normal queue
- **Free-Tier Safe** — Optimised for Supabase free tier (<5% of all limits)

### Data Flow

```
User Action → Frontend → Edge Function → RPC → Database → Realtime → All Clients
```

**Example — Adding a song to queue:**
1. Admin clicks "Add to Queue"
2. Calls `callQueueManager({ action: 'add', ... })`
3. Edge Function authenticates request
4. Calls SQL RPC `queue_add(...)` with advisory lock
5. Row inserted into queue table
6. Realtime broadcasts INSERT event to all subscribers
7. All UIs re-render — total time: **<100ms**

---

## 2. Installation & First-Time Setup

### Prerequisites

- **Node.js 18+** and npm
- **Docker** (for local Supabase)
- **Supabase CLI**: `npm install -g supabase`
- **Supabase account** — [sign up free](https://supabase.com)
- **YouTube Data API v3 key** (for playlist import/search)

### Step 1 — Clone & Install

```bash
git clone https://github.com/SystemVirtue/obie-v5
cd obie-v5
npm install
```

### Step 2 — Quick Setup (Interactive)

```bash
./setup.sh
```

This script walks you through the full first-run configuration interactively.

### Step 3 — Manual Setup (Alternative to setup.sh)

#### 3a. Start Local Supabase (requires Docker)

```bash
npm run supabase:start

# Output will include:
# - API URL: http://localhost:54321
# - anon key: <your-anon-key>
# - service_role key: <your-service-key>
# - Studio URL: http://localhost:54323
```

#### 3b. Configure Environment Files

Create `.env` in each frontend app directory:

**`web/admin/.env`**
```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

**`web/player/.env`**
```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

**`web/kiosk/.env`**
```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Or copy from the example file:
```bash
cp .env.example web/admin/.env
cp .env.example web/player/.env
cp .env.example web/kiosk/.env
```

#### 3c. Run Database Migrations

```bash
npm run supabase:reset
```

This drops all tables, runs all migrations, and seeds default data — creating all 9 tables, 9 RPCs, RLS policies, and the default player record.

#### 3d. Start All Frontend Apps

```bash
npm run dev
```

Opens:
- **Admin Console** → http://localhost:5173
- **Player Window** → http://localhost:5174
- **Kiosk Interface** → http://localhost:5175
- **Supabase Studio** → http://localhost:54323

Or start individually:
```bash
npm run dev:admin
npm run dev:player
npm run dev:kiosk
```

### Daily Development Workflow

```bash
# Terminal 1 — Supabase backend
npm run supabase:start

# Terminal 2 — All frontend apps
npm run dev

# Terminal 3 — Watch Edge Function logs
supabase functions logs --local
```

---

## 3. User Sign-Up / Log-In

The Admin Console requires authentication. The Player and Kiosk run as anonymous clients.

### Creating the First Admin User

#### Method A — Via Supabase Dashboard (Recommended)

1. Open Supabase Studio: http://localhost:54323 (local) or your cloud dashboard
2. Navigate to **Authentication → Users → Add User**
3. Enter email and password
4. Click **Create User**

#### Method B — Via SQL Editor

```sql
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES (
  'admin@example.com',
  crypt('your-secure-password', gen_salt('bf')),
  NOW()
);
```

#### Method C — Via Supabase CLI (Cloud Only)

```bash
# Only available for cloud projects
supabase auth admin create-user --email admin@example.com --password your-password
```

### Logging In to the Admin Console

1. Navigate to http://localhost:5173 (or your deployed Admin URL)
2. Enter your email and password
3. You will be authenticated via Supabase Auth and gain full admin access

### Authentication Configuration (Production)

In the Supabase dashboard:
1. Go to **Authentication → Settings**
2. Enable **Email provider**
3. Set **Site URL**: `https://admin.yourdomain.com`
4. Add **Redirect URLs**:
   - `https://admin.yourdomain.com`
   - `http://localhost:5173` (for local dev)

### Access Levels

| Role | Access |
|------|--------|
| **Admin (authenticated)** | Full read/write — queue, playlists, settings, logs |
| **Player (anonymous)** | Read/write own `player_status` only |
| **Kiosk (anonymous)** | Read `media_items` + `player_settings`; write own `kiosk_sessions` |

---

## 4. The Admin Console

The Admin Console runs on **port 5173** and is the primary control interface for the jukebox. It requires authentication.

> ⚠️ **Important**: The Player Window must be open and running for queue operations to function. The Player sends a heartbeat every 3 seconds; without it, the system considers the player "offline".

---

### 4.1 Queue Tab

The Queue Tab is the main operational view showing all songs currently waiting to play.

#### Viewing the Queue

The queue is split into two sections:
- **Priority Queue** — Songs requested via the Kiosk (paid/credited requests). These always play before normal queue items.
- **Normal Queue** — Standard playlist-loaded songs.

Both sections update in real-time as songs are added, removed, or reordered.

#### Player Controls

At the top of the Queue Tab:

| Button | Action |
|--------|--------|
| **Play/Pause** | Toggle playback on the Player window |
| **Skip** | Skip current song, advance to next in queue |
| **Clear** | Remove all songs from queue |

#### Adding Songs to the Queue

From the Queue Tab, you can search media items and add them directly. Songs added by admin go into the **Normal Queue**.

**Via SQL (direct):**
```sql
SELECT queue_add(
  '00000000-0000-0000-0000-000000000001',  -- player_id
  '<media_item_id>',                        -- media item UUID
  'normal',                                 -- 'normal' or 'priority'
  'admin'                                   -- requested_by
);
```

#### Advanced Queue Features

##### Drag-and-Drop Reordering

- Click and drag any song in the **Normal Queue** to reorder playback sequence.
- Changes sync to the server instantly with optimistic UI updates.
- Priority queue items are fixed and cannot be reordered (they always play first).

##### Shuffle Functionality

- Click the **Shuffle** button to randomize the order of all songs in the Normal Queue.
- Server-side reordering ensures no race conditions during concurrent operations.
- Shuffle state is indicated with a loading spinner during processing.

##### Priority Queue Management

- Songs requested via the Kiosk are automatically added to the **Priority Queue**.
- Priority items display with a distinct yellow background and always play before Normal Queue songs.
- Priority queue updates in real-time and cannot be reordered manually.

##### Real-Time Status Updates

- Now Playing section shows the currently playing song with thumbnail and progress.
- Player status indicators (Online/Offline) update live via WebSocket connections.
- Queue counts and request totals refresh instantly across all connected clients.

#### Removing Songs

Click the remove/trash icon next to any queue item to delete it from the queue.

#### Queue Settings (SQL)

```sql
UPDATE player_settings SET
  max_queue_size = 50,         -- maximum songs in normal queue
  priority_queue_limit = 10    -- maximum priority queue songs
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

---

### 4.2 Playlists Tab

The Playlists Tab manages the library of playlists available to the player.

#### Viewing Playlists

All imported playlists are shown with song counts. The currently active playlist (auto-loaded on player startup) is indicated.

**Current imported playlists:**

| Playlist | Songs |
|----------|-------|
| Obie Playlist (Default) | 1,217 |
| Main Playlist | 192 |
| Obie Nights | 190 |
| Poly | 82 |
| Obie Johno | 78 |
| DJAMMMS Default | 58 |
| Karaoke | 57 |
| Obie Jo | 35 |

#### Creating a New Playlist

1. Click **"New Playlist"** in the Playlists Tab
2. Enter a name
3. Add songs via search or YouTube playlist import

#### Setting the Active Playlist

The active playlist auto-loads into the queue when the Player starts. To change it:

```sql
UPDATE players SET
  active_playlist_id = '<playlist-uuid>'
WHERE id = '00000000-0000-0000-0000-000000000001';
```

Or use the Admin UI to click **"Set as Active"** on any playlist.

#### Loading a Playlist into the Queue

The `load_playlist` function:
- Clears the existing **normal** queue (priority queue is preserved)
- Loads all songs from the specified playlist starting from a given index
- Wraps around (supports resuming from a specific position)

```sql
SELECT * FROM load_playlist(
  '00000000-0000-0000-0000-000000000001',  -- player_id
  '<playlist-uuid>',                        -- playlist to load
  0                                         -- start_index (0 = beginning)
);
```

#### Auto-Play & Resume on Startup

When the Player loads, it automatically:
1. Calls `initialize_player_playlist()`
2. Finds the active playlist (or falls back to "Obie Playlist" → any playlist)
3. Loads songs into the queue starting from the last-known `now_playing_index`
4. Begins playback

**Fallback logic:**
1. Use player's `active_playlist_id` if set
2. Find "Obie Playlist" by name
3. Use any playlist with items (newest first)
4. Return error if no playlists available

**To test resume from a specific position:**
```sql
UPDATE player_status
SET now_playing_index = 10
WHERE player_id = '00000000-0000-0000-0000-000000000001';
-- Refresh Player — it will start from song #10
```

#### Importing Playlists from YouTube

See [Section 9 — Importing Playlists](#9-importing-playlists) for detailed import instructions and scripts.

#### Deleting a Playlist

Use the Admin UI delete button, or via SQL:
```sql
DELETE FROM playlists WHERE id = '<playlist-uuid>';
-- Note: playlist_items are cascade deleted
```

---

### 4.3 Settings Tab

The Settings Tab controls all player and kiosk configuration.

#### Playback Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `loop` | false | Loop playlist when queue ends |
| `shuffle` | false | Randomise queue order |
| `volume` | 75 | Playback volume (0–100) |

```sql
UPDATE player_settings SET
  loop = false,
  shuffle = true,
  volume = 75
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

#### Kiosk Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `freeplay` | false | Allow requests without credits |
| `coin_per_song` | 1 | Credits required per song request |
| `search_enabled` | true | Enable/disable kiosk search |
| `max_queue_size` | 50 | Max songs in normal queue |
| `priority_queue_limit` | 10 | Max songs in priority queue |

```sql
UPDATE player_settings SET
  freeplay = false,
  coin_per_song = 1,
  search_enabled = true
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

**Enable free play (no credits required):**
```sql
UPDATE player_settings SET freeplay = true
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

#### Branding / Kiosk Theme

Configure the kiosk display name, logo, and colour theme:

```sql
UPDATE player_settings SET
  branding = '{
    "name": "My Jukebox",
    "logo": "https://example.com/logo.png",
    "theme": "dark"
  }'::jsonb
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

---

### 4.4 Logs Tab

The Logs Tab shows real-time system events with severity filtering.

#### Severity Levels

| Level | Colour | When Used |
|-------|--------|-----------|
| `info` | Blue | Normal operations (song played, queue updated) |
| `warning` | Yellow | Non-critical issues (credit shortfall, player slow) |
| `error` | Red | Failures (Edge Function error, API quota exceeded) |

#### Filtering

Use the severity filter dropdown to show only events of a specific level.

#### Reading Logs via SQL

```sql
SELECT created_at, severity, message
FROM system_logs
ORDER BY created_at DESC
LIMIT 50;
```

---

## 5. The Search Kiosk Webpage

The Kiosk Interface runs on **port 5175** and is a touch-optimised public-facing terminal for song requests.

### 5.1 Searching

1. Tap the search bar at the top of the Kiosk screen
2. Type a song title, artist name, or keyword
3. Results appear in a scrollable grid showing title, artist, and thumbnail
4. Tap any result to see the **Request** button

Search is performed against the local `media_items` database (not live YouTube search). All imported playlist songs are available.

### 5.2 Credits

Songs requested via the Kiosk require credits (unless freeplay mode is enabled).

#### Credit Display

The current credit balance is shown prominently on the Kiosk screen and updates in real-time.

#### Adding Credits (Dev/Testing)

During development, click the **"Insert Coin (Dev)"** button to add a credit.

#### Adding Credits (Production with Coin Acceptor)

The system is designed for physical coin acceptor integration via the **WebSerial API**. The coin acceptor triggers `kiosk_increment_credit()` via the browser's serial port.

#### Credit SQL Operations

```sql
-- Add credits to a session
SELECT kiosk_increment_credit('<session_id>', 1);

-- Deduct credits (happens automatically on request)
SELECT kiosk_decrement_credit('<session_id>', 1);

-- Check session credits
SELECT credits FROM kiosk_sessions WHERE id = '<session_id>';
```

#### Requesting a Song

1. Search for a song
2. Tap the song card
3. If credits are available (or freeplay is on), tap **"Request"**
4. The song is added to the **Priority Queue** and will play before normal queue items
5. Confirmation appears on screen

**Full request flow:**
```
Kiosk: User taps Request → callKioskHandler('request', media_item_id)
Server: Checks credits/freeplay → queue_add RPC → Priority queue
Player: Realtime update → loads song when current song ends
```

### 5.3 Customise Kiosk Theme / Overlay

Configure via Admin Console Settings Tab or SQL:

```sql
UPDATE player_settings SET
  branding = jsonb_build_object(
    'name', 'My Venue Jukebox',
    'logo', 'https://yourdomain.com/logo.png',
    'theme', 'dark'           -- 'dark' or 'light'
  )
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

The Kiosk picks up branding changes in real-time via the Realtime subscription.

---

## 6. The Video Player Webpage

The Player Window runs on **port 5174** and is the media playback engine. It must be open and running at all times for the jukebox to function.

> **Critical**: Keep the Player Window open in a dedicated browser tab or display. It sends a heartbeat every 3 seconds — if the heartbeat stops, all other clients will show "Player offline".

### 6.1 Display Options

#### Player States

| State | Display |
|-------|---------|
| `idle` | Idle screen / logo |
| `loading` | Loading spinner while YouTube video loads |
| `playing` | Full-screen YouTube iframe |
| `paused` | Paused YouTube iframe |
| `error` | Error message with retry option |

#### Debug Overlay

During development, a debug overlay shows:
- **Init status** (initializing → loading_playlist → ready/error)
- **Player state** (idle/playing/paused/loading/error)
- **Current track** (title and artist)
- **Progress** (0–100%)
- **Index** (`now_playing_index` in playlist)
- **Media ID** (first 8 chars of UUID)

Console logs (prefixed `[Player]`) track:
- Initialization steps
- Playlist loading results
- Status updates (state, media_id, index, progress)

#### Auto-Play on Load

The Player auto-initialises on load:
1. Calls `initialize_player_playlist()`
2. Loads "Obie Playlist" (or active playlist) starting from `now_playing_index`
3. Sets state to `loading`, then `playing` as YouTube iframe starts

#### YouTube iframe Integration

The Player uses the YouTube iframe API with autoplay. Videos load by YouTube video ID extracted from the stored URL.

### 6.2 Customise Player Theme / Overlay

Player theming is currently handled via the React component and Tailwind CSS. To customise:

1. Edit `web/player/src/App.tsx`
2. Modify Tailwind classes for the idle/loading/error states
3. Rebuild: `npm run build:player`

For the idle screen overlay, update the branding JSON in player settings:

```sql
UPDATE player_settings SET
  branding = jsonb_build_object(
    'name', 'My Jukebox',
    'logo', 'https://yourdomain.com/logo.png'
  )
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

#### Player Status Reporting

The Player reports status to the server every time:
- A new video starts playing
- Playback state changes (play/pause/end)
- Progress updates (approximately every 5 seconds)

```typescript
// Player calls this on state change:
await callPlayerControl({
  player_id: '...',
  state: 'playing',    // idle | playing | paused | ended | error
  progress: 0.5,       // 0.0 to 1.0
  action: 'update'
});
```

---

## 7. Edge Functions & Scripts

### Available Edge Functions

These run on Supabase (Deno runtime) and handle all business logic:

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `queue-manager` | `POST /functions/v1/queue-manager` | Queue CRUD (add, remove, reorder, next, skip, clear) |
| `player-control` | `POST /functions/v1/player-control` | Status updates, progress, heartbeat |
| `kiosk-handler` | `POST /functions/v1/kiosk-handler` | Search, credit management, song requests |
| `playlist-manager` | `POST /functions/v1/playlist-manager` | Playlist CRUD and YouTube media scraping |

### Testing Edge Functions Locally

```bash
# Test queue-manager: clear queue
curl -X POST http://localhost:54321/functions/v1/queue-manager \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "player_id": "00000000-0000-0000-0000-000000000001",
    "action": "clear"
  }'

# Check player status
curl http://localhost:54321/rest/v1/players \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Available Shell Scripts

The following `.sh` scripts are available in the project root:

#### `setup.sh`
Interactive first-run setup wizard. Configures Supabase, environment files, and seeds initial data.
```bash
./setup.sh
```

#### `populate-playlist.sh`
Import a single YouTube playlist by ID into the database.
```bash
./populate-playlist.sh <YOUTUBE_PLAYLIST_ID>
# Example:
./populate-playlist.sh PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH
```

#### `import-all-playlists.sh`
Batch import multiple YouTube playlists. Playlists are defined inside the script. Includes a 3-second delay between imports to avoid rate limiting.
```bash
./import-all-playlists.sh
```

#### `retry-failed-playlists.sh`
Retry only the playlists that failed during a previous batch import (due to API rate limits). Features automatic YouTube API key rotation.
```bash
./retry-failed-playlists.sh
```

### SQL RPCs Reference

All queue operations use PostgreSQL advisory locks to prevent race conditions:

```sql
-- Add item to queue
SELECT queue_add('player_id', 'media_id', 'normal', 'admin');

-- Remove item
SELECT queue_remove('queue_id');

-- Reorder queue
SELECT queue_reorder('queue_id', new_position);

-- Get next song (priority first, then normal)
SELECT queue_next('player_id');

-- Skip current song
SELECT queue_skip('player_id');

-- Clear queue (all or by type)
SELECT queue_clear('player_id');          -- clear all
SELECT queue_clear('player_id', 'normal'); -- clear only normal queue

-- Kiosk credits
SELECT kiosk_increment_credit('session_id', 1);
SELECT kiosk_decrement_credit('session_id', 1);

-- Keep player online
SELECT player_heartbeat('player_id');

-- Playlist management
SELECT * FROM initialize_player_playlist('player_id');
SELECT * FROM load_playlist('player_id', 'playlist_id', start_index);
SELECT * FROM get_default_playlist('player_id');
```

### Deploy Edge Functions (Production)

```bash
# Deploy all Edge Functions to Supabase Cloud
npm run supabase:deploy

# Or individually:
supabase functions deploy queue-manager
supabase functions deploy player-control
supabase functions deploy kiosk-handler
supabase functions deploy playlist-manager
```

---

## 8. YouTube API Setup

YouTube API access is required for playlist import and (future) search functionality.

### Getting Your API Key

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create or select a project (name it "Obie Jukebox")
3. Enable **YouTube Data API v3**: https://console.cloud.google.com/apis/library/youtube.googleapis.com
4. Click **Create Credentials → API Key**
5. Copy the generated key

**Recommended: Secure your key**
- Under "API restrictions" → Select **YouTube Data API v3** only
- Optionally restrict by HTTP referrer or IP address

### Configure the API Key

**For local development:**
```bash
# Create secrets file for Edge Functions
echo "YOUTUBE_API_KEY=your-api-key-here" > supabase/.env.local

# Restart Supabase to load secrets
supabase stop && supabase start
```

**For production (Supabase Cloud):**
```bash
supabase secrets set YOUTUBE_API_KEY=your-api-key-here
supabase secrets list  # verify
```

### API Key Rotation (For Large Imports)

For large batch imports, the system supports rotating through multiple API keys. Each key has a 10,000 queries/day free quota. With 9 keys, you get 90,000 queries/day — sufficient for all imports.

The `retry-failed-playlists.sh` script includes automatic key rotation logic that:
- Tracks which keys have hit quota (403 errors)
- Automatically switches to the next valid key
- Retries up to 9 times (once per key)
- Resets the failed-keys list when all keys are exhausted

### Rate Limits

| Operation | Queries Used |
|-----------|-------------|
| Fetch single playlist (any size) | ~2–3 queries |
| Fetch single video metadata | 1 query |
| Search (future feature) | 100 queries |
| **Daily free limit (per key)** | **10,000 queries** |

**Tip**: The system caches all media in `media_items` by `source_id`. Re-importing a playlist skips already-cached videos, so re-runs cost very few API queries.

---

## 9. Importing Playlists

### Deduplication

The import system deduplicates automatically: videos appearing in multiple playlists are stored once in `media_items`. The `playlist_items` table links playlists to the shared `media_items` records. In the existing import, 414 duplicates were detected and skipped across 1,909 total items, yielding 1,495 unique videos.

### Method 1 — Import a Single Playlist (Script)

```bash
./populate-playlist.sh <YOUTUBE_PLAYLIST_ID>
```

Find the playlist ID in the YouTube URL after `list=`:
```
https://www.youtube.com/playlist?list=PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       This is your Playlist ID
```

### Method 2 — Batch Import All Playlists (Script)

```bash
./import-all-playlists.sh
```

Edit the script to add/remove playlist IDs before running. Includes 3-second delay between imports.

### Method 3 — Retry Failed Imports

```bash
./retry-failed-playlists.sh
```

Use this after a batch import if some playlists failed due to rate limiting.

### Method 4 — Via Edge Function (API)

```bash
curl -X POST http://localhost:54321/functions/v1/playlist-manager \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "import",
    "youtube_playlist_id": "PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH",
    "player_id": "00000000-0000-0000-0000-000000000001"
  }'
```

### Verifying Imports

```sql
-- Check all playlists with video counts
SELECT
  p.name,
  COUNT(pi.id) AS video_count
FROM playlists p
LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
GROUP BY p.id, p.name
HAVING COUNT(pi.id) > 0
ORDER BY video_count DESC;

-- Total unique videos
SELECT COUNT(*) AS total_unique_videos
FROM media_items
WHERE source_type = 'youtube';

-- Check deduplication
SELECT
  COUNT(*) AS total_playlist_items,
  COUNT(DISTINCT media_item_id) AS unique_media_items
FROM playlist_items;
```

### Notes on Large Playlists

- Playlists over ~100 songs may hit Edge Function worker memory limits during a single import call
- For very large playlists (500+), use the shell scripts which handle pagination
- The "Obie Playlist" (1,217 songs) was imported successfully using the batch script with key rotation

---

## 10. Production Deployment

### Step 1 — Supabase Cloud Project

1. Create project at [database.new](https://database.new)
2. Note your:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon key** (Settings → API)
   - **service_role key** (Settings → API — never expose in frontend)

### Step 2 — Run Migrations

```bash
# Install and login
npm install -g supabase
supabase login

# Link to your cloud project
supabase link --project-ref <your-project-ref>

# Run migrations
supabase db push
```

Or manually paste `supabase/migrations/0001_initial_schema.sql` into the Supabase SQL Editor.

### Step 3 — Enable Realtime

In Supabase dashboard → **Database → Replication**, enable Realtime for all tables:
`players`, `playlists`, `playlist_items`, `media_items`, `queue`, `player_status`, `player_settings`, `kiosk_sessions`, `system_logs`

### Step 4 — Deploy Edge Functions

```bash
npm run supabase:deploy
```

Set YouTube API key:
```bash
supabase secrets set YOUTUBE_API_KEY=your-api-key-here
```

### Step 5 — Deploy Frontends

#### Option A — Vercel (Recommended)

```bash
npm install -g vercel

# Deploy Admin
cd web/admin
echo "VITE_SUPABASE_URL=https://xxxxx.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.production
vercel --prod

# Repeat for Player and Kiosk
```

#### Option B — Netlify

Set build command `npm run build`, publish directory `dist`, and add environment variables in the Netlify dashboard.

#### Option C — Custom Server (nginx)

```bash
npm run build  # builds all three apps

# Copy to server
scp -r web/admin/dist/* user@server:/var/www/admin
scp -r web/player/dist/* user@server:/var/www/player
scp -r web/kiosk/dist/* user@server:/var/www/kiosk
```

Example nginx config:
```nginx
server {
    listen 80;
    server_name admin.jukebox.example.com;
    root /var/www/admin;
    location / { try_files $uri $uri/ /index.html; }
}
# Repeat for player.jukebox.example.com and kiosk.jukebox.example.com
```

### Render.com Deployment

See `RENDER_DEPLOYMENT.md` for Render-specific instructions.

### Production Security Checklist

- [ ] Rotate `service_role` key — never expose in frontend code
- [ ] RLS enabled on all tables (done by migration)
- [ ] CORS configured in Edge Functions
- [ ] HTTPS only
- [ ] Enable 2FA on your Supabase account
- [ ] Add indexes for frequent queries (done by migration)

### Backup & Rollback

```bash
# Backup database
supabase db dump --data-only > backup.sql

# Restore
psql $DATABASE_URL < backup.sql
```

Vercel/Netlify keep deployment history — select a previous deployment and "Promote to Production" to roll back frontends.

---

## 11. Troubleshooting

### "Player offline" in Admin Console

**Cause**: Player Window is not open or has crashed.  
**Fix**: Open http://localhost:5174 (or your deployed Player URL) in a browser tab and keep it open.

### "Insufficient credits" in Kiosk

**Fix A** (dev): Click the "Insert Coin (Dev)" button on the Kiosk.  
**Fix B** (production): Enable free play:
```sql
UPDATE player_settings SET freeplay = true
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

### Edge Functions returning errors

```bash
# Check local logs
supabase functions logs --local

# Test a function directly
curl -X POST http://localhost:54321/functions/v1/queue-manager \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"player_id": "00000000-0000-0000-0000-000000000001", "action": "clear"}'
```

### Realtime not updating

1. Check Realtime is enabled in Supabase Dashboard → Database → Replication
2. Verify RLS policies allow your auth level (anon/authenticated)
3. Open browser DevTools → Console — check for Realtime connection errors

**Check connection status in browser console:**
```typescript
const channel = supabase.channel('test');
channel.subscribe((status) => {
  console.log('Realtime status:', status); // Should be 'SUBSCRIBED'
});
```

### YouTube API: "Quota exceeded"

- Daily quota resets at midnight Pacific Time
- Use `retry-failed-playlists.sh` which rotates API keys automatically
- Each key provides 10,000 queries/day; 9 keys = 90,000/day

### YouTube API: "API not enabled"

1. Go to https://console.cloud.google.com/apis/library/youtube.googleapis.com
2. Click "Enable"
3. Wait a few minutes for propagation

### Player not auto-playing after startup

1. Check browser console for `[Player]` prefixed logs
2. Verify at least one playlist exists with items: `SELECT COUNT(*) FROM playlist_items;`
3. Check the debug overlay on the Player page shows "Init: ready"
4. Ensure `now_playing_index` is valid: `SELECT now_playing_index FROM player_status;`

### CORS errors in Edge Functions

Edit `supabase/functions/_shared/cors.ts` and restrict to your domain:
```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yourdomain.com',
  // ...
};
```

---

## 12. Performance & Free-Tier Compliance

### Current Estimated Monthly Usage

| Resource | Estimated Use | Free Limit | Usage % |
|----------|--------------|------------|---------|
| Edge Function Invocations | ~25,500/month | 500,000 | ✅ 5% |
| CPU Time | ~21 min/month | 50 hours | ✅ 0.7% |
| Bandwidth | ~127 MB/month | 500 GB | ✅ 0.02% |
| Realtime Connections | 3 concurrent | 200 | ✅ 1.5% |
| Database Size | <50 MB | 8 GB | ✅ 0.6% |

**Headroom: ~20× on all free tier limits** 🎉

### Invocation Breakdown

| Source | Rate | Monthly |
|--------|------|---------|
| Songs played (2 calls/song) | 200/day | 400/day |
| Admin actions | ~50/day | 1,500/mo |
| Kiosk requests | ~100/day | 3,000/mo |
| Status updates (every 5 min) | 288/day | 8,600/mo |
| Heartbeats (every 3 sec) | ~10,800/day | ~12,000/mo |

### When to Upgrade to Supabase Pro ($25/month)

- More than 500K Edge Function invocations/month
- More than 200 concurrent Realtime connections
- Database exceeds 8GB
- Estimated cost for moderate usage on Pro: ~$30/month

---

## Quick Reference Card

### URLs

| App | Local | Description |
|-----|-------|-------------|
| Admin Console | http://localhost:5173 | Main control interface |
| Player Window | http://localhost:5174 | Keep open! Media playback |
| Kiosk Interface | http://localhost:5175 | Public song requests |
| Supabase Studio | http://localhost:54323 | Database management |

### Key Commands

```bash
npm run dev              # Start all apps
npm run supabase:start   # Start local Supabase
npm run supabase:reset   # Reset database (destructive)
npm run supabase:deploy  # Deploy Edge Functions
npm run build            # Build all apps for production
supabase functions logs --local  # Watch Edge Function logs
```

### Default Player ID

```
00000000-0000-0000-0000-000000000001
```

This UUID is seeded by the migration and used in all SQL examples.

---

*Obie Jukebox v2 — Server-First, Real-Time, Free-Tier Safe 🎵*
