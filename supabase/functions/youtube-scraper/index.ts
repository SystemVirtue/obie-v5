// YouTube Scraper Edge Function
// Fetches metadata from YouTube videos and playlists using YouTube Data API v3
/// <reference lib="deno.window" />
import { corsHeaders } from '../_shared/cors.ts';

// Type definitions
interface ApiKey {
  key: string;
  name: string;
}

interface Video {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  url: string;
  embeddable?: boolean;
  oembedOk?: boolean | null;
  playabilityStatus?: 'unknown' | 'playable' | 'embed_blocked' | 'restricted' | 'unavailable' | 'invalid' | 'check_failed';
  playabilityReason?: string | null;
  alternativeScore?: number;
}

const SEARCH_EMBED_CHECK_CONCURRENCY = 4;

// API Key rotation — reads from YOUTUBE_API_KEY_1..8 Supabase secrets
// These must be configured in your Supabase project settings
const API_KEYS: ApiKey[] = Array.from({ length: 8 }, (_, i) => {
  const key = Deno.env.get(`YOUTUBE_API_KEY_${i + 1}`);
  if (key) {
    return {
      key,
      name: `Key ${i + 1}`,
    };
  }
  return null;
}).filter((k): k is ApiKey => k !== null);
let currentKeyIndex = 0;
const failedKeys = new Set<number>();

// Validate that at least one API key is configured
if (API_KEYS.length === 0) {
  console.error('ERROR: No YouTube API keys configured. Set YOUTUBE_API_KEY_1 through YOUTUBE_API_KEY_8 in Supabase secrets.');
}

function getNextApiKey(): string {
  // Find next valid key (not in failed list) from the rotation pool
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

function markKeyAsFailed(apiKey: string): void {
  const index = API_KEYS.findIndex((k) => k.key === apiKey);
  if (index !== -1) {
    failedKeys.add(index);
    console.log(`Marked ${API_KEYS[index].name} as failed/quota exceeded`);
  }
}

function getYouTubeErrorReason(errorData: any): string | null {
  return errorData?.error?.errors?.[0]?.reason || errorData?.error?.status || null;
}

function shouldRotateApiKey(reason: string | null): boolean {
  return [
    'quotaExceeded',
    'dailyLimitExceeded',
    'dailyLimitExceededUnreg',
    'ipRefererBlocked',
    'forbidden',
    'accessNotConfigured',
    'youtubeSignupRequired',
    'keyInvalid',
  ].includes(reason || '');
}

async function handleYouTubeApiError(response: Response, apiKey: string): Promise<void> {
  if (response.status !== 400 && response.status !== 403) return;

  const errorData = await response.clone().json().catch(() => ({}));
  const reason = getYouTubeErrorReason(errorData);
  if (!shouldRotateApiKey(reason)) return;

  markKeyAsFailed(apiKey);
  const message = errorData?.error?.message || `${response.status} ${response.statusText}`;
  throw new Error(`YouTube API key failed (${reason || response.status}): ${message}`);
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // Check if API keys are configured
    if (API_KEYS.length === 0) {
      return new Response(JSON.stringify({
        error: 'YouTube API keys not configured. Contact administrator.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    let videos: Video[] = [];
    let lastError: Error | null = null;
    const maxRetries = API_KEYS.length; // Try all keys if needed
    const body = await req.json();
    const { url, query, type = 'auto' } = body;
    if (type !== 'search' && type !== 'alternatives' && !url && !body.video_id && !body.video_ids) {
      return new Response(JSON.stringify({
        error: 'url, video_id, or video_ids is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if ((type === 'search' || type === 'alternatives') && !query && !(body.title || body.artist)) {
      return new Response(JSON.stringify({
        error: 'query, title, or artist is required for search'
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
    if (type !== 'search' && type !== 'alternatives' && url) {
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
        } else if (type === 'alternatives') {
          videos = await fetchAlternatives(body, apiKey);
        } else if (type === 'check') {
          const ids = Array.isArray(body.video_ids)
            ? body.video_ids
            : [body.video_id || videoId].filter(Boolean);
          videos = ids.length > 0 ? await annotateVideosForEmbedding(await fetchVideosBatch(ids.join(','), apiKey)) : [];
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
          videos = await fetchPlaylist(playlistId, apiKey);
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
        lastError = error instanceof Error ? error : new Error(String(error));
        // Try the next configured key when this key is exhausted, disabled,
        // invalid, or blocked by referrer/IP restrictions for Edge/server calls.
        if (lastError.message.includes('YouTube API key failed')) {
          console.log(`YouTube API key failed on attempt ${attempt + 1}, trying next key: ${lastError.message}`);
          continue;
        }
        // Other errors - don't retry
        throw lastError;
      }
    }
    // If we exhausted all retries
    if (videos.length === 0 && lastError) {
      throw new Error(`All API keys exhausted: ${lastError.message}`);
    }

    return new Response(JSON.stringify({
      videos,
      count: videos.length
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('YouTube scraper error:', error);
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
function extractVideoId(url: string): string | null {
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
function extractPlaylistId(url: string): string | null {
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
async function fetchVideo(videoId: string, apiKey: string): Promise<Video | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`;
  const response = await fetch(url);
  await handleYouTubeApiError(response, apiKey);
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.items || data.items.length === 0) {
    return null;
  }
  const item = data.items[0];
  const [video] = await annotateVideosForEmbedding([parseVideoItem(item)]);
  return video || null;
}
// Fetch search results with embeddability filtering
async function fetchSearch(query: string, apiKey: string): Promise<Video[]> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&videoEmbeddable=true&maxResults=10&key=${apiKey}`;
  const response = await fetch(url);
  await handleYouTubeApiError(response, apiKey);
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();

  // Extract video IDs from search results
  const videoIds = data.items.map((item: any) => item.id.videoId).join(',');

  if (!videoIds) {
    return [];
  }

  // Fetch embeddability status for all videos at once
  const videosWithStatus = await fetchVideosBatch(videoIds, apiKey);

  // Build a map of video ID to status/details for quick lookup
  const videoDetailsMap = new Map<string, Video>();
  videosWithStatus.forEach((video) => {
    videoDetailsMap.set(video.id, video);
  });

  // Map search results and filter out non-embeddable videos
  const videos = data.items
    .map((item: any) => {
      const snippet = item.snippet;
      const videoId = item.id.videoId;
      const videoDetails = videoDetailsMap.get(videoId);
      const isEmbeddable = videoDetails?.embeddable !== false;

      // Extract artist from title (common format: "Artist - Title")
      const titleParts = snippet.title.split(' - ');
      const artist = titleParts.length > 1 ? titleParts[0].trim() : snippet.channelTitle;
      const title = titleParts.length > 1 ? titleParts.slice(1).join(' - ').trim() : snippet.title;

      return {
        id: videoId,
        title,
        artist,
        duration: videoDetails?.duration || 0,
        thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
        thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        embeddable: isEmbeddable
      };
    })
    .filter((video: Video) => video.embeddable !== false);

  return await filterSearchResultsForEmbedding(videos);
}
// Fetch playlist metadata (all videos)
async function fetchPlaylist(playlistId: string, apiKey: string): Promise<Video[]> {
  const videos: Video[] = [];
  let pageToken: string | null = null;
  const maxResults = 50; // Max per request
  do {
    const playlistUrl: string = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}${pageToken ? `&pageToken=${pageToken}` : ''}&key=${apiKey}`;
    const response: Response = await fetch(playlistUrl);
    await handleYouTubeApiError(response, apiKey);
    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
    }
    const data: any = await response.json();
    // Fetch full video details for durations (playlistItems doesn't include duration)
    const videoIds = data.items.map((item: any)=>item.contentDetails.videoId).join(',');
    const videosData = await fetchVideosBatch(videoIds, apiKey);
    videos.push(...videosData);
    pageToken = data.nextPageToken || null;
  }while (pageToken)
  return await annotateVideosForEmbedding(videos);
}
// Fetch multiple videos in batch
async function fetchVideosBatch(videoIds: string, apiKey: string): Promise<Video[]> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoIds}&key=${apiKey}`;
  const response = await fetch(url);
  await handleYouTubeApiError(response, apiKey);
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.items.map((item: unknown) => parseVideoItem(item));
}

// Parse YouTube API video item into our format
function parseVideoItem(item: unknown): Video {
  const typedItem = item as {
    id: string;
    snippet: { title: string; channelTitle: string; thumbnails?: Record<string, { url: string }> };
    contentDetails?: { duration: string };
    status?: { embeddable?: boolean };
  };
  const snippet = typedItem.snippet;
  const contentDetails = typedItem.contentDetails;
  const status = typedItem.status;
  // Parse ISO 8601 duration (PT4M13S -> 253 seconds)
  const duration = contentDetails?.duration ? parseDuration(contentDetails.duration) : 0;
  // Extract artist from title (common format: "Artist - Title")
  const titleParts = snippet.title.split(' - ');
  const artist = titleParts.length > 1 ? titleParts[0].trim() : snippet.channelTitle;
  const title = titleParts.length > 1 ? titleParts.slice(1).join(' - ').trim() : snippet.title;
  return {
    id: typedItem.id,
    title,
    artist,
    duration,
    thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
    url: `https://www.youtube.com/watch?v=${typedItem.id}`,
    embeddable: status?.embeddable ?? true,  // Default to true if not specified
    oembedOk: null,
    playabilityStatus: status?.embeddable === false ? 'embed_blocked' : 'unknown',
    playabilityReason: status?.embeddable === false ? 'youtube_status_not_embeddable' : null
  };
}
// Parse ISO 8601 duration to seconds
function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

async function filterSearchResultsForEmbedding(videos: Video[]): Promise<Video[]> {
  if (videos.length === 0) return videos;

  const checked = await annotateVideosForEmbedding(videos);
  const validated = checked.filter((video) => video.playabilityStatus !== 'embed_blocked' && video.playabilityStatus !== 'unavailable');

  console.log(`[youtube-scraper] Search embeddability filter kept ${validated.length}/${videos.length} results`);
  return validated;
}

async function annotateVideosForEmbedding(videos: Video[]): Promise<Video[]> {
  if (videos.length === 0) return videos;

  const annotated: Video[] = [];

  for (let i = 0; i < videos.length; i += SEARCH_EMBED_CHECK_CONCURRENCY) {
    const batch = videos.slice(i, i + SEARCH_EMBED_CHECK_CONCURRENCY);
    const batchResults = await Promise.all(batch.map((video) => verifyEmbeddable(video)));

    annotated.push(...batchResults);
  }

  return annotated;
}

async function verifyEmbeddable(video: Video): Promise<Video> {
  if (video.embeddable === false) {
    return {
      ...video,
      oembedOk: false,
      playabilityStatus: 'embed_blocked',
      playabilityReason: 'youtube_status_not_embeddable',
    };
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`;
    const response = await fetch(oembedUrl, {
      method: 'GET',
      redirect: 'follow',
    });

    if (response.ok) {
      return {
        ...video,
        oembedOk: true,
        playabilityStatus: 'playable',
        playabilityReason: 'youtube_status_and_oembed_ok',
      };
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      console.log(`[youtube-scraper] Excluding non-embeddable result ${video.id} (oEmbed ${response.status})`);
      return {
        ...video,
        oembedOk: false,
        playabilityStatus: response.status === 404 ? 'unavailable' : 'embed_blocked',
        playabilityReason: `youtube_oembed_${response.status}`,
      };
    }

    console.warn(`[youtube-scraper] Unexpected oEmbed status ${response.status} for ${video.id}; keeping result`);
    return {
      ...video,
      oembedOk: null,
      playabilityStatus: 'unknown',
      playabilityReason: `youtube_oembed_unexpected_${response.status}`,
    };
  } catch (error) {
    console.warn(`[youtube-scraper] oEmbed check failed for ${video.id}; keeping result`, error);
    return {
      ...video,
      oembedOk: null,
      playabilityStatus: 'check_failed',
      playabilityReason: 'youtube_oembed_check_failed',
    };
  }
}

async function fetchAlternatives(body: any, apiKey: string): Promise<Video[]> {
  const title = String(body.title || '').trim();
  const artist = String(body.artist || '').trim();
  const query = String(body.query || [artist, title].filter(Boolean).join(' ')).trim();
  const excludedId = String(body.exclude_video_id || body.youtube_id || '').trim();
  const targetDuration = Number(body.duration || 0);
  const maxResults = Math.max(1, Math.min(Number(body.max_results || 5), 10));

  return (await fetchSearch(query, apiKey))
    .filter((video) => video.id !== excludedId)
    .map((video) => ({
      ...video,
      alternativeScore: scoreAlternative(video, { title, artist, duration: targetDuration }),
    }))
    .sort((a, b) => (b.alternativeScore || 0) - (a.alternativeScore || 0))
    .slice(0, maxResults);
}

function normalizeForScore(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(official|video|audio|lyrics?|remaster(?:ed)?|hd|hq|vevo)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeForScore(value).split(/\s+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function scoreAlternative(video: Video, target: { title: string; artist: string; duration: number }): number {
  const candidateText = `${video.artist || ''} ${video.title || ''}`;
  const targetText = `${target.artist || ''} ${target.title || ''}`;
  let score = jaccard(tokenSet(candidateText), tokenSet(targetText)) * 70;

  if (target.duration > 0 && video.duration > 0) {
    const delta = Math.abs(video.duration - target.duration);
    const tolerance = Math.max(20, target.duration * 0.12);
    score += Math.max(0, 20 - (delta / tolerance) * 20);
  }

  if (/official|vevo|topic/i.test(candidateText)) score += 8;
  if (/karaoke|cover|tribute|reaction/i.test(candidateText)) score -= 18;
  if (/live/i.test(candidateText) && !/live/i.test(targetText)) score -= 8;
  if (video.playabilityStatus === 'playable') score += 10;

  return Math.round(Math.max(0, Math.min(100, score)));
}
