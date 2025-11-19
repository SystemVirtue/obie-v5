#!/bin/bash
# Retry Failed Playlists from YouTube
# This script retries loading the playlists that failed in the previous run

set -e

echo "🔄 Retrying failed playlists from YouTube..."

# Configuration
SUPABASE_URL="${SUPABASE_URL:-http://localhost:54321}"
DEFAULT_PLAYER_ID="00000000-0000-0000-0000-000000000001"
REQUEST_DELAY=5  # Longer delay for retries

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

# Define failed playlists to retry (playlist_id|playlist_name)
declare -a FAILED_PLAYLISTS=(
  "PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH|Obie Playlist"
  "PLN9QqCogPsXLAtgvLQ0tvpLv820R7PQsM|Karaoke"
  "PLN9QqCogPsXIkPh6xm7cxSN9yTVaEoj0j|Obie Jo"
)

echo ""
echo "📚 Retrying ${#FAILED_PLAYLISTS[@]} failed playlists"
echo ""

TOTAL_SUCCESS=0
TOTAL_FAILED=0
TOTAL_VIDEOS=0

# Process each failed playlist
for playlist_info in "${FAILED_PLAYLISTS[@]}"; do
  IFS='|' read -r PLAYLIST_ID PLAYLIST_NAME <<< "$playlist_info"
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📂 Retrying: ${PLAYLIST_NAME}"
  echo "   YouTube ID: ${PLAYLIST_ID}"
  echo ""
  
  # Get existing playlist ID
  DB_PLAYLIST_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -c "SELECT id FROM playlists WHERE player_id = '${DEFAULT_PLAYER_ID}' AND name = '${PLAYLIST_NAME}' LIMIT 1;" 2>/dev/null | tr -d ' ')
  
  if [ -z "$DB_PLAYLIST_ID" ]; then
    echo "   ❌ Could not find existing playlist '${PLAYLIST_NAME}'"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
    echo ""
    continue
  fi
  
  echo "   📋 Found existing playlist ID: ${DB_PLAYLIST_ID}"
  
  # Get current item count before retry
  CURRENT_COUNT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -c "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = '${DB_PLAYLIST_ID}';" 2>/dev/null | tr -d ' ')
  echo "   📊 Current items in playlist: ${CURRENT_COUNT}"
  
  # Add longer delay before YouTube API call for retries
  echo "   ⏳ Waiting ${REQUEST_DELAY}s before retrying YouTube..."
  sleep ${REQUEST_DELAY}
  
  # Step 2: Retry loading videos from YouTube (safe - won't delete existing items)
  echo "   🔄 Retrying videos from YouTube..."
  YOUTUBE_URL="https://www.youtube.com/playlist?list=${PLAYLIST_ID}"
  
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
    echo "   ❌ Error retrying videos: ${ERROR_MSG}"
    echo "   ✅ Existing ${CURRENT_COUNT} items preserved"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
    echo ""
    continue
  fi
  
  # Parse and display results
  COUNT=$(echo "$SCRAPE_RESPONSE" | grep -o '"count":[0-9]*' | cut -d ':' -f2)
  
  if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
    echo "   ⚠️  No videos found on retry"
    echo "   ✅ Existing ${CURRENT_COUNT} items preserved"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  else
    echo "   ✅ Successfully reloaded ${COUNT} videos!"
    echo "   📊 Total items now: $(($CURRENT_COUNT + $COUNT))"
    TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
    TOTAL_VIDEOS=$((TOTAL_VIDEOS + COUNT))
  fi
  
  # Add delay before next playlist
  if [ $((${#FAILED_PLAYLISTS[@]} - TOTAL_SUCCESS - TOTAL_FAILED)) -gt 0 ]; then
    echo "   ⏳ Waiting ${REQUEST_DELAY}s before next retry..."
    sleep ${REQUEST_DELAY}
  fi
  
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Retry Summary:"
echo "   Total Retries: ${#FAILED_PLAYLISTS[@]}"
echo "   ✅ Successful: ${TOTAL_SUCCESS}"
echo "   ❌ Still Failed: ${TOTAL_FAILED}"
echo "   🎵 Videos Added: ${TOTAL_VIDEOS}"
echo ""

if [ "$TOTAL_SUCCESS" -gt 0 ]; then
  echo "🎉 Some retries succeeded!"
else
  echo "⚠️  All retries failed - these playlists may be private or API quota exceeded"
  echo ""
  echo "Troubleshooting:"
  echo "1. Check if playlists are public on YouTube"
  echo "2. Verify YouTube API quota hasn't been exceeded"
  echo "3. Try again later when API quota resets"
fi
