# Obie Production Upgrade Roadmap

Created: 2026-04-28
Branch: `01-01-26-dev`

This roadmap keeps Obie's current core intact: a venue jukebox with a player screen, admin console, kiosk requests, Supabase control plane, Cloudflare cached playback, and YouTube fallback. The goal is to evolve it toward production-quality paid jukebox expectations without destabilising playback.

## Rollback Anchor

- Git tag: `rollback-20260427T172510Z`
- Git branch: `rollback/20260427T172510Z`
- Snapshot folder: `snapshots/rollback-20260427T172510Z/`
- Note: Supabase schema dump could not be captured locally because Docker was not running; the snapshot still records git head and deployed function versions.

## Current Stabilisation Completed

- Fixed skip fade recovery so the next track restores the pre-fade configured volume instead of staying muted.
- Suppressed null endpoint/session status spam before player registration is complete.
- Kept non-master endpoint protections intact while reducing repeated log writes.
- Added an admin YouTube Health view for known-bad YouTube-only media.
- Added a batch `youtube-remediation-worker` Edge Function to audit stale playability records and generate alternative candidates.
- Removed unused active-tree duplicate files that confused maintenance without participating in runtime builds.

## Product Benchmarks Considered

- TouchTunes: venue/app check-in, full queue visibility, fast-pass/priority markers, operator controls, and real-time queue progress.
- Spotify Jam: host-controlled shared queue, contributor attribution, group recommendations, and collaborative session controls.
- YouTube Music: radio-style discovery, playlist search, custom radio/AI-assisted playlist generation, and broad catalog fallback.

Public references:
- TouchTunes app and queue visibility: https://www.touchtunes.com/jukeboxes/app
- TouchTunes queue help: https://touchtunes.helpshift.com/hc/en/8-touchtunes/faq/795-what-is-the-song-queue-and-how-can-i-view-it/
- Spotify Jam support: https://support.spotify.com/mz-en/article/jam/
- Spotify Jam announcement: https://newsroom.spotify.com/2023-09-26/spotify-jam-personalized-collaborative-listening-session-free-premium-users/
- YouTube Music feature guide: https://blog.youtube/news-and-events/youtube-music-app-2023-guide/

## Highest-Value Next Features

### 1. Queue Transparency

Expose a kiosk/user-facing queue position and ETA view:
- current track
- full or partial queue visibility
- request position
- priority request marker
- expected wait range
- skipped/failed request reason if applicable

This is a direct production jukebox expectation and maps well onto the existing queue table.

### 2. Request Attribution And Moderation

Track who requested what and expose admin actions:
- requested-by display everywhere
- per-session request history
- remove/ban/request-limit controls
- duplicate suppression within a configurable time window
- explicit "request rejected" reason surfaced to kiosk

### 3. Smart Replacement Flow

Build on the new remediation worker:
- one-click replace source video for a media item
- preview alternative candidates in admin
- auto-prefer cached Cloudflare candidates
- optionally enqueue replacement immediately if the original is currently blocked
- store operator approval history

### 4. Library Reliability Score

Add a catalog health dashboard:
- cached vs YouTube-only ratio
- blocked/restricted/check-failed counts
- stale playability checks
- videos with repeated runtime error 150/101/5
- playlists with risky tracks
- remediation candidate availability

### 5. Safer Background Jobs

Move periodic maintenance out of manual admin clicks:
- scheduled playability audit
- scheduled alternative candidate search for newly blocked videos
- stale endpoint cleanup
- old log retention/rollup
- R2 sync freshness check

### 6. Player Session Observability

Improve confidence in master/slave control:
- active endpoint timeline
- last command acknowledged by endpoint
- playback start acknowledgement latency
- player build/version fingerprint
- visible "driving endpoint" in admin stage

### 7. Recommendation And Radio Quality

Expand the current radio generator into paid-service-grade discovery:
- seed from current track, playlist, or venue history
- avoid recently played artists/tracks
- tempo/mood controls
- explicit/clean mode
- local cache preference
- admin preview before queue insertion

### 8. Venue Operating Modes

Add modes suitable for commercial deployment:
- open/free-play mode
- credit mode
- staff-only mode
- quiet hours/background playlist
- event mode with request caps
- emergency stop/flush queue with confirmation

## Technical Hardening Backlog

- Add migration tests for queue RPC signatures and grants so `queue_skip`, `queue_next`, and helper function permissions cannot regress.
- Replace broad `any` types in Edge Functions with small request/response interfaces.
- Add a log rollup table so high-volume events do not make `system_logs` expensive.
- Add rate limiting to remediation/audit functions.
- Add a canary health endpoint that checks CORS, auth, database connectivity, and required environment variables.
- Add a player-side build/version event on boot so deployed frontend versions can be correlated with logs.
- Add CI checks for `npm run build`, Deno checks, and migration lint before pushes to production branches.

## Rollout Order

1. Keep stabilisation fixes small and separately revertible.
2. Prefer operator-only admin features before kiosk-facing behavior changes.
3. Add background jobs only after manual controls prove stable.
4. Add user-facing queue transparency once queue state is consistently accurate.
5. Add replacement automation only after candidate scoring is reviewed with live data.

