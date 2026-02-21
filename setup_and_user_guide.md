# Obie Jukebox v2 - Complete Setup & User Guide

**A comprehensive guide for setup, configuration, and operation of the Obie Jukebox system**

---

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [User Sign-up / Login](#user-sign-up--login)
3. [The Admin Console Webpage](#the-admin-console-webpage)
4. [The Search Kiosk Webpage](#the-search-kiosk-webpage)
5. [The Video Player Webpage](#the-video-player-webpage)
6. [Edge Functions & Scripts](#edge-functions--scripts)
7. [Shell Scripts Reference](#shell-scripts-reference)
8. [Troubleshooting](#troubleshooting)
9. [Advanced Configuration](#advanced-configuration)

---

## Installation & Setup

### Prerequisites

- **Node.js 18+** and npm
- **Docker** (for local Supabase development)
- **Supabase account** ([sign up free](https://supabase.com))
- **Supabase CLI** (`npm install -g supabase`)

### Quick Start (Recommended)

```bash
# 1. Clone and install
git clone https://github.com/SystemVirtue/obie-v5
cd obie-v5
npm install

# 2. Run interactive setup
./setup.sh

# 3. Start all applications
npm run dev

# 4. Open in browser
# Admin:  http://localhost:5173
# Player: http://localhost:5174
# Kiosk:  http://localhost:5175
```

### Manual Setup

#### 1. Environment Configuration

Create `.env` files for each frontend app:

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

#### 2. Supabase Setup

**Option A: Local Development**
```bash
# Start Supabase locally (requires Docker)
npm run supabase:start

# This will output:
# - API URL: http://localhost:54321
# - anon key: <your-anon-key>
# - service_role key: <your-service-key>
```

**Option B: Supabase Cloud**
1. Create project at [database.new](https://database.new)
2. Go to **Settings → API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` secret key

#### 3. Database Setup

```bash
# Run database migrations
npm run supabase:reset
```

This creates all tables, RPCs, and RLS policies.

#### 4. YouTube API Setup (Required for playlist imports)

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/apis/credentials

2. **Create/Select a Project**
   - Click "Create Project" (or select existing)
   - Name it "Obie Jukebox" or similar

3. **Enable YouTube Data API v3**
   - Go to: https://console.cloud.google.com/apis/library/youtube.googleapis.com
   - Click "Enable"

4. **Create API Key**
   - Go back to: https://console.cloud.google.com/apis/credentials
   - Click "Create Credentials" → "API Key"
   - Copy the generated key

5. **Configure API Key**
   ```bash
   # Set environment variable
   export YOUTUBE_API_KEY=your-api-key-here
   
   # Or add to .env file
   echo "YOUTUBE_API_KEY=your-api-key-here" >> .env
   ```

#### 5. Import Default Playlists

```bash
# Import all default playlists
./import-all-playlists.sh

# Or import a single playlist
./import-single-playlist.sh <PLAYLIST_ID> "Playlist Name"
```

---

## User Sign-up / Login

### Admin User Creation

#### Method 1: Via Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to **Authentication → Users**
3. Click **Add User**
4. Enter email and password
5. Set email confirmed to **true**

#### Method 2: Via SQL
```sql
-- In Supabase SQL Editor
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES (
  'admin@example.com',
  crypt('your-password', gen_salt('bf')),
  NOW()
);
```

### Login Process

1. Open Admin Console: http://localhost:5173
2. Click **Sign In**
3. Enter your credentials
4. You'll be redirected to the main dashboard

### Authentication Configuration

In Supabase dashboard:
1. Go to **Authentication → Settings**
2. Enable Email provider
3. Configure Site URL: `http://localhost:5173` (development) or your production URL
4. Add redirect URLs:
   - `http://localhost:5173` (dev)
   - `https://admin.yourdomain.com` (production)

---

## The Admin Console Webpage

The Admin Console provides complete control over your jukebox system.

### Queue Tab

**Features:**
- **Real-time queue display** with drag-and-drop reordering
- **Player controls** (play/pause/skip/clear)
- **Priority queue support** (kiosk requests appear first)
- **Queue management** (add/remove/reorder items)

**Operations:**
- **Add to Queue**: Select songs from playlists and add to queue
- **Remove Item**: Click the × button next to any queue item
- **Reorder**: Drag items to new positions
- **Clear Queue**: Remove all items from queue
- **Skip Current**: Jump to next song in queue

### Playlists Tab

**Features:**
- **Playlist library management** (create, edit, delete)
- **Import YouTube playlists** with automatic metadata extraction
- **Deduplication** (videos appearing in multiple playlists stored once)
- **Playlist item management** (view, remove individual songs)

**Operations:**
- **Create Playlist**: Click "New Playlist" and enter name
- **Import YouTube Playlist**: 
  1. Click "Import Playlist"
  2. Enter YouTube playlist URL
  3. System fetches all video metadata automatically
- **View Playlist Items**: Click on any playlist to see all songs
- **Delete Playlist**: Click delete button (requires confirmation)

### Settings Tab

**Player Settings:**
- **Loop**: Enable/disable playlist looping
- **Shuffle**: Randomize playback order
- **Volume**: Default volume level (0-100)
- **Freeplay**: Disable credit system for free operation
- **Coin per Song**: Credits required per song request
- **Max Queue Size**: Maximum items in normal queue
- **Priority Queue Limit**: Maximum priority queue items

**Kiosk Settings:**
- **Search Enabled**: Allow/disallow song search
- **Branding**: Customize kiosk appearance
  ```json
  {
    "name": "My Jukebox",
    "logo": "https://example.com/logo.png",
    "theme": "dark"
  }
  ```

**Functions & Scripts Section:**
- **Setup Script**: Run initial setup
- **Import All Playlists**: Import default playlists
- **Import Single Playlist**: Import specific playlist
- **Retry Failed Playlists**: Retry imports that failed due to rate limits

### Logs Tab

**Features:**
- **Real-time system logs** with severity levels
- **Event filtering** (error, warning, info, debug)
- **Log search** and filtering
- **Auto-refresh** with latest events

**Log Types:**
- **ERROR**: System errors and failures
- **WARN**: Warnings and potential issues
- **INFO**: General information and status updates
- **DEBUG**: Detailed debugging information

---

## The Search Kiosk Webpage

The Kiosk provides a public interface for song requests.

### Searching

**Features:**
- **Touch-optimized search interface**
- **Real-time search results** as you type
- **YouTube video metadata** (title, artist, duration, thumbnail)
- **Search history** (recent searches)

**How to Search:**
1. Tap the search bar
2. Type song title, artist, or keywords
3. View results in grid layout
4. Tap any result to see details

### Credits System

**Features:**
- **Credit display** showing current balance
- **Coin acceptor integration** (WebSerial API ready)
- **Dev coin button** for testing
- **Credit deduction** on successful requests

**Credit Operations:**
- **Insert Coin**: Click "Insert Coin (Dev)" for testing
- **Check Balance**: Current credits displayed prominently
- **Request Song**: Credits deducted when song added to queue

**Credit Configuration:**
```sql
UPDATE player_settings SET
  freeplay = false,        -- Enable credit system
  coin_per_song = 1;      -- 1 credit per song
```

### Customise Kiosk Theme / Overlay

**Branding Options:**
```sql
UPDATE player_settings SET
  branding = '{
    "name": "My Jukebox",
    "logo": "https://example.com/logo.png",
    "theme": "dark",        -- "dark" or "light"
    "primary_color": "#3b82f6",
    "secondary_color": "#1e40af"
  }'::jsonb
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

**Theme Customization:**
- **Color Scheme**: Primary and secondary colors
- **Logo**: Custom logo URL
- **Font**: Typography options
- **Layout**: Grid/list view options

---

## The Video Player Webpage

The Player handles media playback and status reporting.

### Display Options

**Features:**
- **YouTube iframe** with autoplay capability
- **Fullscreen mode** for immersive experience
- **Status overlay** showing current track info
- **Debug information** for troubleshooting

**Display Modes:**
- **Fullscreen**: YouTube video fills entire screen
- **Windowed**: Player in browser window
- **Kiosk Mode**: Minimal UI for public displays

### Customise Player Theme / Overlay

**Status Overlay:**
- **Current Track**: Title and artist information
- **Playback Progress**: Visual progress bar
- **Player State**: Playing/paused/loading/error status
- **Debug Info**: Technical details for troubleshooting

**Customization Options:**
```css
/* Custom CSS can be added for player theming */
.player-overlay {
  background: rgba(0, 0, 0, 0.8);
  color: white;
  font-family: Arial, sans-serif;
}
```

### Auto-Play Implementation

**Features:**
- **Automatic playlist loading** on startup
- **Resume functionality** (continues from last position)
- **Fallback logic** (uses default playlist if none active)
- **Loop and shuffle support**

**Startup Flow:**
1. Player app loads
2. Calls `initialize_player_playlist()`
3. Loads default playlist ("Obie Playlist" or active playlist)
4. Starts from stored `now_playing_index`
5. Begins automatic playback

---

## Edge Functions & Scripts

### Available Edge Functions

#### 1. Queue Manager
**Endpoint**: `POST /functions/v1/queue-manager`

**Actions**:
- `add`: Add item to queue
- `remove`: Remove item from queue
- `reorder`: Reorder queue items
- `next`: Get next song to play
- `skip`: Skip current song
- `clear`: Clear queue

**Example**:
```javascript
await callQueueManager({
  player_id: '...',
  action: 'add',
  media_item_id: '...',
  type: 'priority',
  requested_by: 'kiosk'
});
```

#### 2. Player Control
**Endpoint**: `POST /functions/v1/player-control`

**Actions**:
- `update`: Update player status
- `heartbeat`: Keep player online
- `report`: Report playback progress

**Example**:
```javascript
await callPlayerControl({
  player_id: '...',
  state: 'playing',
  progress: 0.5,
  action: 'update'
});
```

#### 3. Kiosk Handler
**Endpoint**: `POST /functions/v1/kiosk-handler`

**Actions**:
- `search`: Search for songs
- `request`: Add song request to priority queue
- `credits`: Manage session credits

**Example**:
```javascript
await callKioskHandler({
  action: 'search',
  query: 'queen bohemian rhapsody'
});
```

#### 4. Playlist Manager
**Endpoint**: `POST /functions/v1/playlist-manager`

**Actions**:
- `create`: Create new playlist
- `update`: Update playlist metadata
- `delete`: Delete playlist
- `scrape`: Import YouTube playlist

**Example**:
```javascript
await callPlaylistManager({
  action: 'scrape',
  playlist_id: '...',
  url: 'https://youtube.com/playlist?list=...'
});
```

### SQL RPC Functions

**Queue Operations**:
```sql
SELECT queue_add('player_id', 'media_id', 'normal', 'admin');
SELECT queue_remove('queue_id');
SELECT queue_next('player_id');
SELECT queue_skip('player_id');
SELECT queue_clear('player_id');
```

**Credit Operations**:
```sql
SELECT kiosk_increment_credit('session_id', 1);
SELECT kiosk_decrement_credit('session_id', 1);
```

**Heartbeat**:
```sql
SELECT player_heartbeat('player_id');
```

---

## Shell Scripts Reference

### Setup Scripts

#### `setup.sh`
**Purpose**: Interactive setup for new installations
**Usage**: `./setup.sh`

**Features**:
- Checks prerequisites (Node.js, npm, Docker)
- Installs dependencies
- Creates environment files
- Installs Supabase CLI
- Optionally starts local Supabase

### Playlist Import Scripts

#### `import-all-playlists.sh`
**Purpose**: Import multiple predefined playlists
**Usage**: `./import-all-playlists.sh`

**Included Playlists**:
- DJAMMMS Default Playlist
- Obie Nights
- Obie Playlist
- Obie Jo
- Karaoke
- Poly
- Obie Johno

**Features**:
- Creates playlists in database
- Imports all videos from YouTube
- Handles rate limiting with delays
- Reports success/failure statistics

#### `import-single-playlist.sh`
**Purpose**: Import a specific YouTube playlist
**Usage**: `./import-single-playlist.sh <PLAYLIST_ID> "Playlist Name"`

**Example**:
```bash
./import-single-playlist.sh PLN9QqCogPsXIoSObV0F39OZ_MlRZ9tRT9 "My Playlist"
```

**Features**:
- Creates playlist with specified name
- Imports all videos from YouTube playlist
- Reports import results

#### `populate-playlist.sh`
**Purpose**: Populate default playlist with YouTube videos
**Usage**: `./populate-playlist.sh`

**Features**:
- Uses default playlist ID
- Imports from predefined YouTube playlist
- Good for initial testing

#### `retry-failed-playlists.sh`
**Purpose**: Retry playlists that failed due to rate limits
**Usage**: `./retry-failed-playlists.sh`

**Features**:
- Targets specific failed playlists
- Uses API key rotation
- Implements retry logic with delays

---

## Troubleshooting

### Common Issues

#### "Player offline" in Admin Console
**Cause**: Player window not running or not sending heartbeat
**Solution**:
1. Make sure Player window is open and running
2. Check browser console for errors
3. Verify network connection to Supabase

#### "Insufficient credits" error in Kiosk
**Cause**: No credits available or freeplay disabled
**Solution**:
1. Click "Insert Coin (Dev)" button for testing
2. Or enable free play:
   ```sql
   UPDATE player_settings SET freeplay = true;
   ```

#### Edge Functions not working
**Cause**: Functions not deployed or configuration issues
**Solution**:
```bash
# Check function logs
supabase functions logs --local

# Redeploy functions
npm run supabase:deploy
```

#### Realtime not updating
**Cause**: Realtime not enabled or RLS policy issues
**Solution**:
1. Check Realtime is enabled in Supabase dashboard
2. Verify RLS policies allow your auth level
3. Check browser console for connection errors

#### YouTube API quota exceeded
**Cause**: Hit daily API limit (10,000 queries per key)
**Solution**:
1. Wait for quota reset (midnight Pacific Time)
2. Use multiple API keys (system supports rotation)
3. Consider upgrading to paid tier

### Debug Commands

#### Check Player Status
```bash
curl http://localhost:54321/rest/v1/players \
  -H "apikey: YOUR_ANON_KEY"
```

#### Test Edge Function
```bash
curl -X POST http://localhost:54321/functions/v1/queue-manager \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "player_id": "00000000-0000-0000-0000-000000000001",
    "action": "clear"
  }'
```

#### View Edge Function Logs
```bash
supabase functions logs --local
```

---

## Advanced Configuration

### Production Deployment

#### Supabase Cloud Setup
1. Create project at [database.new](https://database.new)
2. Run migrations: `supabase db push`
3. Deploy Edge Functions: `npm run supabase:deploy`
4. Enable Realtime for all tables

#### Frontend Deployment (Vercel)
```bash
# Deploy Admin Console
cd web/admin
echo "VITE_SUPABASE_URL=https://xxxxx.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.production
vercel --prod

# Deploy Player Window
cd ../player
echo "VITE_SUPABASE_URL=https://xxxxx.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.production
vercel --prod

# Deploy Kiosk Interface
cd ../kiosk
echo "VITE_SUPABASE_URL=https://xxxxx.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.production
vercel --prod
```

### Performance Optimization

#### Free Tier Compliance
Current usage estimates:
- **Invocations**: 25,500/month (5% of 500K limit)
- **CPU Time**: 21 minutes/month (0.7% of 50 hours)
- **Bandwidth**: 127 MB/month (0.02% of 500 GB)
- **Realtime Connections**: 3 (1.5% of 200)

#### Database Optimization
```sql
-- Add indexes for performance
CREATE INDEX idx_queue_player_order ON queue(player_id, sort_order);
CREATE INDEX idx_media_items_source ON media_items(source_id, source_type);
CREATE INDEX idx_playlist_items_playlist ON playlist_items(playlist_id);
```

### Security Configuration

#### API Key Security
- **Never expose service_role key** in frontend code
- **Use environment variables** for sensitive data
- **Enable API restrictions** in Google Cloud Console
- **Rotate keys regularly**

#### Row Level Security (RLS)
All tables have RLS policies configured:
- **Admin users**: Full access to all tables
- **Kiosk users**: Read-only access to media, write access to own sessions
- **Player**: Read/write access to own status only

### Custom Development

#### Adding New Features
1. **Update Database Schema**: Create migration
2. **Add Types**: Update shared client interfaces
3. **Implement UI**: Add components to relevant app
4. **Test**: Verify with all three apps running

#### Code Style Guidelines
- **TypeScript strict mode** enabled
- **Functional React components** only
- **Async/await** over promises
- **Explicit error handling** required
- **Components under 200 lines**

---

## Quick Reference Commands

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

### URLs
- **Admin**: http://localhost:5173
- **Player**: http://localhost:5174
- **Kiosk**: http://localhost:5175
- **Supabase Studio**: http://localhost:54323

---

## Support Resources

- **GitHub Repository**: https://github.com/SystemVirtue/obie-v5
- **Supabase Documentation**: https://supabase.com/docs
- **React Documentation**: https://react.dev
- **Vite Documentation**: https://vitejs.dev
- **YouTube Data API**: https://developers.google.com/youtube/v3

---

**🎉 Thank you for using Obie Jukebox v2!**

For issues, feature requests, or questions, please open an issue on GitHub or consult the documentation above.
