#!/bin/bash
# Retry Failed Playlist Imports
# This script retries importing videos for playlists that previously failed due to rate limits

set -e

echo "🔄 Retrying failed playlist imports..."

# Configuration
SUPABASE_URL="${SUPABASE_URL:-http://localhost:54321}"
REQUEST_DELAY=3  # Delay in seconds between requests

# Check if Supabase is running
if ! curl -s "${SUPABASE_URL}/health" > /dev/null 2>&1; then
  echo "❌ Error: Supabase is not running at ${SUPABASE_URL}"
  echo "   Please start Supabase with: supabase start"
  exit 1
fi

# Get Supabase configuration
echo "📋 Getting Supabase credentials..."
SUPABASE_URL=$(supabase status | grep "API URL" | awk '{print $NF}')
SERVICE_ROLE_KEY=$(supabase status | grep "Secret key" | awk '{print $NF}')

if [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: Could not get Supabase service role key"
  echo "   Make sure Supabase is running: supabase start"
  exit 1
fi

# Failed playlists to retry (playlist_id from DB | YouTube playlist ID)
FAILED_PLAYLISTS=(
  "6fcf5ecf-09fb-4075-8293-d2ccd9920e27|PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH|Obie Playlist"
  "9949707d-ccc5-48e0-8556-6a3d8debf7f9|PLN9QqCogPsXIkPh6xm7cxSN9yTVaEoj0j|Obie Jo"
  "d09676d2-7b3a-42ff-8802-66f485b18288|PLN9QqCogPsXLAtgvLQ0tvpLv820R7PQsM|Karaoke"
)

echo ""
echo "📚 Found ${#FAILED_PLAYLISTS[@]} playlists to retry"
echo ""

TOTAL_SUCCESS=0
TOTAL_FAILED=0
TOTAL_VIDEOS=0

# Process each failed playlist
for playlist_info in "${FAILED_PLAYLISTS[@]}"; do
  IFS='|' read -r DB_PLAYLIST_ID YOUTUBE_PLAYLIST_ID PLAYLIST_NAME <<< "$playlist_info"
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📂 Retrying: ${PLAYLIST_NAME}"
  echo "   DB ID: ${DB_PLAYLIST_ID}"
  echo "   YouTube ID: ${YOUTUBE_PLAYLIST_ID}"
  echo ""
  
  echo "   🔍 Fetching videos from YouTube..."
  YOUTUBE_URL="https://www.youtube.com/playlist?list=${YOUTUBE_PLAYLIST_ID}"
  
  SCRAPE_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/playlist-manager" \
    -H "Content-Type: application/json" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -d "{
      \"action\": \"scrape\",
      \"playlist_id\": \"${DB_PLAYLIST_ID}\",
      \"url\": \"${YOUTUBE_URL}\"
    }")
  
  # Check for errors in scrape
  if echo "$SCRAPE_RESPONSE" | grep -q '"error"'; then
    ERROR_MSG=$(echo "$SCRAPE_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d '"' -f4)
    echo "   ❌ Error importing videos: ${ERROR_MSG}"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
    echo ""
    
    # Add delay before next retry
    if [ $((${#FAILED_PLAYLISTS[@]} - TOTAL_SUCCESS - TOTAL_FAILED)) -gt 0 ]; then
      echo "   ⏳ Waiting ${REQUEST_DELAY}s before next retry..."
      sleep ${REQUEST_DELAY}
    fi
    
    continue
  fi
  
  # Parse and display results
  COUNT=$(echo "$SCRAPE_RESPONSE" | grep -o '"count":[0-9]*' | cut -d ':' -f2)
  
  if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
    echo "   ⚠️  No videos found"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  else
    echo "   ✅ Successfully imported ${COUNT} videos!"
    TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
    TOTAL_VIDEOS=$((TOTAL_VIDEOS + COUNT))
  fi
  
  # Add delay before next retry
  if [ $((${#FAILED_PLAYLISTS[@]} - TOTAL_SUCCESS - TOTAL_FAILED)) -gt 0 ]; then
    echo "   ⏳ Waiting ${REQUEST_DELAY}s before next retry..."
    sleep ${REQUEST_DELAY}
  fi
  
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Retry Summary:"
echo "   Total Playlists: ${#FAILED_PLAYLISTS[@]}"
echo "   ✅ Successful: ${TOTAL_SUCCESS}"
echo "   ❌ Failed: ${TOTAL_FAILED}"
echo "   🎵 Total Videos: ${TOTAL_VIDEOS}"
echo ""

if [ ${TOTAL_SUCCESS} -eq 0 ]; then
  echo "⚠️  No playlists were successfully imported"
  echo ""
  echo "This likely means YouTube API quota is still exceeded."
  echo "Please wait for quota reset (daily at midnight Pacific Time)"
  echo "or try again later."
  exit 1
else
  echo "🎉 Retry completed!"
  echo ""
  echo "Next steps:"
  echo "1. Open Admin console: http://localhost:5173"
  echo "2. Go to Playlists tab to view all imported playlists"
  echo "3. Start the Player: http://localhost:5174"
fi
