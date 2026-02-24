// YouTube Scraper Edge Function
// Fetches metadata from YouTube videos and playlists using YouTube Data API v3
import { corsHeaders } from '../_shared/cors.ts';
// API Key rotation for better rate limit management
const API_KEYS = [
  {
    key: "AIzaSyC12QKbzGaKZw9VD3-ulxU_mrd0htZBiI4",
    name: "Key 1 (Primary)"
  },
  {
    key: "AIzaSyDQ_Jx4Dwje2snQisj7hEFVK9lJJ0tptcc",
    name: "Key 2"
  },
  {
    key: "AIzaSyDy6_QI9SP5nOZRVoNa5xghSHtY3YWX5kU",
    name: "Key 3"
  },
  {
    key: "AIzaSyCPAY_ukeGnAGJdCvYk1bVVDxZjQRJqsdk",
    name: "Key 4"
  },
  {
    key: "AIzaSyD7iB_2dHUu9yS87WD4wMbkJQduibU5vco",
    name: "Key 5"
  },
  {
    key: "AIzaSyCgtXTfFuUiiBsNXH6z_k9-GiCqiS0Cgso",
    name: "Key 6"
  },
  {
    key: "AIzaSyCKHHGkaztp8tfs2BVxiny0InE_z-kGDtY",
    name: "Key 7"
  },
  {
    key: "AIzaSyBGcwaCm70o4ir0CKcNIJ0V_7TeyY2cwdA",
    name: "Key 8"
  },
  {
    key: "AIzaSyD6lYWv9Jww_r_RCpO-EKZEyrK4vNd9FeQ",
    name: "Key 9"
  },
  {
    key: "AIzaSyD3kfo9uNdHluv_U4fRPRdQ-sUowK4HmXo",
    name: "Key 10"
  }
];
let currentKeyIndex = 0;
const failedKeys = new Set();
function getNextApiKey() {
  // Try environment variable first
  const envKey = Deno.env.get('YOUTUBE_API_KEY');
  if (envKey) return envKey;
  // Find next valid key (not in failed list)
  const startIndex = currentKeyIndex;
  do {
    if (!failedKeys.has(currentKeyIndex)) {
      const key = API_KEYS[currentKeyIndex].key;
      const keyName = API_KEYS[currentKeyIndex].name;
      currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
      console.log(`Using ${keyName}`);
      return key;
    }
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  }while (currentKeyIndex !== startIndex)
  // All keys failed - reset and try again
  console.log('All keys exhausted, resetting failed keys list');
  failedKeys.clear();
  const key = API_KEYS[currentKeyIndex].key;
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
}
function markKeyAsFailed(apiKey) {
  const index = API_KEYS.findIndex((k)=>k.key === apiKey);
  if (index !== -1) {
    failedKeys.add(index);
    console.log(`Marked ${API_KEYS[index].name} as failed/quota exceeded`);
  }
}
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    let videos = [];
    let lastError = null;
    let nextPageToken = null;
    const maxRetries = API_KEYS.length; // Try all keys if needed
    const body = await req.json();
    const { url, query, type = 'auto', maxResults, pageToken } = body;
    if (type !== 'search' && !url) {
      return new Response(JSON.stringify({
        error: 'url is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (type === 'search' && !query) {
      return new Response(JSON.stringify({
        error: 'query is required for search'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Extract video or playlist ID from URL (only for non-search requests)
    let videoId = null;
    let playlistId = null;
    if (type !== 'search') {
      videoId = extractVideoId(url);
      playlistId = extractPlaylistId(url);
    }
    // Retry with different keys if quota exceeded
    for(let attempt = 0; attempt < maxRetries; attempt++){
      try {
        const apiKey = getNextApiKey();
        // Determine what to fetch
        if (type === 'search') {
          videos = await fetchSearch(query, apiKey);
        } else if (type === 'auto' && playlistId || type === 'playlist') {
          if (!playlistId) {
            return new Response(JSON.stringify({
              error: 'Invalid playlist URL'
            }), {
              status: 400,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const result = await fetchPlaylist(playlistId, apiKey, maxResults, pageToken);
          videos = result.videos;
          nextPageToken = result.nextPageToken;
        } else if (type === 'auto' && videoId || type === 'video') {
          if (!videoId) {
            return new Response(JSON.stringify({
              error: 'Invalid video URL'
            }), {
              status: 400,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const video = await fetchVideo(videoId, apiKey);
          videos = video ? [
            video
          ] : [];
        } else {
          return new Response(JSON.stringify({
            error: 'Could not detect video or playlist ID from URL'
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
        break;
      } catch (error) {
        lastError = error;
        // If quota exceeded or other 403 error, try next key
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Quota exceeded') || errorMessage.includes('403 Forbidden')) {
          console.log(`403 error on attempt ${attempt + 1}, trying next key...`);
          continue;
        }
        // Other errors - don't retry
        throw error;
      }
    }
    // If we exhausted all retries
    if (videos.length === 0 && lastError) {
      const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`All API keys exhausted: ${errorMessage}`);
    }
    return new Response(JSON.stringify({
      videos,
      count: videos.length,
      nextPageToken
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('YouTube scraper error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({
      error: errorMessage
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
// Extract YouTube video ID from various URL formats
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pattern of patterns){
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
// Extract YouTube playlist ID from URL
function extractPlaylistId(url) {
  const patterns = [
    /[?&]list=([a-zA-Z0-9_-]+)/,
    /^PL[a-zA-Z0-9_-]+$/
  ];
  for (const pattern of patterns){
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
// Fetch single video metadata
async function fetchSearch(query, apiKey) {
  // Preprocess query to replace | with OR for boolean search
  query = query.replace(/\|/g, ' OR ');
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=10&key=${apiKey}`;
  const response = await fetch(url);
  // Handle quota exceeded - mark key as failed and throw
  if (response.status === 403) {
    const errorData = await response.json();
    console.log(`403 Error details:`, JSON.stringify(errorData, null, 2));
    if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
      markKeyAsFailed(apiKey);
      throw new Error('Quota exceeded - key marked as failed');
    } else {
      // For other 403 errors, still mark key as failed and retry
      console.log(`Non-quota 403 error: ${errorData.error?.errors?.[0]?.reason || 'unknown'}`);
      markKeyAsFailed(apiKey);
      throw new Error(`YouTube API error: ${response.status} ${response.statusText} (${errorData.error?.errors?.[0]?.reason || 'unknown'})`);
    }
  }
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const videos = data.items.map(item => {
    const snippet = item.snippet;
    // Extract artist from title (common format: "Artist - Title")
    const titleParts = snippet.title.split(' - ');
    const artist = titleParts.length > 1 ? titleParts[0].trim() : snippet.channelTitle;
    const title = titleParts.length > 1 ? titleParts.slice(1).join(' - ').trim() : snippet.title;
    return {
      id: item.id.videoId,
      title,
      artist,
      duration: 0, // Duration not available in search results
      thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
      thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    };
  });
  return videos;
}
// Fetch playlist metadata (all videos)
async function fetchPlaylist(playlistId, apiKey, requestedMaxResults = 50, requestedPageToken = null) {
  const videos = [];
  let pageToken = requestedPageToken;
  const maxResults = Math.min(requestedMaxResults || 50, 50); // Cap at 50 per YouTube API limits
  let nextPageToken = null;
  
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}${pageToken ? `&pageToken=${pageToken}` : ''}&key=${apiKey}`;
    const response = await fetch(url);
    // Handle quota exceeded - mark key as failed and throw
    if (response.status === 403) {
      const errorData = await response.json();
      console.log(`403 Error details:`, JSON.stringify(errorData, null, 2));
      if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
        markKeyAsFailed(apiKey);
        throw new Error('Quota exceeded - key marked as failed');
      } else {
        // For other 403 errors, still mark key as failed and retry
        console.log(`Non-quota 403 error: ${errorData.error?.errors?.[0]?.reason || 'unknown'}`);
        markKeyAsFailed(apiKey);
        throw new Error(`YouTube API error: ${response.status} ${response.statusText} (${errorData.error?.errors?.[0]?.reason || 'unknown'})`);
      }
    }
    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    // Fetch full video details for durations (playlistItems doesn't include duration)
    const videoIds = data.items.map((item)=>item.contentDetails.videoId).join(',');
    const videosData = await fetchVideosBatch(videoIds, apiKey);
    videos.push(...videosData);
    pageToken = data.nextPageToken || null;
    nextPageToken = data.nextPageToken || null;
  }while (pageToken && videos.length < (requestedMaxResults || Infinity))
  
  return { videos, nextPageToken };
}
// Fetch multiple videos in batch
async function fetchVideosBatch(videoIds, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoIds}&key=${apiKey}`;
  const response = await fetch(url);
  // Handle quota exceeded - mark key as failed and throw
  if (response.status === 403) {
    const errorData = await response.json();
    console.log(`403 Error details:`, JSON.stringify(errorData, null, 2));
    if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
      markKeyAsFailed(apiKey);
      throw new Error('Quota exceeded - key marked as failed');
    } else {
      // For other 403 errors, still mark key as failed and retry
      console.log(`Non-quota 403 error: ${errorData.error?.errors?.[0]?.reason || 'unknown'}`);
      markKeyAsFailed(apiKey);
      throw new Error(`YouTube API error: ${response.status} ${response.statusText} (${errorData.error?.errors?.[0]?.reason || 'unknown'})`);
    }
  }
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.items.map((item)=>parseVideoItem(item));
}
// Parse YouTube API video item into our format
function parseVideoItem(item) {
  const snippet = item.snippet;
  const contentDetails = item.contentDetails;
  // Parse ISO 8601 duration (PT4M13S -> 253 seconds)
  const duration = parseDuration(contentDetails.duration);
  // Extract artist from title (common format: "Artist - Title")
  const titleParts = snippet.title.split(' - ');
  const artist = titleParts.length > 1 ? titleParts[0].trim() : snippet.channelTitle;
  const title = titleParts.length > 1 ? titleParts.slice(1).join(' - ').trim() : snippet.title;
  return {
    id: item.id,
    title,
    artist,
    duration,
    thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
    url: `https://www.youtube.com/watch?v=${item.id}`
  };
}
// Parse ISO 8601 duration to seconds
function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}
