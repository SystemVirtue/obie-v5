# Obie Jukebox — System Overview & Queue Management Deep Dive

**Snapshot date:** February 2026
**Codebase version:** v5-19-11-25
**Purpose:** Authoritative reference for how the queue works, how priority requests are handled, how "now playing" is propagated, and the exact role of each layer.

---

## Table of Contents

1. [Architecture at a Glance](#1-architecture-at-a-glance)
2. [The Role of Each Layer](#2-the-role-of-each-layer)
3. [Database Schema — Queue-Related Tables](#3-database-schema--queue-related-tables)
4. [Queue Management Flowcharts](#4-queue-management-flowcharts)
   - 4a. Admin adds a song
   - 4b. Song ends naturally → next song plays
   - 4c. Admin skips a song
   - 4d. Kiosk user requests a song (priority)
5. [Priority Queue — Exact Mechanics](#5-priority-queue--exact-mechanics)
6. [How "Now Playing" Is Pushed to the Player](#6-how-now-playing-is-pushed-to-the-player)
7. [The Heartbeat & Player Online Detection](#7-the-heartbeat--player-online-detection)
8. [Priority Player Mechanism (Multi-Window)](#8-priority-player-mechanism-multi-window)
9. [Edge Functions vs Direct DB Access — Decision Map](#9-edge-functions-vs-direct-db-access--decision-map)
10. [All Queue RPCs — Reference](#10-all-queue-rpcs--reference)
11. [Critical Constraints & Known Gotchas](#11-critical-constraints--known-gotchas)

---

## 1. Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          SUPABASE (Server)                              │
│                        Single Source of Truth                           │
│                                                                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────┐   │
│  │  PostgreSQL  │  │ Supabase Realtime│  │   Edge Functions       │   │
│  │  Database    │  │   (WebSockets)   │  │   (Deno runtime)       │   │
│  │              │  │                  │  │                        │   │
│  │ • queue      │  │ • queue changes  │  │ • queue-manager        │   │
│  │ • player_    │  │ • player_status  │  │ • player-control       │   │
│  │   status     │  │   changes        │  │ • kiosk-handler        │   │
│  │ • kiosk_     │  │ • settings       │  │ • playlist-manager     │   │
│  │   sessions   │  │   changes        │  │ • youtube-scraper      │   │
│  │ • RPCs       │  │                  │  │                        │   │
│  └──────────────┘  └──────────────────┘  └────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
          │  Realtime                │  REST/HTTP              │  REST/HTTP
          ▼  subscriptions          ▼  Edge Function calls    ▼  Edge Function calls
┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│   ADMIN          │   │   PLAYER             │   │   KIOSK              │
│   (port 5173)    │   │   (port 5174)        │   │   (port 5175)        │
│                  │   │                      │   │                      │
│ • Queue CRUD UI  │   │ • YouTube iframe     │   │ • Song search        │
│ • Drag-drop      │   │ • Realtime status    │   │ • Credit system      │
│   reorder        │   │   subscriber         │   │ • Priority requests  │
│ • Skip / Clear   │   │ • Reports ended/skip │   │ • Coin acceptor      │
│ • Playlist mgmt  │   │ • Sends heartbeat    │   │                      │
│ • Settings       │   │ • Fade transitions   │   │                      │
└──────────────────┘   └──────────────────────┘   └──────────────────────┘
```

**Key principle:** No client holds queue state. The queue lives entirely in the `queue` table. Clients subscribe to Realtime changes and re-read from the database when changes occur.

---

## 2. The Role of Each Layer

| Layer | What it does | Auth model | Can write to queue? |
|-------|-------------|-----------|-------------------|
| **PostgreSQL RPCs** | Atomic queue mutations with advisory locks | `SECURITY DEFINER` (runs as postgres) | Yes — these are the only safe writers |
| **Edge Functions** | Orchestrate RPC calls, check player status, coordinate multi-step operations | `service_role` key (bypasses RLS) | Via RPCs only |
| **Admin web app** | UI for queue management; calls Edge Functions | `anon` key (authenticated user) | Via Edge Functions → RPCs |
| **Player web app** | YouTube iframe playback; reports state changes | `anon` key | Indirectly — reports 'ended' to player-control which calls queue_next |
| **Kiosk web app** | Public request terminal; calls kiosk-handler | `anon` key | Via kiosk-handler Edge Function → `kiosk_request_enqueue` RPC |
| **Supabase Realtime** | Broadcasts CDC (Change Data Capture) events from Postgres | WebSocket subscription | Read-only push |

### Why Edge Functions instead of direct DB calls from the client?

Edge Functions run server-side using the `service_role` key, which bypasses Row Level Security. This is necessary for:
- Operations that span multiple tables atomically
- Actions that should work even when the calling client is anonymous (kiosk, player)
- Preventing clients from calling RPCs directly with arbitrary parameters

---

## 3. Database Schema — Queue-Related Tables

### `queue` table

```sql
CREATE TABLE queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'normal'
                 CHECK (type IN ('normal', 'priority')),
  media_item_id UUID NOT NULL REFERENCES media_items(id),
  position     INT NOT NULL,
  requested_by TEXT,              -- 'admin', 'playlist', or kiosk session_id
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  played_at    TIMESTAMPTZ,       -- NULL = still in queue; SET = consumed
  expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes',
  UNIQUE(player_id, type, position)  -- positions are per-type
);
```

**Critical design decisions:**
- `played_at IS NULL` is the "active queue" filter. Items are never deleted when played — they are marked with `played_at = NOW()`. This creates a full audit trail.
- Positions are **per-type** (normal and priority have separate position sequences starting at 0).
- The `UNIQUE(player_id, type, position)` constraint is what causes the reorder complexity — all positions must be updated atomically or unique constraint violations occur.
- A composite index on `(player_id, type, position) WHERE played_at IS NULL` makes queue reads fast.

### `player_status` table

```sql
CREATE TABLE player_status (
  player_id        UUID PRIMARY KEY REFERENCES players(id),
  state            TEXT DEFAULT 'idle'
                     CHECK (state IN ('idle', 'playing', 'paused', 'error', 'loading')),
  progress         FLOAT DEFAULT 0,
  current_media_id UUID REFERENCES media_items(id),  -- ← THIS is how Player knows what to play
  now_playing_index INT DEFAULT 0,
  queue_head_position INT DEFAULT 0,
  last_updated     TIMESTAMPTZ DEFAULT NOW()
);
```

**`current_media_id` is the critical field.** When `queue_next` runs, it updates `current_media_id` in this row. All players subscribed to Realtime on this table immediately receive the new value and load the corresponding YouTube video.

### `players` table (online detection)

```sql
CREATE TABLE players (
  id                  UUID PRIMARY KEY,
  status              TEXT DEFAULT 'offline' CHECK (status IN ('offline', 'online', 'error')),
  last_heartbeat      TIMESTAMPTZ DEFAULT NOW(),
  priority_player_id  UUID,   -- added in migration 0025 / 20251110120000
  ...
);
```

---

## 4. Queue Management Flowcharts

### 4a. Admin Adds a Song to the Queue

```
ADMIN UI (web/admin/src/App.tsx)
  │
  │  User clicks "Add to Queue" on a media item
  │
  ▼
callQueueManager({ action: 'add', player_id, media_item_id, type: 'normal' })
  [web/shared/supabase-client.ts → supabase.functions.invoke('queue-manager')]
  │
  │  HTTP POST to /functions/v1/queue-manager
  │
  ▼
queue-manager Edge Function (supabase/functions/queue-manager/index.ts)
  │
  ├─ Check: player exists?              → 404 if not
  ├─ Check: player.status === 'online'? → 400 "Player is offline" (only for 'add' and 'next' actions)
  │
  ▼
supabase.rpc('queue_add', { p_player_id, p_media_item_id, p_type, p_requested_by })
  │
  ▼
queue_add() PostgreSQL RPC (migrations/0001_initial_schema.sql:151)
  │
  ├─ ACQUIRE pg_advisory_xact_lock('queue_<player_id>')
  ├─ CHECK: current count < max_queue_size (from player_settings) → RAISE EXCEPTION if full
  ├─ CALCULATE next position: SELECT MAX(position) + 1 FROM queue WHERE type = p_type
  ├─ INSERT INTO queue (...) RETURNING id
  ├─ INSERT INTO system_logs ('queue_add')
  └─ RETURN queue_id
  │
  ▼  (Postgres writes to queue table)
  │
  ▼  (Supabase Realtime detects INSERT on queue table)
  │
  ┌───────────────────────────────────────┐
  │  Realtime broadcasts to all           │
  │  subscribers of queue table for       │
  │  this player_id                       │
  └───────────────────────────────────────┘
        │                         │
        ▼                         ▼
  ADMIN UI                  Any other subscriber
  subscribeToQueue()        (currently only Admin)
  receives change
        │
        ▼
  800ms debounce timeout fires
  (web/shared/supabase-client.ts:323)
        │
        ▼
  Re-fetch full queue from DB:
  SELECT * FROM queue
  WHERE player_id = ? AND played_at IS NULL
  ORDER BY type DESC, position ASC
        │
        ▼
  Admin UI re-renders queue display
```

**Why the 800ms debounce?**
When `queue_reorder` runs, it fires N individual UPDATE events on the queue table (one per item). Without debounce, the Admin UI would re-render N times, with each intermediate render seeing a partially-reordered queue. The 800ms window ensures all position updates complete before the UI re-reads.

---

### 4b. Song Ends Naturally → Next Song Plays

This is the core playback loop.

```
PLAYER (web/player/src/App.tsx)
  │
  │  YouTube IFrame API fires onStateChange(0) = ENDED
  │
  ▼
onPlayerStateChange() handler
  └─ calls reportEndedAndNext(isSkip=false)
  │
  ▼
reportEndedAndNext() [player/App.tsx:176]
  │
  │  No fade for natural end (fade only on skip)
  │
  ▼
callPlayerControl({ player_id, state: 'idle', progress: 1, action: 'ended' })
  [web/shared/supabase-client.ts → supabase.functions.invoke('player-control')]
  │
  │  HTTP POST to /functions/v1/player-control
  │
  ▼
player-control Edge Function (supabase/functions/player-control/index.ts)
  │
  ├─ action === 'ended' or state === 'idle'
  ├─ CHECK: is this the priority player?
  │    SELECT priority_player_id FROM players WHERE id = player_id
  │    If priority_player_id !== player_id → return { success: false, reason: 'not_priority_player' }
  │
  ├─ UPDATE player_status SET state='idle', progress=1, last_updated=NOW()
  │
  ▼
supabase.rpc('queue_next', { p_player_id })
  │
  ▼
queue_next() PostgreSQL RPC  ← IMPORTANT: uses LATEST version from
  (migrations/20251109233222_fix_playlist_loading_priority.sql:105)
  │
  ├─ ACQUIRE pg_advisory_xact_lock('queue_<player_id>')
  │
  ├─ CHECK: any priority items (type='priority', played_at IS NULL)?
  │    YES → SELECT first priority item by position ASC
  │    NO  → SELECT first normal item by position ASC
  │
  ├─ If no item found → return empty result set (queue empty)
  │
  ├─ UPDATE queue SET played_at = NOW()  ← "consume" the item
  │
  ├─ UPDATE player_status SET
  │    current_media_id = <new media_item_id>,    ← KEY: this triggers Realtime
  │    state = 'loading',
  │    progress = 0,
  │    now_playing_index += 1 (if normal item),
  │    last_updated = NOW()
  │
  ├─ INSERT INTO system_logs ('queue_next')
  │
  └─ RETURN media_items WHERE id = v_next_queue_item.media_item_id
  │        (returns: media_item_id, title, url, duration)
  │
  ▼  (Two simultaneous things happen now)
  │
  ├─────────────────────────────────────────────────────┐
  │                                                     │
  ▼  Path A: Direct response                           ▼  Path B: Realtime broadcast
  │                                                     │
  player-control returns                         Postgres change on
  { next_item: { media_item_id,                 player_status table
    title, url, duration } }                    is broadcast to all
  │                                             Realtime subscribers
  ▼                                                     │
  Player receives next_item in response           ┌─────┴──────┐
  and immediately calls:                          │            │
  setCurrentMedia(nextMedia)                    ADMIN       PLAYER
  [player/App.tsx:228]                          UI          subscribeToPlayerStatus()
  │                                             updates     re-fetches player_status
  ▼                                             "now        with media join
  React state update → useEffect fires          playing"    │
  [player/App.tsx:704]                          display     ▼
  │                                                     callback(newStatus)
  ▼                                                     with current_media
  Extract YouTube ID from url                          │
  Call playerRef.current.loadVideoById(youtubeId)      ▼
  setTimeout 500ms → playVideo()               If newStatus.current_media_id
                                               !== currentMediaIdRef.current
                                               → setCurrentMedia(newMedia)
                                               (Player also loads from here
                                                if it missed the direct response)
```

**Two-path redundancy:** The Player gets the next song via BOTH the direct HTTP response AND the Realtime subscription. The `currentMediaIdRef` guard (`if (newMediaId !== oldMediaId)`) prevents double-loading.

---

### 4c. Admin Skips the Current Song

```
ADMIN UI
  │
  │  User clicks "Skip" button
  │
  ▼
callPlayerControl({ player_id, action: 'skip' })
  │
  ▼
player-control Edge Function
  │
  ├─ action === 'skip' with state === 'idle'
  ├─ CHECK: is this the priority player? (same guard as 'ended')
  ├─ UPDATE player_status SET state='idle', progress=0
  └─ return { success: true, skip_pending: true }
        ← NOTE: does NOT call queue_next here
        ← The Player detects the state change and handles the skip
  │
  ▼  (player_status UPDATE triggers Realtime)
  │
  ▼
PLAYER subscribeToPlayerStatus() receives change
  │
  ├─ prevState was 'playing' or 'paused'
  ├─ newState is 'idle'
  └─ → "Skip detected from Admin - triggering fade and skip"
       [player/App.tsx:511]
  │
  ▼
reportEndedAndNext(isSkip=true)
  │
  ├─ await fadeOut()    ← 2-second volume+opacity fade at 60fps
  ├─ callPlayerControl({ action: 'ended', state: 'idle' })
  │     ↑ this uses action='ended' (not 'skip') so queue_next is triggered
  └─ [same as Path A above from here]
```

**Skip architecture:** The Admin only sets `state = 'idle'`. It does NOT call `queue_next`. The Player detects the state change, performs the fade, then calls `queue_next` itself. This keeps the fade logic entirely in the Player and ensures the visual transition is clean before the next song loads.

---

### 4d. Kiosk User Requests a Song (Priority)

```
KIOSK (web/kiosk/src/App.tsx)
  │
  │  User searches → selects a song → clicks "Request"
  │
  ▼
callKioskHandler({ action: 'request', session_id, media_item_id, player_id })
  [web/shared/supabase-client.ts:494 — direct fetch() with anon key]
  │
  │  HTTP POST to /functions/v1/kiosk-handler
  │
  ▼
kiosk-handler Edge Function (supabase/functions/kiosk-handler/index.ts)
  │
  ├─ If url provided (no media_item_id):
  │    Forward to youtube-scraper Edge Function
  │    Get/create media_item in media_items table
  │
  ├─ Call supabase.rpc('kiosk_request_enqueue', { p_session_id, p_media_item_id })
  │
  ▼
kiosk_request_enqueue() PostgreSQL RPC
  │
  ├─ ACQUIRE advisory lock
  ├─ Fetch session from kiosk_sessions
  ├─ Fetch freeplay setting from player_settings
  ├─ If NOT freeplay:
  │    CHECK credits >= coin_per_song → RAISE EXCEPTION 'Insufficient credits' if not
  │    DEDUCT credits: UPDATE kiosk_sessions SET credits = credits - coin_per_song
  ├─ Call queue_add(player_id, media_item_id, type='PRIORITY', requested_by=session_id)
  └─ RETURN queue_id
  │
  ▼
kiosk-handler logs to system_logs and returns { queue_id }
  │
  ▼  (queue INSERT triggers Realtime on queue table)
  │
  ▼
ADMIN UI subscribeToQueue() → 800ms debounce → re-fetch
  └─ Queue now shows new priority item at top with "⭐ Priority" badge
  │
  ▼  (When current song ends or is skipped)
  │
  ▼
queue_next() RPC checks: priority items exist?
  └─ YES → priority item plays BEFORE any normal queue items
```

---

## 5. Priority Queue — Exact Mechanics

### How priority items play first

The `queue_next` RPC (latest version, `20251109233222_fix_playlist_loading_priority.sql`) uses **explicit IF/ELSE branching**, not just ORDER BY:

```sql
-- Always prioritize priority items first
IF EXISTS (
  SELECT 1 FROM queue
  WHERE player_id = p_player_id
    AND type = 'priority'
    AND played_at IS NULL
) THEN
  -- Priority items exist — pick first by position
  SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
  FROM queue q
  WHERE q.player_id = p_player_id
    AND q.type = 'priority'
    AND q.played_at IS NULL
  ORDER BY q.position ASC
  LIMIT 1;
ELSE
  -- No priority — pick first normal by position
  SELECT q.id, q.media_item_id, q.type INTO v_next_queue_item
  FROM queue q
  WHERE q.player_id = p_player_id
    AND q.type = 'normal'
    AND q.played_at IS NULL
  ORDER BY q.position ASC
  LIMIT 1;
END IF;
```

**Guarantee:** As long as ANY priority item exists in the queue, no normal item will play. Priority items drain completely before normal playback resumes.

### Priority position is independent

Priority items have their own position sequence (0, 1, 2...) separate from normal items. Multiple priority requests from different kiosk users queue up in insertion order.

### Shuffle does NOT affect priority items

Shuffle (when enabled) is applied at **playlist load time** (`load_playlist` RPC randomizes the order before inserting items). At play time, `queue_next` always uses `position ASC` within each type. This means:
- Shuffle reorders how normal songs are loaded into the queue
- Once in the queue, normal items play in position order
- Priority items always play in request order, never shuffled

### Visual representation in Admin UI

```
QUEUE (as seen in Admin, type DESC → position ASC):

  [priority, pos=0]  ⭐ "Bohemian Rhapsody" (requested by kiosk session abc)  ← plays next
  [priority, pos=1]  ⭐ "Hotel California"  (requested by kiosk session xyz)
  [normal,   pos=0]  "Take On Me"    (from playlist)
  [normal,   pos=1]  "Sweet Caroline" (from playlist)
  [normal,   pos=2]  "Mr. Brightside" (from playlist)
```

The Admin UI orders by `type DESC, position ASC` — which sorts 'priority' before 'normal' (p > n alphabetically in DESC).

---

## 6. How "Now Playing" Is Pushed to the Player

The central mechanism is **`player_status.current_media_id`** updated by `queue_next`, combined with **Supabase Realtime**.

```
                    ┌─────────────────────────────────┐
                    │  player_status table (Postgres)  │
                    │                                  │
                    │  current_media_id: <uuid>        │◄── queue_next() writes here
                    │  state: 'loading'                │
                    │  last_updated: <now>             │
                    └─────────────────┬───────────────┘
                                      │
                                      │  Supabase Realtime CDC
                                      │  (postgres_changes event)
                                      ▼
                    ┌─────────────────────────────────┐
                    │  subscribeToPlayerStatus()       │
                    │  (web/shared/supabase-client.ts) │
                    │                                  │
                    │  On change:                      │
                    │   re-fetch player_status with    │
                    │   media_items JOIN               │
                    │  → callback(fullStatus)          │
                    └─────────┬───────────────────────┘
                              │
                    ┌─────────┴──────────────┐
                    │                        │
                    ▼                        ▼
              PLAYER uses it           ADMIN uses it
              to load video            to show "Now Playing"
```

### Why `subscribeToPlayerStatus` re-fetches instead of using the payload

The Realtime CDC payload does NOT include joined/related data. When `player_status` changes, the subscription fires with the raw row (which only has `current_media_id` as a UUID, not the full `media_items` object). The callback immediately re-fetches with:

```javascript
supabase
  .from('player_status')
  .select('*, current_media:media_items(*)')  // JOIN for full media details
  .eq('player_id', playerId)
  .single()
```

This gives the Player (and Admin) the complete `MediaItem` object (title, url, thumbnail, etc.) in a single roundtrip.

### The Two Notification Paths (redundancy)

The Player receives "what to play next" through TWO independent paths:

| Path | Source | When it fires |
|------|--------|--------------|
| **A: Direct HTTP response** | `player-control` edge function returns `{ next_item }` | Immediately after `reportEndedAndNext()` |
| **B: Realtime subscription** | `player_status` CDC event from `queue_next` UPDATE | ~50-200ms later (Realtime latency) |

The guard in the Player prevents double-loading:
```javascript
// In subscribeToPlayerStatus callback:
if (newMediaId && newMediaId !== currentMediaIdRef.current) {
  setCurrentMedia(newStatus.current_media || null);
}
```

`currentMediaIdRef` is updated when Path A fires. By the time Path B arrives, `newMediaId === currentMediaIdRef.current` → no-op.

---

## 7. The Heartbeat & Player Online Detection

The queue-manager Edge Function blocks `add` and `next` actions when the player is offline, preventing songs from being added to a queue that nobody is playing.

```
PLAYER (every 3 seconds)
  │
  │  setInterval → callPlayerControl({ action: 'heartbeat' })
  │
  ▼
player-control Edge Function
  │
  ▼
supabase.rpc('player_heartbeat', { p_player_id })
  │
  ▼
player_heartbeat() RPC (migrations/0001_initial_schema.sql:437)
  │
  ├─ UPDATE players SET status='online', last_heartbeat=NOW() WHERE id=p_player_id
  │
  └─ UPDATE players SET status='offline'
       WHERE id != p_player_id              ← marks OTHER players offline
         AND status = 'online'
         AND last_heartbeat < NOW() - INTERVAL '10 seconds'
```

**Threshold:** 10 seconds without a heartbeat → `status = 'offline'`.
**Heartbeat interval:** Every 3 seconds (set in Player app).
**Safety margin:** 3 missed heartbeats (9 seconds) before offline.

---

## 8. Priority Player Mechanism (Multi-Window)

Because the jukebox might run with multiple Player browser windows open (e.g., testing, second screen), only ONE player should call `queue_next` when a song ends. This is the "priority player" system.

```
Player window opens
  │
  ▼
initializePlayerPlaylist() → loads default playlist
  │
  ▼
callPlayerControl({ action: 'register_session', session_id, stored_player_id })
  │
  ▼
player-control Edge Function — register_session logic:
  │
  ├─ If stored_player_id === player_id (was previously priority):
  │    UPDATE players SET priority_player_id = player_id
  │    → return { is_priority: true, restored: true }
  │
  ├─ Else if no priority_player_id currently set:
  │    If no players currently 'playing':
  │      SET priority_player_id = this player_id
  │      → return { is_priority: true }
  │    Else:
  │      → return { is_priority: false }  ← becomes slave
  │
  └─ Else (priority already set by another player):
       → return { is_priority: false }  ← becomes slave
  │
  ▼
Player stores result in React state:
  setIsSlavePlayer(!sessionResult.is_priority)

If priority: localStorage.setItem('obie_priority_player_id', PLAYER_ID)
  │
  ▼
Slave players:
  - Do NOT call reportStatus() [player/App.tsx:157]
  - Do NOT call reportEndedAndNext() [player/App.tsx:179]
  - Display "SLAVE" watermark overlay [player/App.tsx:918]
  - Still subscribe to player_status (they display the same video)
  - Still subscribe to player_settings (for karaoke mode, etc.)
```

**Effect:** Only the priority player drives queue progression. Slave players mirror the display but are silent from the server's perspective.

---

## 9. Edge Functions vs Direct DB Access — Decision Map

```
Client wants to...                           How?
─────────────────────────────────────────────────────────────────────────────
Add song to queue                       → Edge Function: queue-manager/add
                                          (needs service_role, online check)

Remove song from queue                  → Edge Function: queue-manager/remove

Reorder queue (drag-drop)               → Edge Function: queue-manager/reorder
  If > 50 items:                          (shortcut) Direct RPC: queue_reorder_wrapper
                                          (avoids large Edge Function payload)

Get next song / advance queue           → Edge Function: queue-manager/next
                                          (OR player-control/ended — preferred)

Skip current song (Admin)               → Edge Function: player-control/skip
                                          (updates state='idle', Player handles rest)

Clear queue                             → Edge Function: queue-manager/clear

Read current queue (initial load)       → Direct DB: supabase.from('queue').select(...)

Subscribe to queue changes              → Realtime: subscribeToQueue()
                                          (re-fetches on change, 800ms debounce)

Report playback state (Player)          → Edge Function: player-control/update|ended

Send heartbeat (Player)                 → Edge Function: player-control/heartbeat

Request song from Kiosk                 → Edge Function: kiosk-handler/request
                                          (atomic debit+enqueue via service_role)

Search YouTube (Kiosk)                  → Edge Function: kiosk-handler/search
                                          → kiosk-handler calls youtube-scraper
                                          (API key rotation, server-side)

Read player settings                    → Direct DB: supabase.from('player_settings')

Update player settings (Admin)          → Direct DB: supabase.from('player_settings').upsert()

Load playlist into queue                → Direct RPC: load_playlist()
                                          (or via playlist-manager/load_active)
```

**Pattern:** Mutations that change queue state always go through Edge Functions → RPCs (for advisory locking). Read operations go direct to DB. Subscriptions use Realtime.

---

## 10. All Queue RPCs — Reference

| RPC | Location | Lock | Purpose |
|-----|----------|------|---------|
| `queue_add(player_id, media_item_id, type, requested_by)` | 0001_initial_schema.sql | Yes | Insert item at next position. Checks queue limits. |
| `queue_remove(queue_id)` | 0001_initial_schema.sql | Yes | Delete item and compact positions. |
| `queue_reorder(player_id, queue_ids[], type)` | 0018 + 0022 + 0023 | Yes | Update positions from ordered array. Uses temp negative positions to avoid UNIQUE constraint conflicts. |
| `queue_reorder_wrapper(player_id, queue_ids[], type)` | 0019 + 20251109153923 | Via queue_reorder | Unambiguous 3-arg wrapper to avoid PostgreSQL overload resolution issues. |
| `queue_next(player_id)` | **20251109233222** (overrides 0001) | Yes | Pop next item (priority first), mark played, update player_status. |
| `queue_skip(player_id)` | 0001_initial_schema.sql | Yes | Set player_status.state='idle'. Player detects and calls queue_next. |
| `queue_clear(player_id, type?)` | 0001_initial_schema.sql | Yes | Delete all unplayed items, optionally filtered by type. |
| `kiosk_request_enqueue(session_id, media_item_id)` | (in kiosk migrations) | Via queue_add | Atomic: check credits, deduct, call queue_add as priority. |
| `load_playlist(player_id, playlist_id, start_index)` | 20251109233222 | Yes | Clear normal queue, load playlist items, set current_media_id. |
| `player_heartbeat(player_id)` | 0001_initial_schema.sql | No | Set status='online', mark stale players 'offline'. |

**Note on `queue_next` version:** The initial schema (0001) had shuffle logic inside `queue_next` itself. Migration `20251109233222` completely replaced this with a simpler, more correct version that:
1. Always checks priority first (no shuffle exception)
2. Uses shuffle only at load time (when filling the queue)
3. Advances `now_playing_index` correctly

**The version in `20251109233222_fix_playlist_loading_priority.sql` is the active version.**

---

## 11. Critical Constraints & Known Gotchas

### ⚠️ The 800ms Debounce — Do Not Remove

```javascript
// web/shared/supabase-client.ts:322
refetchTimeout = setTimeout(() => {
  fetchQueue();
}, 800); // Increased to 800ms to ensure all position updates complete
```

`queue_reorder` fires one `UPDATE` event per queue item on the Realtime channel. A 10-song reorder = 10 events in rapid succession. Removing this debounce causes the Admin UI to re-render with each intermediate state, where `currentQueueItem` cannot be found (its position temporarily collides with another item). This was the root cause of the February 2026 race condition bug.

### ⚠️ `queue_reorder` — The UNIQUE Constraint Problem

The `UNIQUE(player_id, type, position)` constraint means you cannot simply update positions in order — you'd get a conflict if position 3 is being moved to position 2 while position 2 still exists. Migration `0018_fix_queue_reorder_full_update.sql` solved this by using a two-pass approach with temporary negative positions:

```sql
-- Pass 1: assign temporary negative positions to avoid conflicts
UPDATE queue SET position = -(i) WHERE id = queue_ids[i];
-- Pass 2: assign final positions
UPDATE queue SET position = (i - 1) WHERE id = queue_ids[i];
```

### ⚠️ Shuffle Is Load-Time, Not Play-Time

When `shuffle = true` in `player_settings`, the randomization happens in `load_playlist` (when songs are inserted into the queue). At play time, `queue_next` still picks by `position ASC` — it just happens to be a pre-randomized order. This means:
- Shuffling the queue after it's been loaded requires a separate `queue_reorder` call with a random order
- The Player's `shuffleOnLoad` effect in `App.tsx:451` handles this for initial load

### ⚠️ Slave Players Don't Drive Queue Progression

Only the priority player calls `reportEndedAndNext()`. If the priority player window is closed, `priority_player_id` is NOT automatically cleared (no disconnect hook). The next player to open may or may not claim priority depending on its `localStorage.obie_priority_player_id` value and whether any other players are currently playing. Admin can force-reset via `player-control/reset_priority`.

### ⚠️ `add` action requires player online

The queue-manager Edge Function blocks `add` and `next` when `player.status !== 'online'`. The player is marked online by heartbeat (every 3s) and offline if no heartbeat for 10s. If the Player window is closed, songs cannot be added to the queue from Admin or Kiosk.

### ⚠️ `played_at` is set by `queue_next`, never by clients

Queue items are "consumed" by `queue_next` setting `played_at = NOW()`. Clients never directly update `played_at`. This means:
- "Active queue" is always `WHERE played_at IS NULL`
- Played items remain in the table as history (useful for logs/audit but can grow large)
- There is no automatic cleanup (expired items are identified by `expires_at` but no scheduled job removes them)

---

## Summary Flow Diagram (Full Lifecycle)

```
KIOSK: Insert coin          ADMIN: Add from playlist   KIOSK: Search & select
    │                            │                           │
    ▼                            ▼                           ▼
kiosk-handler               queue-manager               kiosk-handler
'credit' action             'add' action                'request' action
    │                            │                           │
    │                            ▼                           │
    │                     queue_add() RPC                    │
    │                     type='normal'                      │
    │                            │                    kiosk_request_enqueue() RPC
    │                            │                    (debit credits, then)
    │                            │                    queue_add() type='priority'
    │                            │                           │
    └────────────────────────────┴───────────────────────────┘
                                 │
                                 ▼
                       queue table INSERT
                                 │
                                 ▼
                       Realtime → Admin UI 800ms debounce → re-render
                                 │
                                 │  (when current song ends)
                                 ▼
                    PLAYER: YouTube ENDED event
                          │
                          ▼
               player-control 'ended' action
                          │
                          ▼
                    queue_next() RPC
                    ┌─────────────────────────────┐
                    │ priority items? → YES        │
                    │   pick first priority        │
                    │ priority items? → NO         │
                    │   pick first normal          │
                    └────────────┬────────────────┘
                                 │
                                 ▼
                    ┌── Mark old item played_at=NOW()
                    │
                    ├── UPDATE player_status:
                    │     current_media_id = <new>
                    │     state = 'loading'
                    │
                    └── RETURN { media_item_id, title, url, duration }
                                 │
                   ┌─────────────┴──────────────┐
                   │                            │
                   ▼  Path A (direct)           ▼  Path B (Realtime)
             Player loads              subscribeToPlayerStatus fires
             video immediately         → re-fetch with media JOIN
             from HTTP response        → Player + Admin both update
                   │
                   ▼
           YouTube loadVideoById(id)
           + playVideo() after 500ms
                   │
                   ▼
           YouTube PLAYING event → reportStatus('playing')
           player-control 'update' → player_status.state = 'playing'
                   │
                   ▼
           Realtime → Admin "Now Playing" display updates
                   │
                   ▼
           [loop back to ENDED event when song finishes]
```
