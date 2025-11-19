#!/bin/bash
# Reload Multiple Playlists from YouTube (Safe Mode)
# This script reloads existing playlists from YouTube without overwriting on failure

set -e

echo "🔄 Reloading playlists from YouTube (safe mode - preserves existing data on failure)..."

# Configuration
SUPABASE_URL="${SUPABASE_URL:-http://localhost:54321}"
DEFAULT_PLAYER_ID="00000000-0000-0000-0000-000000000001"
REQUEST_DELAY=3  # Delay in seconds between requests to avoid rate limiting

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

# Define playlists to reload (playlist_id|playlist_name)
declare -a PLAYLISTS=(
  "PLJ7vMjpVbhBWLWJpweVDki43Wlcqzsqdu|DJAMMMS Default Playlist"
  "PLN9QqCogPsXIoSObV0F39OZ_MlRZ9tRT9|Obie Nights"
  "PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH|Obie Playlist"
  "PLN9QqCogPsXIkPh6xm7cxSN9yTVaEoj0j|Obie Jo"
  "PLN9QqCogPsXLAtgvLQ0tvpLv820R7PQsM|Karaoke"
  "PLN9QqCogPsXLsv5D5ZswnOSnRIbGU80IS|Poly"
  "PLN9QqCogPsXKZsYwYEpHKUhjCJlvVB44h|Obie Johno"
  "PLfqlpuz-LWL28EHinbSqNhj2nFZS-WQ-I|Obie Irish"
  "PLN9QqCogPsXIqfwdfe4hf3qWM1mFweAXP|Metallica"
)

echo ""
echo "📚 Found ${#PLAYLISTS[@]} playlists to reload"
echo ""

TOTAL_SUCCESS=0
TOTAL_FAILED=0
TOTAL_VIDEOS=0

# Process each playlist
for playlist_info in "${PLAYLISTS[@]}"; do
  IFS='|' read -r PLAYLIST_ID PLAYLIST_NAME <<< "$playlist_info"
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📂 Processing: ${PLAYLIST_NAME}"
  echo "   YouTube ID: ${PLAYLIST_ID}"
  echo ""
  
  # Step 1: Check if playlist already exists
  echo "   🔍 Checking if playlist exists..."
  EXISTING_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/playlist-manager" \
    -H "Content-Type: application/json" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -d "{
      \"action\": \"create\",
      \"player_id\": \"${DEFAULT_PLAYER_ID}\",
      \"name\": \"${PLAYLIST_NAME}\"
    }")
  
  # Check if playlist already exists (error about unique constraint)
  if echo "$EXISTING_RESPONSE" | grep -q '"error"'; then
    ERROR_MSG=$(echo "$EXISTING_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d '"' -f4)
    if echo "$ERROR_MSG" | grep -q "duplicate key"; then
      echo "   ✅ Playlist already exists, will reload existing one"
      
      # Get existing playlist ID
      DB_PLAYLIST_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -c "SELECT id FROM playlists WHERE player_id = '${DEFAULT_PLAYER_ID}' AND name = '${PLAYLIST_NAME}' LIMIT 1;" 2>/dev/null | tr -d ' ')
      
      if [ -z "$DB_PLAYLIST_ID" ]; then
        echo "   ❌ Could not find existing playlist ID"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
        echo ""
        continue
      fi
      
      echo "   📋 Using existing playlist ID: ${DB_PLAYLIST_ID}"
    else
      echo "   ⚠️  Unexpected error checking playlist: ${ERROR_MSG}"
      echo "   Skipping to next..."
      TOTAL_FAILED=$((TOTAL_FAILED + 1))
      echo ""
      continue
    fi
  else
    # Playlist was created successfully
    DB_PLAYLIST_ID=$(echo "$EXISTING_RESPONSE" | grep -o '"playlist":{[^}]*"id":"[^"]*"' | grep -o '"id":"[^"]*"' | cut -d '"' -f4)
    
    if [ -z "$DB_PLAYLIST_ID" ]; then
      echo "   ❌ Failed to get playlist ID from response"
      echo "   Response: ${EXISTING_RESPONSE}"
      TOTAL_FAILED=$((TOTAL_FAILED + 1))
      echo ""
      continue
    fi
    
    echo "   ✅ Playlist created: ${DB_PLAYLIST_ID}"
  fi
  
  # Get current item count before reload
  CURRENT_COUNT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -c "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = '${DB_PLAYLIST_ID}';" 2>/dev/null | tr -d ' ')
  echo "   📊 Current items in playlist: ${CURRENT_COUNT}"
  
  # Add delay before YouTube API call
  echo "   ⏳ Waiting ${REQUEST_DELAY}s before fetching from YouTube..."
  sleep ${REQUEST_DELAY}
  
  # Step 2: Reload videos from YouTube (safe - won't delete existing items)
  echo "   🔄 Reloading videos from YouTube..."
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
    echo "   ❌ Error reloading videos: ${ERROR_MSG}"
    echo "   ✅ Existing ${CURRENT_COUNT} items preserved"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
    echo ""
    continue
  fi
  
  # Parse and display results
  COUNT=$(echo "$SCRAPE_RESPONSE" | grep -o '"count":[0-9]*' | cut -d ':' -f2)
  
  if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
    echo "   ⚠️  No new videos found"
    echo "   ✅ Existing ${CURRENT_COUNT} items preserved"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  else
    echo "   ✅ Successfully reloaded ${COUNT} videos!"
    echo "   📊 Total items now: $(($CURRENT_COUNT + $COUNT))"
    TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
    TOTAL_VIDEOS=$((TOTAL_VIDEOS + COUNT))
  fi
  
  # Add delay before next playlist
  if [ $((${#PLAYLISTS[@]} - TOTAL_SUCCESS - TOTAL_FAILED)) -gt 0 ]; then
    echo "   ⏳ Waiting ${REQUEST_DELAY}s before next playlist..."
    sleep ${REQUEST_DELAY}
  fi
  
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Reload Summary:"
echo "   Total Playlists: ${#PLAYLISTS[@]}"
echo "   ✅ Successful: ${TOTAL_SUCCESS}"
echo "   ❌ Failed: ${TOTAL_FAILED}"
echo "   🎵 New Videos Added: ${TOTAL_VIDEOS}"
echo ""

if [ "$TOTAL_SUCCESS" -gt 0 ]; then
  echo "🎉 Reload completed!"
  echo ""
  echo "Next steps:"
  echo "1. Open Admin console: http://localhost:5173"
  echo "2. Go to Playlists tab to view reloaded playlists"
  echo "3. Start the Player: http://localhost:5174"
else
  echo "⚠️  No playlists were successfully reloaded"
  exit 1
fi
