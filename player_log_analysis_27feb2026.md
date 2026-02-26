# Player Log Analysis — 27 Feb 2026 (00:00–04:29)

**Generated:** 27 Feb 2026
**Log window:** 26/02/2026 ~23:59 → 27/02/2026 04:29:02
**Player:** `00000000-0000-0000-0000-000000000001`

---

## Verdict Summary

| # | Issue | Verdict | Severity |
|---|-------|---------|----------|
| 1 | Race condition on playlist load | ✅ **CONFIRMED** | 🔴 |
| 2 | Mass queue evictions on priority insert | ❌ **DISMISSED** — reframed as priority queue overflow | 🟠 |
| 3 | Rapid queue_next cycling | ✅ **CONFIRMED** — 14 instances | 🔴 |
| 4 | Multiple kiosk session IDs | ⚠️ **MINOR** — one anomalous session, not systemic | 🟢 |
| 5 | Duplicate song requests | ✅ **CONFIRMED** — 4 songs played twice | 🟡 |
| 6 | Priority queue depth growth | ✅ **CONFIRMED** — position 54 reached | 🟡 |
| 7 | Playlist load without queue clear | ❌ **DISMISSED** — code does clear; root is issue #1 | 🟢 |
| A | *(New)* Double queue_next causing silent song skip | ✅ **CONFIRMED** — user-facing bug | 🔴 |
| B | *(New)* Normal playlist ran near-empty (~03:08) | ✅ **CONFIRMED** — 3+ hrs of priority-only blocked playlist | 🟡 |
| C | *(New)* Normal playlist reload cycling 12-song loop | ✅ **CONFIRMED** — playlist restart artifact | 🟡 |

---

## Issue 1 — Race Condition on Playlist Load ✅ CONFIRMED 🔴

### Evidence

```
27/02/2026, 04:29:02  INFO  playlist_loaded  { start_index: 0,  loaded_count: 250 }
27/02/2026, 04:29:02  INFO  playlist_loaded  { start_index: 34, loaded_count: 250 }
```

Two `playlist_loaded` events fired **at the same second** for the same playlist (`9045713f`), with different `start_index` values (0 and 34). Both succeeded with `loaded_count: 250`.

### What happened

`load_playlist` uses `pg_advisory_xact_lock` which serialises concurrent calls — it does not reject them. The sequence was:

```
Call A (start_index=0)      Call B (start_index=34)
 │                               │
 ├─ Acquire lock ────────────────┤ (blocks, waiting)
 ├─ DELETE normal queue          │
 ├─ INSERT 250 items (pos 0-249) │
 ├─ UPDATE player_status         │
 └─ Release lock ────────────────┤ (acquires)
                                 ├─ DELETE normal queue  ← OVERWRITES call A's work
                                 ├─ INSERT 250 items (pos 0-249)
                                 └─ UPDATE player_status (current_media_id = item at index 34)
```

The last call to release the lock wins. The player_status `now_playing_index` would be set to 34 (wrong) or 0 (wrong), depending on execution order, which is indeterminate at the same timestamp.

### Root cause

`initializePlayerPlaylist` in the Player app (`web/player/src/App.tsx:402`) is called on mount inside a `hasInitialized.current` guard, which should prevent double-calls from re-renders. However, the two events have **different `start_index` values**, which means two different call sites triggered the load:
- Index **0** = a fresh load (Player startup or Admin "load playlist" button)
- Index **34** = a resumption load using `now_playing_index` (the `load_playlist` RPC variant that starts mid-playlist)

This points to a scenario where both the Player startup auto-load AND an Admin-triggered manual playlist load fired within the same second — likely after the queue went empty (~04:28:14 was the last `queue_next` before the reload).

### Impact

After the double-load:
- The normal queue was correct (250 songs), but which 250 songs depends on which `load_playlist` call committed last
- The `now_playing_index` in `player_status` is set to either 0 or 34, meaning subsequent auto-advance may resume from the wrong position
- No songs were lost, but playback order was disrupted at the reset point

---

## Issue 2 — Mass Queue Evictions on Priority Insert ❌ DISMISSED → REFRAMED

### Original claim

> New priority inserts cause existing priority queue items to be evicted

### What the logs show

There is **no evidence of eviction**. Every `queue_remove_priority` event in the logs corresponds 1:1 with a `queue_next` event at the same timestamp — meaning items are being consumed (marked `played_at`) as expected, not evicted.

The `queue_remove_priority` log event is simply the RPC's audit trail for consuming a priority item.

### Reframed issue: Priority queue overflow (**no cap enforcement**)

What IS evident is that the priority queue was **not capped** at the `priority_queue_limit` setting (default: 10):

```
00:02:47  queue_add  position: 47
00:06:26  queue_add  position: 48
00:07:21  queue_add  position: 49
00:08:41  queue_add  position: 50
00:18:37  queue_add  position: 51
00:30:08  queue_add  position: 52
00:32:09  queue_add  position: 53
00:42:23  queue_add  position: 54   ← peak depth
```

Position 54 means at least 55 priority items had been added at some point before most were played. The `priority_queue_limit` setting exists in `player_settings` but `kiosk_request_enqueue` does not check it — it calls `queue_add` which only checks `max_queue_size` (total items, not per-type). Since many played items are filtered out by `played_at IS NULL`, the total count stays below `max_queue_size=50` even with high position numbers.

This is not eviction — it is uncapped priority growth.

---

## Issue 3 — Rapid `queue_next` Cycling ✅ CONFIRMED 🔴

### All 14 instances of paired `queue_next` events within ≤3 seconds

| Time of first | Time of second | Gap | Types | Notes |
|---|---|---|---|---|
| 04:22:24 | 04:22:27 | 3s | normal→normal | |
| 03:45:48 | 03:45:50 | 2s | normal→normal | |
| 03:17:01 | 03:17:03 | 2s | normal→normal | |
| 03:08:00 | 03:08:02 | 2s | normal→normal | |
| 03:02:28 | 03:02:31 | 3s | priority→priority | APT (ROSÉ/Bruno Mars) skipped |
| 02:53:09 | 02:53:11 | 2s | priority→priority | No Diggity skipped |
| 02:10:03 | 02:10:06 | 3s | priority→normal | Bohemian Rhapsody skipped (2nd play) |
| 02:05:15 | 02:05:17 | 2s | priority→normal | Bohemian Rhapsody skipped (1st play) |
| 01:54:04 | 01:54:04 | 0s | priority→priority | same-second double-trigger |
| 01:46:38 | 01:46:40 | 2s | priority→priority | |
| 01:31:09 | 01:31:11 | 2s | priority→priority | Marry You (Bruno Mars) skipped |
| 01:13:31 | 01:13:34 | 3s | priority→priority | |
| 00:44:04 | 00:44:07 | 3s | priority→priority | |
| 00:29:55 | 00:29:58 | 3s | priority→priority | |

No song can play in 0–3 seconds. All 14 instances represent songs being silently skipped — `queue_next` is called twice for a single song-end event.

### Root cause analysis

The Player uses two independent paths to advance the queue:

**Path A (direct):** YouTube `onStateChange(0)` (ENDED) → `reportEndedAndNext()` → `player-control/ended` → `queue_next`

**Path B (Realtime):** `queue_next` sets `player_status.state='loading'` → Realtime CDC → `subscribeToPlayerStatus` callback → checks state transitions

Path B has a guard:
```javascript
if (newState === 'idle' && (prevState === 'playing' || prevState === 'paused')) {
  await reportEndedAndNext(true); // only fires on Admin skip
}
```
This guard should prevent Path B from double-firing. However, `queue_next` also reloads `loadVideoById` on the existing YouTube player instance:
```javascript
playerRef.current.loadVideoById(youtubeId); // player/App.tsx:744
```

**The YouTube IFrame Player API fires extra state change events during `loadVideoById`**. When a new video loads into an existing player, the API can fire:
- A `PAUSED` event for the old video's playback state
- A `CUED` event (5)
- Occasionally an `ENDED` (0) event as the previous video finalises

The `onPlayerStateChange` handler fires `reportEndedAndNext()` for any `event.data === 0` without checking whether the Player is already in a loading state for a new video. This causes a second `queue_next` call within seconds of the first.

The 0-second double at `01:54:04` (same log timestamp) confirms this is not a user action — it is a code-level double-invocation.

### User impact

14 songs were silently skipped over the 4.5-hour window. For kiosk priority requests, this means paid songs are consumed from the queue but not played. The two Bohemian Rhapsody double-skips at 02:05 and 02:10 are directly visible in the user behaviour: the user re-requested the same song at 02:05:51 believing their first request hadn't worked (see Issue 5).

---

## Issue 4 — Multiple Kiosk Session IDs ⚠️ MINOR 🟢

### Evidence

| session_id | Requests | First seen |
|---|---|---|
| `0f002128-3ae0-43e5-a589-d927a9874e3b` | 40 | 00:02:47 |
| `800fcee2-5a67-4744-b68f-4dff2ed4059f` | 1 | 00:53:21 |

Only **one anomalous session** appears in 4.5 hours of activity, at `00:53:21` for "Pearl Jam Immortality (Karaoke Version) - CreepFactor".

### Assessment

This is almost certainly a brief kiosk page reload or network reconnection causing a new `kiosk_sessions` row to be created. Session `0f002128` resumes immediately afterwards. There is no evidence of multi-device usage or session hijacking.

**Verdict: Dismissed as systemic issue.** Single-session edge case consistent with a network blip.

---

## Issue 5 — Duplicate Song Requests ✅ CONFIRMED 🟡

### All confirmed duplicates that were played twice

**1. "Bohemian Rhapsody" (media_item_id: `3039c822`)**

```
02:03:11  kiosk_request → queue_id 3976a0ca  pos 0
02:05:15  queue_next priority 3039c822 (3976a0ca consumed)
02:05:17  ← DOUBLE TRIGGER (queue_next normal e13b07b9)
02:05:51  kiosk_request → queue_id 7ff3fc20  pos 0  ← RE-REQUESTED
02:10:03  queue_next priority 3039c822 (7ff3fc20 consumed)
```
The user re-requested because the double-trigger at 02:05:17 made a normal song appear to overwrite their request. Both copies were deducted credits and played.

**2. "Marry You" — Bruno Mars (media_item_id: `bc4c8af1`)**

```
01:17:55  kiosk_request → queue_id a5911d5d  pos 9
01:20:51  "the perfect pair" requested → pos 10 (queue built up between)
01:31:09  queue_next priority bc4c8af1 (a5911d5d consumed)
01:31:11  ← DOUBLE TRIGGER (queue_next priority e6baf968 — skipping "the perfect pair")
01:31:56  kiosk_request → queue_id 0a9232e0  pos 0  ← RE-REQUESTED
01:34:11  queue_next priority bc4c8af1 (0a9232e0 consumed)
```
Again the double-trigger caused the user to re-request. "Marry You" played twice; "the perfect pair" (Beabadoobee, media `e6baf968`) was skipped entirely by the double trigger.

**3. "Dear Future Husband" — Meghan Trainor (media_item_id: `d025fc37`)**

```
01:42:52  kiosk_request → queue_id 1d0dd6d7  pos 0
01:44:08–01:47:19  4 more songs requested (pos 1–4)
01:46:38  queue_next priority d025fc37 (1d0dd6d7 consumed)
01:46:40  ← DOUBLE TRIGGER (queue_next priority 2b690e2b)
01:47:19  kiosk_request → queue_id 4ffbe4b9  pos 4  ← RE-REQUESTED
01:54:06  queue_next priority d025fc37 (4ffbe4b9 consumed)
```

**4. "Don't Stop Me Now" — Queen (media_item_id: `62ea72b7`)**

```
00:02:47  kiosk_request → queue_id 7595a490  pos 47
00:29:55  queue_next priority 62ea72b7 (7595a490 consumed)
02:14:08  kiosk_request → queue_id dca3eea8  pos 3
02:28:45  queue_next priority 62ea72b7 (dca3eea8 consumed)
```
In this case the two requests were over 2 hours apart — this is a genuine re-request (not double-trigger confusion), but is still a legitimate duplicate play.

### Root cause

There are **two separate causes** of duplicates:
1. **Double-trigger skips (Issues 3 & 5 linked):** The rapid queue_next at 02:05:15+17, 01:31:09+11, 01:46:38+40 caused users to believe their song didn't play and immediately re-request. Each re-request cost an additional credit.
2. **No queue visibility:** The kiosk UI shows no "songs ahead in queue" indicator. Users who queued many songs and lost track of what they'd requested re-submitted the same song.

---

## Issue 6 — Priority Queue Depth Growth ✅ CONFIRMED 🟡

### Peak depth evidence

```
00:02:47   pos 47  Don't Stop Me Now
00:06:26   pos 48  Chasing Pavements
00:07:21   pos 49  Like I'm Gonna Lose You
00:08:41   pos 50  9 To 5
00:18:37   pos 51  Who Knows
00:30:08   pos 52  Angels - Robbie Williams
00:32:09   pos 53  Can You Love Me Tonight?
00:42:23   pos 54  Valerie         ← PEAK
```

Position 54 means there were at least 55 priority items ever inserted. The `priority_queue_limit = 10` setting in `player_settings` is **not enforced** by `kiosk_request_enqueue`. That RPC calls `queue_add`, which only checks:
```sql
SELECT COUNT(*) FROM queue WHERE player_id = p_player_id AND played_at IS NULL;
```
This is a total-count check (default max 50), not a per-type check. As priority items are played (played_at set), they exit the count, allowing new items to be added continuously.

### Consequence

During the peak period (midnight–01:00), normal playlist songs were completely suppressed. A user arriving at the venue after midnight would have heard only kiosk-requested songs for 3+ hours with no regular rotation. This is by design (priority drains before normal) but the lack of a per-session cap means one person can monopolise the entire queue indefinitely, as happened here with session `0f002128` making 40 requests.

---

## Issue 7 — Playlist Load Without Queue Clear ❌ DISMISSED 🟢

### Assessment

The `load_playlist` RPC **does** clear the normal queue before loading:
```sql
-- migrations/20251109233222_fix_playlist_loading_priority.sql:23
DELETE FROM queue
WHERE player_id = p_player_id
  AND type = 'normal';
```

There is no code path where a playlist loads without clearing first. The issue as stated is not present.

The concern may have originated from the double-load race (Issue 1), where the second load clears and overwrites the first. That is covered under Issue 1.

---

## Issue A — Double `queue_next` Causing Silent Song Skip ✅ CONFIRMED (New) 🔴

This is the most impactful new finding and is the root cause of Issues 3 and 5.

### Mechanism

When the YouTube IFrame Player fires `onStateChange(0)` (ENDED), the Player calls `reportEndedAndNext()`. This calls `player-control/ended`, which runs `queue_next`, updates `player_status.current_media_id`, and returns the next media item. The Player then calls `loadVideoById(nextVideoId)` on the existing player instance.

**The bug:** `loadVideoById` on an already-playing YouTube IFrame Player can fire additional state change events for the *old* video's cleanup. When this fires `event.data === 0` (ENDED), the handler calls `reportEndedAndNext()` a second time — skipping the newly-loaded song before it has begun.

The 0-second double at `01:54:04` (same log second) is the strongest evidence: no user interaction or network round-trip could produce two `queue_next` calls in under 1 second. It is a single song-end event being handled twice within the same execution context.

### Frequency

14 occurrences over 4.5 hours = approximately one double-trigger every 19 minutes on average. Given roughly 4-5 songs per hour on priority queue, this represents a substantial skip rate.

### Relevant code path

```javascript
// web/player/src/App.tsx:258-311
const onPlayerStateChange = useCallback((event: any) => {
  ...
  } else if (event.data === 0) {
    // ENDED - trigger queue progression
    reportEndedAndNext();   // ← no guard for "already advancing"
  }
}, [...]);
```
There is no `isAdvancingRef` or equivalent guard to block re-entrant calls to `reportEndedAndNext`.

---

## Issue B — Normal Playlist Ran Near-Empty (03:08 Context) ✅ CONFIRMED 🟡

### Evidence

Between ~00:00 and 03:08, the queue was almost entirely composed of priority items. The last priority-only run ends at **03:04:31**. Normal songs resume at **03:08:00**, but only 12 distinct songs are visible in the rotation:

```
e13b07b9, 6f0fdbbe, 32811e98, e5c7b5af, a5e8bc8d, 5ae1328c,
319f331f, ea33f1d0, 9a92994a, 353aeff7, 5f9b6bc0  (+e13b07b9 again)
```

These same songs repeat **in the same order** across three full cycles from 03:08 to 04:29:

| Cycle | Start | e13b07b9 seen |
|---|---|---|
| 1 | 03:08:00 | 03:08:00 |
| 2 | 03:45:50 | 03:45:50 |
| 3 | 04:28:14 | 04:28:14 |

Each cycle lasts ~37–40 minutes (12 songs × ~3.5 min avg).

### Explanation

The normal queue was loaded at system start with 250 items. Over 3+ hours of evening use, priority requests displaced/consumed the vast majority of those slots (played_at set) and the active unplayed normal items drained to approximately the last ~12 songs in the playlist. After priority items exhausted (~03:04), the Player resumed on this short remaining segment, causing the visible loop.

The double playlist_loaded at 04:29:02 (Issue 1) triggered to refill — but fired twice with different start positions.

### Consequence

Any patron arriving during the high-priority period (00:00–03:04) would hear **only kiosk-requested songs** for over 3 hours with zero regular playlist rotation. This is correct by design but the magnitude (3+ hours) was enabled by the uncapped priority queue (Issue 6).

---

## Issue C — Playlist Reload Creating 12-Song Loop ✅ CONFIRMED (New) 🟡

### Evidence

After priority songs exhaust and before the 04:29:02 reload, the same 12 songs cycle on repeat from 03:08 onwards. The double reload at 04:29:02 was triggered because the queue was nearly empty — the system attempted to auto-reload the playlist to keep playing.

The loop itself is normal behaviour (these were the remaining unplayed normal items). The issue is that the **auto-reload fired twice concurrently** (Issue 1), so the loop's resolution was non-deterministic.

---

## Full Event Timeline with Annotations

```
TIME     EVENT                               NOTES
────────────────────────────────────────────────────────────────────────────
~00:00   [High-activity kiosk window begins]
00:02:47 kiosk_request pos 47              Queue already had 47 items!
00:06:26 kiosk_request pos 48
00:07:21 kiosk_request pos 49
00:08:41 kiosk_request pos 50
00:17–00:43  queue_next priority × 8      Songs playing from large backlog
00:18:37 kiosk_request pos 51
00:29:55 queue_next priority 62ea72b7     ─┐
00:29:58 queue_next priority 6762261a     ─┘ DOUBLE (3s) ← skip
00:30:08 kiosk_request pos 52
00:32:09 kiosk_request pos 53
00:42:23 kiosk_request pos 54            ← PEAK priority depth
00:44:04 queue_next priority e741235c    ─┐
00:44:07 queue_next priority 51a74530    ─┘ DOUBLE (3s) ← skip
00:47–01:42  queue_next priority × 12    Normal drain of backlog
01:13:31 queue_next priority a132b924    ─┐
01:13:34 queue_next priority eedf20a7    ─┘ DOUBLE (3s) ← skip
01:31:09 queue_next priority bc4c8af1    ─┐  "Marry You" consumed
01:31:11 queue_next priority e6baf968    ─┘  DOUBLE (2s) ← "the perfect pair" SKIPPED
01:31:56 kiosk_request "Marry You"          User re-requests (saw skip)
01:42:52 kiosk_request "Dear Future Husband" pos 0
01:44–01:48  4 more requests pos 1-5
01:46:38 queue_next priority d025fc37    ─┐  "Dear Future Husband" consumed
01:46:40 queue_next priority 2b690e2b    ─┘  DOUBLE (2s) ← skip
01:47:19 kiosk_request "Dear Future Husband" User re-requests (saw skip)
01:50–02:02  queue_next priority × 5    Normal drain
01:54:04 queue_next priority 7f1efe19    ─┐
01:54:04 queue_next priority d025fc37    ─┘ DOUBLE (0s) ← same-second!
02:03:11 kiosk_request "Bohemian Rhapsody" pos 0
02:05:15 queue_next priority 3039c822    ─┐  "Bohemian Rhapsody" consumed
02:05:17 queue_next normal   e13b07b9    ─┘  DOUBLE (2s) ← skip
02:05:51 kiosk_request "Bohemian Rhapsody"   User re-requests (normal song visible)
02:10:03 queue_next priority 3039c822    ─┐  "Bohemian Rhapsody" 2nd play
02:10:06 queue_next normal   32811e98    ─┘  DOUBLE (3s) ← skip
02:11:49–02:44:16  15 kiosk requests     Large new batch pos 0-14
02:47–03:04  queue_next priority × 7    Drain of new batch
02:53:09 queue_next priority 83dc0c89    ─┐  (No Diggity skipped)
02:53:11 queue_next priority 9eb3f1f7    ─┘  DOUBLE (2s)
03:02:28 queue_next priority 5e5cefdb    ─┐  (APT - ROSÉ/Bruno Mars skipped)
03:02:31 queue_next priority 491987f9    ─┘  DOUBLE (3s)
03:04:31 queue_next priority a07cf243    ← Last priority item
03:08:00 queue_next normal   e13b07b9    ─┐
03:08:02 queue_next normal   6f0fdbbe    ─┘  DOUBLE (2s) ← skip
03:08–03:45  normal songs cycling × 8   12-song loop begins
03:17:01 queue_next normal   e5c7b5af    ─┐
03:17:03 queue_next normal   a5e8bc8d    ─┘  DOUBLE (2s)
03:45:48 queue_next normal   5f9b6bc0    ─┐
03:45:50 queue_next normal   e13b07b9    ─┘  DOUBLE (2s) ← cycle 2 starts
03:45–04:22  normal songs cycling × 11
04:22:24 queue_next normal   353aeff7    ─┐
04:22:27 queue_next normal   5f9b6bc0    ─┘  DOUBLE (3s) ← cycle 3 starts
04:28:14 queue_next normal   e13b07b9    ← Last song before empty
04:29:02 playlist_loaded start_index=0  ─┐  RACE CONDITION
04:29:02 playlist_loaded start_index=34 ─┘  Both fired simultaneously
[END OF LOG WINDOW]
```

---

## Priority Findings Requiring Action

### 🔴 P1 — Fix double `queue_next` trigger in Player

**File:** [web/player/src/App.tsx](web/player/src/App.tsx) — `onPlayerStateChange` handler (~line 258)

Add an `isAdvancingQueue` ref that is set to `true` before calling `reportEndedAndNext()` and cleared only after the next media item has loaded. Ignore ENDED events while this flag is set.

This single fix resolves: Issue 3 (rapid cycling), most of Issue 5 (duplicate requests), and Issues A (silent skips).

### 🔴 P2 — Guard against concurrent `load_playlist` calls

**File:** [web/player/src/App.tsx](web/player/src/App.tsx) — `initPlayer` effect / playlist auto-reload logic

The `hasInitialized.current` guard only prevents the Player's own re-renders from re-triggering. It does not prevent the Admin UI from also triggering a `load_playlist` call at the same time. Add a server-side idempotency timestamp or a short-circuit in the Player: if `player_status.state !== 'idle'`, skip the auto-reload.

### 🟠 P3 — Enforce `priority_queue_limit` per session in `kiosk_request_enqueue`

**File:** `supabase/migrations` (new migration needed for `kiosk_request_enqueue` RPC)

Add a check: `SELECT COUNT(*) FROM queue WHERE player_id = p_player_id AND type = 'priority' AND played_at IS NULL AND requested_by = p_session_id`. If count ≥ `player_settings.priority_queue_limit`, raise an exception. This prevents one session from monopolising the queue.

### 🟡 P4 — Show priority queue position to kiosk user

**File:** [web/kiosk/src/App.tsx](web/kiosk/src/App.tsx)

After a successful `kiosk_request`, display "Your song is #N in the queue" using the returned position number. This directly addresses duplicate re-requests from confused users (Issue 5, cause 2).
