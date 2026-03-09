# Obie Jukebox — Development Reference (obie-march-26)

**Created:** March 2026
**Purpose:** Development-focused fork of obie-v5 for codebase streamlining and feature development
**Supabase Project:** obie-march-26 (`fcabzrkcsfjimpxxnvco`)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Environment Setup](#3-environment-setup)
4. [Database Schema](#4-database-schema)
5. [Edge Functions](#5-edge-functions)
6. [Frontend Apps](#6-frontend-apps)
7. [Queue Management System — Deep Dive](#7-queue-management-system--deep-dive)
8. [Queue Management Migration Plan](#8-queue-management-migration-plan)
9. [Cloudflare R2 Integration](#9-cloudflare-r2-integration)
10. [Known Issues & Gotchas](#10-known-issues--gotchas)
11. [Development Goals](#11-development-goals)

---

## 1. Project Overview

A **server-first, real-time jukebox system** where all state and business logic runs on Supabase. Three frontend apps (Admin, Player, Kiosk) are thin clients that render data and send commands.

### Key Principles

- **Server-First**: All state and logic in the database, not clients
- **Real-time Sync**: Instant updates via Supabase Realtime WebSocket subscriptions
- **Priority Queue**: Paid kiosk requests play before the normal queue
- **Atomic Operations**: PostgreSQL advisory locks prevent race conditions
- **Position-Based Ordering**: Queue ordered by `position` field per type

### Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Supabase (Postgres + Realtime + Edge Functions) |
| **Frontend** | React 18 + Vite + TypeScript |
| **Styling** | Tailwind CSS |
| **Auth** | Supabase Auth + RLS |
| **Player** | YouTube iframe API + `<video>` element |
| **Media Storage** | Cloudflare R2 (S3-compatible) |

---

## 2. Architecture

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
│  │ • RPCs       │  │                  │  │ • r2-sync              │   │
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

### Layer Responsibilities

| Layer | What it does | Auth model | Can write to queue? |
|-------|-------------|-----------|-------------------|
| **PostgreSQL RPCs** | Atomic queue mutations with advisory locks | `SECURITY DEFINER` (runs as postgres) | Yes — only safe writers |
| **Edge Functions** | Orchestrate RPC calls, check player status, coordinate multi-step ops | `service_role` key (bypasses RLS) | Via RPCs only |
| **Admin web app** | UI for queue management; calls Edge Functions | `anon` key (authenticated) | Via Edge Functions → RPCs |
| **Player web app** | YouTube iframe playback; reports state changes | `anon` key | Indirectly — reports 'ended' to player-control |
| **Kiosk web app** | Public request terminal; calls kiosk-handler | `anon` key | Via kiosk-handler → `kiosk_request_enqueue` RPC |
| **Supabase Realtime** | Broadcasts CDC events from Postgres | WebSocket | Read-only push |

---

## 3. Environment Setup

### Supabase Project Details

- **Project Name:** obie-march-26
- **Project ID:** `fcabzrkcsfjimpxxnvco`
- **Project URL:** `https://fcabzrkcsfjimpxxnvco.supabase.co`

### Environment Variables

The `.env` file (gitignored) contains:

```bash
VITE_SUPABASE_URL=https://fcabzrkcsfjimpxxnvco.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_SUPABASE_SERVICE_KEY=<service_role_key>
```

### Cloudflare R2 (Shared with Production)

R2 credentials are set as Supabase Edge Function secrets (not in `.env`):

```bash
supabase secrets set CLOUDFLARE_R2_ACCESS_KEY_ID=<key>
supabase secrets set CLOUDFLARE_R2_SECRET_ACCESS_KEY=<secret>
supabase secrets set CLOUDFLARE_R2_ENDPOINT=https://7eb14b8d9e89951be03360c3fde3cb42.r2.cloudflarestorage.com
supabase secrets set CLOUDFLARE_R2_BUCKET_NAME=djamms-v1
```

### Quick Start

```bash
npm install
cp .env.example .env   # Edit with your keys
npm run dev             # Starts all 3 apps concurrently

# Admin:  http://localhost:5173
# Player: http://localhost:5174
# Kiosk:  http://localhost:5175
```

---

## 4. Database Schema

### Core Tables (9 tables)

| Table | Purpose |
|-------|---------|
| `players` | Player instances with online status |
| `playlists` | Playlist library |
| `playlist_items` | Songs in playlists |
| `media_items` | Deduplicated media cache |
| `queue` | Unified queue (normal + priority) |
| `player_status` | Live playback state |
| `player_settings` | Configuration |
| `kiosk_sessions` | Session tracking + credits |
| `system_logs` | Event logs |

### Queue Table (Critical)

```sql
CREATE TABLE queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'normal'
                 CHECK (type IN ('normal', 'priority')),
  media_item_id UUID NOT NULL REFERENCES media_items(id),
  position     INT NOT NULL,
  requested_by TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  played_at    TIMESTAMPTZ,       -- NULL = still in queue; SET = consumed
  expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes',
  UNIQUE(player_id, type, position)  -- positions are per-type
);
```

**Key design decisions:**
- `played_at IS NULL` is the "active queue" filter — items are never deleted when played
- Positions are per-type (normal and priority have separate position sequences)
- `UNIQUE(player_id, type, position)` requires atomic position updates during reorder

### Player Status Table

```sql
CREATE TABLE player_status (
  player_id        UUID PRIMARY KEY REFERENCES players(id),
  state            TEXT DEFAULT 'idle'
                     CHECK (state IN ('idle', 'playing', 'paused', 'error', 'loading')),
  progress         FLOAT DEFAULT 0,
  current_media_id UUID REFERENCES media_items(id),  -- What to play
  now_playing_index INT DEFAULT 0,
  queue_head_position INT DEFAULT 0,
  last_updated     TIMESTAMPTZ DEFAULT NOW()
);
```

`current_media_id` is the critical field — when `queue_next` runs, it updates this, and all Realtime subscribers receive the new value.

### SQL RPCs

| RPC | Lock | Purpose |
|-----|------|---------|
| `queue_add()` | Yes | Insert item at next position, check queue limits |
| `queue_remove()` | Yes | Delete item and compact positions |
| `queue_reorder()` | Yes | Update positions from ordered array (2-pass with temp negatives) |
| `queue_reorder_wrapper()` | Via queue_reorder | 3-arg wrapper for PostgreSQL overload resolution |
| `queue_next()` | Yes | Pop next item (priority first), mark played, update player_status |
| `queue_skip()` | Yes | Set player_status.state='idle' |
| `queue_clear()` | Yes | Delete all unplayed items |
| `kiosk_request_enqueue()` | Via queue_add | Atomic: check credits, deduct, enqueue as priority |
| `load_playlist()` | Yes | Clear normal queue, load playlist items |
| `player_heartbeat()` | No | Set status='online', mark stale players 'offline' |

---

## 5. Edge Functions

| Function | Purpose |
|----------|---------|
| `queue-manager` | Queue CRUD: add, remove, reorder, next, skip, clear |
| `player-control` | Player status updates, heartbeat, song endings, calls queue_next |
| `kiosk-handler` | Search (YouTube + R2), credits, song requests |
| `playlist-manager` | Create/update/delete playlists, scrape media from YouTube |
| `youtube-scraper` | YouTube API wrapper with key rotation |
| `r2-sync` | Sync Cloudflare R2 bucket contents to database |
| `download-video` | Download videos via yt-dlp |

### Edge Function → Client Decision Map

```
Client wants to...                           How?
───────────────────────────────────────────────────────────
Add song to queue                       → Edge: queue-manager/add
Remove song from queue                  → Edge: queue-manager/remove
Reorder queue (drag-drop)               → Edge: queue-manager/reorder
Get next song / advance queue           → Edge: player-control/ended
Skip current song (Admin)               → Edge: player-control/skip
Clear queue                             → Edge: queue-manager/clear
Read current queue (initial load)       → Direct DB: supabase.from('queue')
Subscribe to queue changes              → Realtime: subscribeToQueue()
Report playback state (Player)          → Edge: player-control/update
Send heartbeat (Player)                 → Edge: player-control/heartbeat
Request song from Kiosk                 → Edge: kiosk-handler/request
Search YouTube (Kiosk)                  → Edge: kiosk-handler/search
Read player settings                    → Direct DB: supabase.from('player_settings')
Update player settings (Admin)          → Direct DB: supabase.from('player_settings').upsert()
Load playlist into queue                → Direct RPC: load_playlist()
```

---

## 6. Frontend Apps

### File Structure

```
web/
├── shared/
│   ├── supabase-client.ts  # Shared API client, types, Realtime subscriptions
│   ├── types.ts            # Shared TypeScript types
│   ├── media-utils.ts      # Media helper utilities
│   └── keyboard.ts         # Keyboard utilities
├── admin/                  # Admin console (React + Vite)
│   └── src/
│       ├── App.tsx         # Main app with queue UI, controls, playlist mgmt
│       └── lib/api.ts      # Admin-specific API helpers
├── player/                 # Media player (React + Vite)
│   └── src/
│       └── App.tsx         # YouTube iframe + video element, heartbeat, status
└── kiosk/                  # Public kiosk (React + Vite)
    └── src/
        ├── App.tsx         # Main kiosk app
        └── components/     # Search UI, keyboard, result cards
```

---

## 7. Queue Management System — Deep Dive

### Song Lifecycle Flow

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
                       Realtime → Admin UI (800ms debounce) → re-render
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
                    Mark old item played_at=NOW()
                    UPDATE player_status: current_media_id = <new>
                    RETURN { media_item_id, title, url, duration }
                                 │
                   ┌─────────────┴──────────────┐
                   │                            │
                   ▼  Path A (direct)           ▼  Path B (Realtime)
             Player loads video            subscribeToPlayerStatus fires
             from HTTP response            → re-fetch with media JOIN
```

### Two-Path Redundancy

The Player receives "what to play next" through BOTH the direct HTTP response AND the Realtime subscription. A `currentMediaIdRef` guard prevents double-loading.

### Priority Queue Mechanics

- Priority items have their own position sequence (0, 1, 2...) separate from normal items
- `queue_next` uses explicit IF/ELSE branching: if ANY priority item exists, it plays before ANY normal item
- Shuffle does NOT affect priority items — shuffle is applied at playlist load time only

### Skip Architecture

The Admin only sets `state = 'idle'`. The Player detects the state change via Realtime, performs a 2-second fade, then calls `queue_next` itself. This keeps fade logic in the Player.

### Heartbeat & Online Detection

- Player sends heartbeat every 3 seconds via `player_heartbeat()` RPC
- 10 seconds without heartbeat → `status = 'offline'`
- `queue-manager` blocks `add` and `next` when player is offline

### Priority Player Mechanism

Only one player drives queue progression. Multiple player windows use a "priority player" system:
- Priority player: calls `reportEndedAndNext()`, drives queue
- Slave players: mirror display but are silent to the server
- Priority is assigned via `register_session` in player-control

---

## 8. Queue Management Migration Plan

### Confirmed Issues (from Feb 2026 Log Analysis)

| # | Issue | Severity |
|---|-------|----------|
| 1 | Race condition on playlist load (double `load_playlist` at same second) | Critical |
| 3 | Rapid queue_next cycling (14 instances of double-advance) | Critical |
| A | Double queue_next causing silent song skip | Critical |
| 5 | Duplicate song requests (4 songs played twice) | Medium |
| 6 | Priority queue depth growth (position 54 reached) | Medium |
| B | Normal playlist ran near-empty due to 3+ hrs of priority-only | Medium |
| C | Normal playlist reload cycling 12-song loop | Medium |

### Critical Fix: 800ms Debounce (Already Applied)

**Root cause:** Feb 21, 2026 commit removed the debounce in `subscribeToQueue()`, causing race conditions between database updates and UI refresh.

**Fix (in place):**
```typescript
// web/shared/supabase-client.ts — subscribeToQueue()
refetchTimeout = setTimeout(() => {
  fetchQueue();
}, 800); // CRITICAL: Prevents race conditions
```

### Critical Fix: currentQueueItem Lookup (Already Applied)

```typescript
// web/admin/src/App.tsx — MUST use media_item_id, NOT position
const currentQueueItem = queue.find((item) =>
  item.media_item_id === status?.current_media_id
);
```

### Migration Strategy: Queue Reorder (Two-Pass Negative Positions)

The `UNIQUE(player_id, type, position)` constraint requires a two-pass approach:

```sql
-- Pass 1: assign temporary negative positions to avoid conflicts
UPDATE queue SET position = -(i) WHERE id = queue_ids[i];
-- Pass 2: assign final positions
UPDATE queue SET position = (i - 1) WHERE id = queue_ids[i];
```

### Items That MUST NOT Be Changed

1. **800ms debounce** in `subscribeToQueue()` — prevents race conditions
2. **Media ID lookup** for `currentQueueItem` — position-based lookup is unreliable
3. **`queue_next` priority logic** — priority always plays first
4. **PostgreSQL advisory locks** — prevents concurrent corruption
5. **`UNIQUE(player_id, type, position)`** — ensures no duplicate positions
6. **Realtime subscription pattern** — never change to immediate fetch

---

## 9. Cloudflare R2 Integration

### Current State

The `r2-sync` edge function exists and syncs R2 bucket contents to the `r2_files` database table. R2 videos use the `<video>` element (same as yt-dlp downloads) with `source = 'cloudflare'`.

### R2 Environment Variables (Shared)

These are the same Cloudflare R2 credentials as the production project:

- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_ENDPOINT` — `https://7eb14b8d9e89951be03360c3fde3cb42.r2.cloudflarestorage.com`
- `CLOUDFLARE_R2_BUCKET_NAME` — `djamms-v1`

### R2 Integration Plan (from PLAN-cloudflare-v1.md)

1. **Database**: `r2_files` table caches bucket contents; `media_items` supports `source_type = 'cloudflare'`
2. **Player**: Extends source switching — cloudflare uses `<video>` element via `local_url`
3. **Kiosk**: Source toggle (YouTube / R2 Browse) in search interface
4. **Backend**: `r2-sync` edge function + `search_r2`/`request_r2` actions in kiosk-handler

---

## 10. Known Issues & Gotchas

### The 800ms Debounce — Do Not Remove

`queue_reorder` fires one UPDATE event per queue item. A 10-song reorder = 10 events. Without debounce, the Admin UI re-renders with each intermediate state where `currentQueueItem` is undefined.

### Shuffle Is Load-Time, Not Play-Time

When `shuffle = true`, randomization happens in `load_playlist` (at insertion). At play time, `queue_next` uses `position ASC`. Reshuffling after load requires a separate `queue_reorder` call.

### Slave Players Don't Drive Queue

Only the priority player calls `reportEndedAndNext()`. If the priority player closes, `priority_player_id` is NOT automatically cleared. Admin can force-reset via `player-control/reset_priority`.

### `add` Action Requires Player Online

`queue-manager` blocks `add` and `next` when `player.status !== 'online'`. Player marked online by heartbeat (every 3s), offline after 10s timeout.

### `played_at` Is Set by `queue_next`, Never by Clients

Queue items are consumed by `queue_next` setting `played_at = NOW()`. No automatic cleanup of old played items exists.

### Race Condition on Playlist Load

Two simultaneous `load_playlist` calls with different `start_index` values can overwrite each other because `pg_advisory_xact_lock` serializes but does not reject. Both succeed, with the second call overwriting the first.

---

## 11. Development Goals

This fork (`obie-march-26`) was created to:

1. **Streamline the codebase** — Remove unnecessary excess code, legacy files, and dead code paths
2. **Reflect current implementation goals** — Align the codebase with the actual feature set
3. **Safe development environment** — Isolated Supabase project prevents interference with production
4. **Address confirmed issues** — Fix the critical race conditions and queue management bugs
5. **Complete R2 integration** — Finish the Cloudflare R2 video source integration
6. **Improve code quality** — Consistent patterns, better error handling, cleaner architecture

### Files to Consider Removing

- `web/admin_original_copy/` — Duplicate of admin directory
- `REFERENCE-*.html`, `REFERENCE_*.jsx` — Old reference files
- Various standalone test/debug scripts at root level
- `supabase/migrations_backup/` — Migration backups
- Root-level `.sql` files (`check_rls.sql`, `debug_kiosk.sql`, etc.)

### Supabase Migration Strategy

All migrations from the original project need to be applied to the new `obie-march-26` Supabase project:

```bash
supabase link --project-ref fcabzrkcsfjimpxxnvco
supabase db push
supabase functions deploy
```

---

*This document serves as the authoritative development reference for the obie-march-26 project. Update as the codebase evolves.*
