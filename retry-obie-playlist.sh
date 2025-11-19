#!/bin/bash
# Retry Obie Playlist with API Key Rotation
# This script specifically retries the Obie Playlist with multiple API key attempts

set -e

echo "🔄 Retrying Obie Playlist with API key rotation..."

# Configuration
SUPABASE_URL="${SUPABASE_URL:-http://localhost:54321}"
DEFAULT_PLAYER_ID="00000000-0000-0000-0000-000000000001"
PLAYLIST_ID="PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH"
PLAYLIST_NAME="ObiePlaylist"
MAX_ATTEMPTS=3  # Try up to 3 times with different API keys

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

echo ""
echo "📂 Retrying: ${PLAYLIST_NAME}"
echo "   YouTube ID: ${PLAYLIST_ID}"
echo ""

# Get existing playlist ID
DB_PLAYLIST_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -c "SELECT id FROM playlists WHERE player_id = '${DEFAULT_PLAYER_ID}' AND name = '${PLAYLIST_NAME}' LIMIT 1;" 2>/dev/null | tr -d ' ')

if [ -z "$DB_PLAYLIST_ID" ]; then
  echo "❌ Could not find existing playlist '${PLAYLIST_NAME}'"
  exit 1
fi

echo "📋 Found existing playlist ID: ${DB_PLAYLIST_ID}"

# Get current item count
CURRENT_COUNT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -c "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = '${DB_PLAYLIST_ID}';" 2>/dev/null | tr -d ' ')
echo "📊 Current items in playlist: ${CURRENT_COUNT}"

echo ""
echo "🔄 Attempting to load with API key rotation (up to ${MAX_ATTEMPTS} attempts)..."
echo ""

SUCCESS=false
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ] && [ "$SUCCESS" = false ]; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔑 Attempt ${ATTEMPT}/${MAX_ATTEMPTS}"
  echo ""
  
  # Add delay between attempts
  if [ $ATTEMPT -gt 1 ]; then
    echo "⏳ Waiting 10s before next attempt..."
    sleep 10
  fi
  
  # Try to load the playlist
  YOUTUBE_URL="https://www.youtube.com/playlist?list=${PLAYLIST_ID}"
  
  echo "🔍 Fetching from YouTube..."
  SCRAPE_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/playlist-manager" \
    -H "Content-Type: application/json" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -d "{
      \"action\": \"scrape\",
      \"playlist_id\": \"${DB_PLAYLIST_ID}\",
      \"url\": \"${YOUTUBE_URL}\"
    }")
  
  # Check for errors
  if echo "$SCRAPE_RESPONSE" | grep -q '"error"'; then
    ERROR_MSG=$(echo "$SCRAPE_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d '"' -f4)
    echo "❌ Attempt ${ATTEMPT} failed: ${ERROR_MSG}"
    echo "✅ Existing ${CURRENT_COUNT} items preserved"
    
    # Check if it's a quota exceeded error - if so, we might need to wait longer
    if echo "$ERROR_MSG" | grep -q "quota\|limit\|exceeded"; then
      echo "⚠️  API quota issue detected - this may require waiting for quota reset"
      if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        echo "⏳ Waiting 30s before next attempt..."
        sleep 30
      fi
    fi
  else
    # Parse results
    COUNT=$(echo "$SCRAPE_RESPONSE" | grep -o '"count":[0-9]*' | cut -d ':' -f2)
    
    if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
      echo "⚠️  Attempt ${ATTEMPT}: No videos found"
      echo "✅ Existing ${CURRENT_COUNT} items preserved"
    else
      echo "✅ Attempt ${ATTEMPT} SUCCESS! Loaded ${COUNT} videos!"
      echo "📊 Total items now: $(($CURRENT_COUNT + $COUNT))"
      SUCCESS=true
    fi
  fi
  
  ATTEMPT=$((ATTEMPT + 1))
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$SUCCESS" = true ]; then
  echo "🎉 Obie Playlist retry succeeded!"
else
  echo "❌ All attempts failed for Obie Playlist"
  echo ""
  echo "Possible reasons:"
  echo "1. Playlist is private or deleted on YouTube"
  echo "2. All API keys have exceeded quota"
  echo "3. Network or YouTube API issues"
  echo ""
  echo "The existing ${CURRENT_COUNT} items in the playlist have been preserved."
fi
