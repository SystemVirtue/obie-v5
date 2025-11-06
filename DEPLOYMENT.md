# Deployment Guide - Obie Jukebox v2

This guide covers deploying the jukebox to production.

---

## Prerequisites

- Supabase Cloud project ([database.new](https://database.new))
- Vercel/Netlify account (for frontend hosting)
- Domain (optional)

---

## Step 1: Supabase Setup

### 1.1 Create Project

1. Go to [database.new](https://database.new)
2. Create new project
3. Wait for provisioning (~2 minutes)
4. Note your:
   - Project URL: `https://xxxxx.supabase.co`
   - `anon` key (Settings → API)
   - `service_role` key (Settings → API)

### 1.2 Run Migrations

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>

# Run migrations
supabase db push

# Or manually: Copy content of supabase/migrations/0001_initial_schema.sql
# to SQL Editor in Supabase dashboard and run
```

### 1.3 Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy queue-manager
supabase functions deploy player-control
supabase functions deploy kiosk-handler
supabase functions deploy playlist-manager

# Or deploy all at once
npm run supabase:deploy
```

### 1.4 Enable Realtime

In Supabase dashboard:
1. Go to **Database → Replication**
2. Enable Realtime for all tables:
   - `players`
   - `playlists`
   - `playlist_items`
   - `media_items`
   - `queue`
   - `player_status`
   - `player_settings`
   - `kiosk_sessions`
   - `system_logs`

---

## Step 2: Frontend Deployment

### Option A: Vercel (Recommended)

Each frontend app is deployed separately.

#### Deploy Admin Console

```bash
cd web/admin

# Create .env.production
echo "VITE_SUPABASE_URL=https://xxxxx.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.production

# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

#### Deploy Player Window

```bash
cd web/player

# Create .env.production
echo "VITE_SUPABASE_URL=https://xxxxx.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.production

# Deploy
vercel --prod
```

#### Deploy Kiosk Interface

```bash
cd web/kiosk

# Create .env.production
echo "VITE_SUPABASE_URL=https://xxxxx.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.production

# Deploy
vercel --prod
```

### Option B: Netlify

```bash
# Build all apps
npm run build

# Deploy each dist folder:
# - web/admin/dist → admin.yourdomain.com
# - web/player/dist → player.yourdomain.com
# - web/kiosk/dist → kiosk.yourdomain.com
```

In Netlify dashboard:
1. Create new site from folder
2. Set build command: `npm run build`
3. Set publish directory: `dist`
4. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

### Option C: Custom Server (nginx)

```bash
# Build all apps
npm run build

# Copy to web server
scp -r web/admin/dist/* user@server:/var/www/admin
scp -r web/player/dist/* user@server:/var/www/player
scp -r web/kiosk/dist/* user@server:/var/www/kiosk
```

Example nginx config:

```nginx
# Admin Console
server {
    listen 80;
    server_name admin.jukebox.example.com;
    root /var/www/admin;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Player Window
server {
    listen 80;
    server_name player.jukebox.example.com;
    root /var/www/player;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Kiosk Interface
server {
    listen 80;
    server_name kiosk.jukebox.example.com;
    root /var/www/kiosk;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Step 3: Custom Domain (Optional)

### Vercel

1. Go to project settings → Domains
2. Add custom domain
3. Update DNS records as instructed

### Netlify

1. Go to Domain settings
2. Add custom domain
3. Update DNS records

---

## Step 4: Authentication Setup

### Enable Email Authentication

In Supabase dashboard:
1. Go to **Authentication → Settings**
2. Enable Email provider
3. Configure Site URL: `https://admin.yourdomain.com`
4. Add redirect URLs:
   - `https://admin.yourdomain.com`
   - `http://localhost:5173` (for dev)

### Create Admin User

```sql
-- In Supabase SQL Editor
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES (
  'admin@example.com',
  crypt('your-password', gen_salt('bf')),
  NOW()
);
```

Or use Supabase dashboard: **Authentication → Users → Add User**

---

## Step 5: Production Checklist

### Security

- [ ] Rotate `service_role` key (don't expose in frontend)
- [ ] Enable RLS on all tables (already done in migration)
- [ ] Configure CORS in Edge Functions (already done)
- [ ] Use HTTPS only
- [ ] Enable 2FA for Supabase account

### Performance

- [ ] Enable database connection pooling (default in Supabase)
- [ ] Add indexes for frequent queries (already done in migration)
- [ ] Monitor Edge Function cold starts
- [ ] Use CDN for frontend assets (Vercel/Netlify auto)

### Monitoring

- [ ] Enable Supabase dashboard monitoring
- [ ] Set up Edge Function logs alerts
- [ ] Monitor Realtime connection count
- [ ] Track database size and row counts

### Backups

```bash
# Backup database (via CLI)
supabase db dump --data-only > backup.sql

# Or use Supabase dashboard: Database → Backups
```

---

## Step 6: Post-Deployment

### Test All Flows

1. **Admin Console**:
   - [ ] Login works
   - [ ] Can view queue
   - [ ] Can add/remove songs
   - [ ] Settings update
   - [ ] Logs display

2. **Player Window**:
   - [ ] Heartbeat active (check status)
   - [ ] Plays YouTube videos
   - [ ] Reports status correctly
   - [ ] Transitions to next song

3. **Kiosk Interface**:
   - [ ] Search works
   - [ ] Credit system works
   - [ ] Request adds to priority queue
   - [ ] Real-time updates

### Configure Player Settings

```sql
UPDATE player_settings SET
  freeplay = false,
  coin_per_song = 1,
  branding = '{
    "name": "My Jukebox",
    "logo": "https://example.com/logo.png",
    "theme": "dark"
  }'::jsonb
WHERE player_id = '00000000-0000-0000-0000-000000000001';
```

---

## Troubleshooting

### Edge Functions not accessible

**Check**:
```bash
# Test function endpoint
curl -X POST https://xxxxx.supabase.co/functions/v1/queue-manager \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"player_id": "00000000-0000-0000-0000-000000000001", "action": "clear"}'
```

### Realtime not working

1. Check Realtime is enabled in dashboard
2. Verify RLS policies allow reads
3. Check browser console for connection errors

### CORS errors

Edge Functions have CORS enabled. If issues persist:
```typescript
// In _shared/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yourdomain.com', // Restrict to your domain
  // ...
};
```

---

## Scaling

### Free Tier Limits

Current usage: ~25K invocations/month
Free limit: 500K invocations/month
**Headroom**: ~20x 🎉

### When to Upgrade

Upgrade to Supabase Pro ($25/month) when:
- \>500K Edge Function invocations/month
- \>200 concurrent Realtime connections
- \>8GB database size

### Cost Estimate (Pro Tier)

- Base: $25/month
- Additional invocations: $2 per 1M
- **Total for moderate usage**: ~$30/month

---

## Rollback Plan

### Database

```bash
# Restore from backup
psql $DATABASE_URL < backup.sql

# Or use Supabase dashboard: Database → Backups → Restore
```

### Edge Functions

```bash
# Redeploy previous version
git checkout <previous-commit>
supabase functions deploy
```

### Frontend

Vercel/Netlify keep deployment history:
1. Go to Deployments
2. Select previous deployment
3. Click "Promote to Production"

---

## Support

- **Supabase Issues**: [github.com/supabase/supabase](https://github.com/supabase/supabase/issues)
- **Supabase Docs**: [supabase.com/docs](https://supabase.com/docs)
- **Discord**: [discord.supabase.com](https://discord.supabase.com)

---

**🎉 Your jukebox is now live!**
