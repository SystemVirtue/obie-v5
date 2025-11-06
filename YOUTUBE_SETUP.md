# YouTube API Setup

To enable YouTube playlist import and search, you need a YouTube Data API v3 key.

## Get Your API Key

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

5. **Secure Your Key (Recommended)**
   - Click "Edit API Key"
   - Under "Application restrictions": Choose "HTTP referrers" or "IP addresses"
   - Under "API restrictions": Select "Restrict key" → Check "YouTube Data API v3"
   - Save

## Configure Local Development

### Option A: Environment Variable (Quick Test)

```bash
export YOUTUBE_API_KEY=your-api-key-here
supabase stop
supabase start
```

### Option B: Supabase Secrets (Recommended)

Create `.env` file in project root:

```bash
# /Users/mikeclarkin/Documents/GitHub/obie-v5/.env
YOUTUBE_API_KEY=your-api-key-here
```

Then link to Edge Functions:

```bash
# Set the secret
echo "YOUTUBE_API_KEY=your-api-key-here" > supabase/.env.local

# Restart Supabase
supabase stop
supabase start
```

## Test It

```bash
# Populate default playlist
./populate-playlist.sh
```

## Production Deployment

For Supabase Cloud, set secrets via CLI:

```bash
# Set YouTube API key
supabase secrets set YOUTUBE_API_KEY=your-api-key-here

# Verify
supabase secrets list
```

## Rate Limits

- **Free Tier**: 10,000 queries/day
- **Playlist fetch**: ~2-3 queries (videos batch fetched)
- **Search**: 100 queries/search request
- **Single video**: 1 query

**Tip**: The system caches media_items by `source_id`, so repeated requests don't consume API quota.

## Troubleshooting

### "YouTube API key not configured"
- Make sure `YOUTUBE_API_KEY` is set in environment
- Restart Supabase after setting: `supabase stop && supabase start`

### "Quota exceeded"
- You've hit the 10,000 queries/day limit
- Wait until next day (resets at midnight Pacific Time)
- Consider upgrading to paid tier or request quota increase

### "API not enabled"
- Go to: https://console.cloud.google.com/apis/library/youtube.googleapis.com
- Click "Enable"
- Wait a few minutes for propagation

### "Invalid API key"
- Check the key is copied correctly (no spaces)
- Verify API restrictions allow YouTube Data API v3
- Make sure key hasn't been deleted in Google Cloud Console
