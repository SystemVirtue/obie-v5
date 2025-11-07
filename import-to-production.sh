#!/bin/bash
# Import Playlists to Production Supabase
# Run this after setting up your production database

set -e

echo "🎵 Importing playlists to PRODUCTION Obie Jukebox..."
echo ""
echo "⚠️  WARNING: This will import playlists to your production Supabase instance"
echo "   Project: syccqoextpxifmumvxqw.supabase.co"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Aborted"
  exit 1
fi

# Production Supabase Configuration
echo ""
echo "📋 Enter your PRODUCTION Supabase credentials:"
echo "   Get these from: https://supabase.com/dashboard/project/syccqoextpxifmumvxqw/settings/api"
echo ""
read -p "Supabase URL (https://syccqoextpxifmumvxqw.supabase.co): " PROD_SUPABASE_URL
read -p "Service Role Key (secret key, starts with 'eyJ...'): " PROD_SERVICE_KEY

# Use defaults if empty
PROD_SUPABASE_URL="${PROD_SUPABASE_URL:-https://syccqoextpxifmumvxqw.supabase.co}"

if [ -z "$PROD_SERVICE_KEY" ]; then
  echo "❌ Error: Service role key is required"
  exit 1
fi

# Configuration
DEFAULT_PLAYER_ID="00000000-0000-0000-0000-000000000001"
REQUEST_DELAY=3  # Delay in seconds between requests

# Define playlists (same as local)
declare -a PLAYLISTS=(
  "PLJ7vMjpVbhBWLWJpweVDki43Wlcqzsqdu|DJAMMMS Default Playlist"
  "PLN9QqCogPsXIoSObV0F39OZ_MlRZ9tRT9|Obie Nights"
  "PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH|Obie Playlist"
  "PLN9QqCogPsXIkPh6xm7cxSN9yTVaEoj0j|Obie Jo"
  "PLN9QqCogPsXLAtgvLQ0tvpLv820R7PQsM|Karaoke"
  "PLN9QqCogPsXLsv5D5ZswnOSnRIbGU80IS|Poly"
  "PLN9QqCogPsXIqfwdfe4hf3qWM1mFweAXP|Obie Johno"
)

echo ""
echo "📚 Found ${#PLAYLISTS[@]} playlists to import"
echo ""

TOTAL_SUCCESS=0
TOTAL_FAILED=0
TOTAL_VIDEOS=0

# Process each playlist
for playlist in "${PLAYLISTS[@]}"; do
  IFS='|' read -r YOUTUBE_ID NAME <<< "$playlist"
  
  echo "----------------------------------------"
  echo "📺 Importing: $NAME"
  echo "   YouTube ID: $YOUTUBE_ID"
  echo ""
  
  # Create playlist via playlist-manager function
  echo "   Creating playlist..."
  RESULT=$(curl -s -X POST "${PROD_SUPABASE_URL}/functions/v1/playlist-manager" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${PROD_SERVICE_KEY}" \
    -H "apikey: ${PROD_SERVICE_KEY}" \
    -d "{
      \"action\": \"create\",
      \"player_id\": \"${DEFAULT_PLAYER_ID}\",
      \"name\": \"${NAME}\"
    }")
  
  PLAYLIST_ID=$(echo "$RESULT" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  
  if [ -z "$PLAYLIST_ID" ]; then
    echo "   ❌ Failed to create playlist"
    echo "   Response: $RESULT"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
    continue
  fi
  
  echo "   ✅ Created playlist: $PLAYLIST_ID"
  echo ""
  
  # Load playlist items via scrape action
  echo "   Loading playlist items from YouTube..."
  YOUTUBE_URL="https://www.youtube.com/playlist?list=${YOUTUBE_ID}"
  LOAD_RESULT=$(curl -s -X POST "${PROD_SUPABASE_URL}/functions/v1/playlist-manager" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${PROD_SERVICE_KEY}" \
    -H "apikey: ${PROD_SERVICE_KEY}" \
    -d "{
      \"action\": \"scrape\",
      \"playlist_id\": \"${PLAYLIST_ID}\",
      \"url\": \"${YOUTUBE_URL}\"
    }")
  
  # Check if successful
  if echo "$LOAD_RESULT" | grep -q '"success":true'; then
    VIDEO_COUNT=$(echo "$LOAD_RESULT" | grep -o '"items_added":[0-9]*' | cut -d':' -f2)
    echo "   ✅ Loaded ${VIDEO_COUNT} videos"
    TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
    TOTAL_VIDEOS=$((TOTAL_VIDEOS + VIDEO_COUNT))
  else
    echo "   ❌ Failed to load playlist items"
    echo "   Response: $LOAD_RESULT"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  fi
  
  echo ""
  
  # Delay between playlists
  if [ $TOTAL_SUCCESS -lt ${#PLAYLISTS[@]} ]; then
    echo "   ⏳ Waiting ${REQUEST_DELAY}s before next playlist..."
    sleep $REQUEST_DELAY
  fi
done

echo "========================================"
echo "✅ Import Complete!"
echo ""
echo "Summary:"
echo "  - Playlists imported: $TOTAL_SUCCESS"
echo "  - Failed: $TOTAL_FAILED"
echo "  - Total videos: $TOTAL_VIDEOS"
echo ""
echo "🎉 Production database is ready!"
echo ""
echo "Next steps:"
echo "1. Update Render environment variables with production credentials"
echo "2. Redeploy all three apps on Render"
echo "3. Test at: https://obie-player.onrender.com"
