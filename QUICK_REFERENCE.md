# Quick Reference - Obie Jukebox v2

## 🚀 Quick Start

```bash
# Setup (one time)
./setup.sh

# Start development
npm run dev

# Open apps
# Admin:  http://localhost:5173
# Player: http://localhost:5174
# Kiosk:  http://localhost:5175
```

---

## 📦 Commands

### Development
```bash
npm run dev              # Start all apps
npm run dev:admin        # Start admin only
npm run dev:player       # Start player only
npm run dev:kiosk        # Start kiosk only
```

### Build
```bash
npm run build            # Build all apps
npm run build:admin      # Build admin only
npm run build:player     # Build player only
npm run build:kiosk      # Build kiosk only
```

### Supabase
```bash
npm run supabase:start   # Start local Supabase
npm run supabase:stop    # Stop local Supabase
npm run supabase:reset   # Reset database
npm run supabase:deploy  # Deploy Edge Functions
```

---

## 🗄️ Database

### Tables
- `players` - Player instances
- `playlists` - Playlist library
- `playlist_items` - Playlist contents
- `media_items` - Media metadata
- `queue` - Song queue (normal + priority)
- `player_status` - Playback state
- `player_settings` - Configuration
- `kiosk_sessions` - Kiosk sessions + credits
- `system_logs` - Event logs

### Key RPCs
```sql
-- Queue operations
SELECT queue_add('player_id', 'media_id', 'normal', 'admin');
SELECT queue_remove('queue_id');
SELECT queue_next('player_id');
SELECT queue_skip('player_id');
SELECT queue_clear('player_id');

-- Credits
SELECT kiosk_increment_credit('session_id', 1);
SELECT kiosk_decrement_credit('session_id', 1);

-- Heartbeat
SELECT player_heartbeat('player_id');
```

---

## 🔧 Edge Functions

### Endpoints
```
POST /functions/v1/queue-manager
POST /functions/v1/player-control
POST /functions/v1/kiosk-handler
POST /functions/v1/playlist-manager
```

### Example: Queue Manager
```typescript
await callQueueManager({
  player_id: '...',
  action: 'add',
  media_item_id: '...',
  type: 'priority',
  requested_by: 'kiosk'
});
```

### Example: Player Control
```typescript
await callPlayerControl({
  player_id: '...',
  state: 'playing',
  progress: 0.5,
  action: 'update'
});
```

---

## 🎨 Frontend Components

### Admin Console
- `QueueView` - Queue with drag-drop
- `PlaylistsView` - Playlist manager
- `SettingsView` - Settings editor
- `LogsView` - System logs

### Player Window
- YouTube iframe fullscreen
- Status overlay
- Idle/loading/error states

### Kiosk Interface
- Search bar
- Results grid
- Credit display
- Request buttons

---

## 🔌 Realtime Subscriptions

```typescript
// Queue updates
const sub = subscribeToQueue(playerId, (items) => {
  console.log('Queue updated:', items);
});

// Player status
const sub = subscribeToPlayerStatus(playerId, (status) => {
  console.log('Status:', status);
});

// Settings
const sub = subscribeToPlayerSettings(playerId, (settings) => {
  console.log('Settings:', settings);
});

// Cleanup
sub.unsubscribe();
```

---

## ⚙️ Configuration

### Player Settings
```sql
UPDATE player_settings SET
  loop = false,
  shuffle = true,
  volume = 75,
  freeplay = false,
  coin_per_song = 1,
  max_queue_size = 50,
  priority_queue_limit = 10
WHERE player_id = '...';
```

### Branding (Kiosk)
```sql
UPDATE player_settings SET
  branding = jsonb_build_object(
    'name', 'My Jukebox',
    'logo', 'https://example.com/logo.png',
    'theme', 'dark'
  )
WHERE player_id = '...';
```

---

## 🐛 Debugging

### Check Player Status
```bash
curl http://localhost:54321/rest/v1/players \
  -H "apikey: YOUR_ANON_KEY"
```

### Edge Function Logs
```bash
supabase functions logs --local
```

### Realtime Status
```typescript
const channel = supabase.channel('test');
channel.subscribe((status) => {
  console.log('Status:', status); // Should be 'SUBSCRIBED'
});
```

---

## 📊 URLs

### Local Development
- **Admin**: http://localhost:5173
- **Player**: http://localhost:5174
- **Kiosk**: http://localhost:5175
- **Supabase Studio**: http://localhost:54323

### Supabase
- **API**: http://localhost:54321
- **Anon Key**: (see .env file)

---

## 🔑 Environment Variables

```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

Required in:
- `web/admin/.env`
- `web/player/.env`
- `web/kiosk/.env`

---

## 🚨 Common Issues

### "Player offline"
→ Make sure Player window is open and running

### "Insufficient credits"
→ Click "Insert Coin" or enable freeplay:
```sql
UPDATE player_settings SET freeplay = true;
```

### Edge Function not working
→ Check logs: `supabase functions logs --local`

### Realtime not updating
→ Check Realtime is enabled in Supabase dashboard

---

## 📚 Documentation

- **README.md** - Main docs
- **DEVELOPMENT.md** - Developer guide
- **DEPLOYMENT.md** - Production deployment
- **PROJECT_SUMMARY.md** - Architecture overview

---

## 🎯 Key Concepts

1. **Server-First**: All state in Supabase
2. **Real-time**: WebSocket sync (<100ms)
3. **Stateless Clients**: No localStorage
4. **Priority Queue**: Paid requests first
5. **Free-Tier Safe**: <5% of limits

---

## ⚡ Performance

| Metric | Usage | Limit | Status |
|--------|-------|-------|--------|
| Invocations | 25K/mo | 500K | ✅ 5% |
| CPU | 21 min | 50 hrs | ✅ 0.7% |
| Realtime | 3 | 200 | ✅ 1.5% |

---

## 🆘 Support

- **GitHub Issues**: [github.com/yourusername/obie-v5](https://github.com/yourusername/obie-v5)
- **Supabase Docs**: [supabase.com/docs](https://supabase.com/docs)
- **Discord**: [discord.supabase.com](https://discord.supabase.com)

---

**Obie Jukebox v2 - Server-First, Real-Time, Free-Tier Safe 🎵**
