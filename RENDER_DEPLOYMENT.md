# Render.com Deployment Guide

This guide explains how to deploy Obie Jukebox v5 to Render.com.

## Prerequisites

1. **Supabase Project**: Create a project at [supabase.com](https://supabase.com)
2. **Render Account**: Sign up at [render.com](https://render.com)
3. **GitHub Repository**: Fork or clone this repo

## Step 1: Set Up Supabase

1. Create a new Supabase project
2. Run migrations:
   ```bash
   # Install Supabase CLI
   npm install -g supabase
   
   # Link to your project
   supabase link --project-ref your-project-ref
   
   # Push migrations
   supabase db push
   ```
3. Deploy Edge Functions:
   ```bash
   supabase functions deploy queue-manager
   supabase functions deploy player-control
   supabase functions deploy kiosk-handler
   supabase functions deploy playlist-manager
   supabase functions deploy youtube-scraper
   ```
4. Get your credentials from: https://supabase.com/dashboard/project/_/settings/api
   - `VITE_SUPABASE_URL` (Project URL)
   - `VITE_SUPABASE_ANON_KEY` (anon/public key)

## Step 2: Deploy to Render (Option A - Blueprint)

This is the easiest method - deploys all three apps at once.

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New"** → **"Blueprint"**
3. Connect your GitHub repository
4. Render will detect `render.yaml` and show 3 services:
   - `obie-admin` - Admin console
   - `obie-player` - Player app
   - `obie-kiosk` - Kiosk app
5. Set environment variables for each service:
   - `VITE_SUPABASE_URL`: Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anon key
6. Click **"Apply"**

Render will build and deploy all three apps automatically!

## Step 2: Deploy to Render (Option B - Manual)

If you prefer to deploy apps individually:

### Admin App
1. New **Static Site**
2. **Build Command**: `cd web/admin && npm install && npm run build`
3. **Publish Directory**: `web/admin/dist`
4. **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

### Player App
1. New **Static Site**
2. **Build Command**: `cd web/player && npm install && npm run build`
3. **Publish Directory**: `web/player/dist`
4. **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

### Kiosk App
1. New **Static Site**
2. **Build Command**: `cd web/kiosk && npm install && npm run build`
3. **Publish Directory**: `web/kiosk/dist`
4. **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

## Step 3: Configure URLs

After deployment, you'll get URLs like:
- Admin: `https://obie-admin.onrender.com`
- Player: `https://obie-player.onrender.com`
- Kiosk: `https://obie-kiosk.onrender.com`

Update your Supabase project settings:
1. Go to: https://supabase.com/dashboard/project/_/auth/url-configuration
2. Add your Render URLs to **Site URL** and **Redirect URLs**

## Step 4: Test Your Deployment

1. **Admin**: Open `https://obie-admin.onrender.com`
   - Should show player status and queue management
2. **Player**: Open `https://obie-player.onrender.com`
   - Should connect and show "Waiting for song..."
3. **Kiosk**: Open `https://obie-kiosk.onrender.com`
   - Should show search interface

## Troubleshooting

### Build fails with "Module not found"
- Check that `package.json` exists in each web app directory
- Verify build command paths are correct

### Blank page after deployment
- Check browser console for errors
- Verify environment variables are set correctly
- Check Supabase URL and anon key

### Player not connecting
- Verify Supabase Edge Functions are deployed
- Check CORS settings in Supabase
- Verify player is "online" in database

### Realtime subscriptions not working
- Enable Realtime in Supabase: Settings → Database → Replication
- Check RLS policies are configured correctly

## Free Tier Limits

Render free tier includes:
- ✅ 750 hours/month for web services
- ✅ Automatic HTTPS
- ✅ Custom domains
- ⚠️ Apps sleep after 15 min inactivity (paid plans keep alive)

## Production Recommendations

For production use:
1. Upgrade to Render **Paid Plan** ($7/month per service)
   - Keeps apps awake 24/7
   - Faster builds
   - Better performance
2. Use custom domain names
3. Set up monitoring/alerts
4. Enable auto-deploy from main branch
5. Configure backup/disaster recovery

## Support

- Render Docs: https://render.com/docs
- Supabase Docs: https://supabase.com/docs
- Project Issues: https://github.com/SystemVirtue/obie-v5/issues
