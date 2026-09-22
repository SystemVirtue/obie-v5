import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_MODEL = 'deepseek/deepseek-chat';
const FALLBACK_MODEL = 'google/gemini-2.0-flash-lite-001';
const FALLBACK_MODEL_2 = 'meta-llama/llama-3.3-70b-instruct:free';
const MAX_ARTIST_COUNT = 2;

interface SeedTrack {
  title: string;
  artist: string | null;
}

interface LLMRecommendation {
  title: string;
  artist: string;
}

function calculateTargetCount(seedCount: number): number {
  return Math.min(40, Math.max(10, Math.round(seedCount * 2.5)));
}

function formatTimestamp(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}${hh}${mi}`;
}

function buildPrompt(seeds: SeedTrack[], requestCount: number): string {
  const seedList = seeds
    .map((s, i) => `${i + 1}. "${s.title}" - ${s.artist || 'Unknown Artist'}`)
    .join('\n');

  return `You are a music recommendation engine. Given these seed tracks, suggest ${requestCount} songs for a radio playlist that continues the same vibe.

Seed tracks:
${seedList}

Rules:
- Match genre, mood, era, and energy of the seed tracks
- Maximum 2 songs per artist
- Do NOT repeat any seed song
- Prefer tracks likely to exist in a curated karaoke / music video library
- Return only real songs

Return ONLY a valid JSON array:
[{"title":"...","artist":"..."}, ...]`;
}

function parseRecommendations(text: string): LLMRecommendation[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array found in LLM response');
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('LLM response is not an array');
  return parsed
    .filter((item: any) => item && typeof item.title === 'string' && typeof item.artist === 'string')
    .map((item: any) => ({ title: item.title.trim(), artist: item.artist.trim() }));
}

function enforceArtistCap(tracks: { title: string; artist: string; mediaId: string }[], maxPerArtist: number) {
  const artistCounts: Record<string, number> = {};
  return tracks.filter((track) => {
    const key = track.artist.toLowerCase();
    artistCounts[key] = (artistCounts[key] || 0) + 1;
    return artistCounts[key] <= maxPerArtist;
  });
}

async function callLLM(prompt: string, apiKey: string): Promise<string> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL, FALLBACK_MODEL_2];
  const errors: string[] = [];

  for (const model of models) {
    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://djamms.app',
          'X-Title': 'DJAMMS Radio Generator',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        errors.push(`${model}: HTTP ${response.status} - ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        errors.push(`${model}: No content in response`);
        continue;
      }

      parseRecommendations(content);
      return content;
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All LLM models failed: ${errors.join(' | ')}`);
}

async function loadSeedsNowPlaying(supabase: any, playerId: string): Promise<SeedTrack[]> {
  const { data: status } = await supabase
    .from('player_status')
    .select('current_media_id')
    .eq('player_id', playerId)
    .maybeSingle();

  if (!status?.current_media_id) throw new Error('Nothing is currently playing');

  const { data: media } = await supabase
    .from('media_items')
    .select('title, artist')
    .eq('id', status.current_media_id)
    .maybeSingle();

  if (!media) throw new Error('Current media item not found');
  return [{ title: media.title, artist: media.artist }];
}

async function loadSeedsHistory(supabase: any, playerId: string): Promise<SeedTrack[]> {
  const { data: logEvents } = await supabase
    .from('system_logs')
    .select('payload')
    .eq('player_id', playerId)
    .eq('event', 'queue_next')
    .order('timestamp', { ascending: false })
    .limit(20);

  if (!logEvents || logEvents.length === 0) throw new Error('No play history found');

  const mediaIds = logEvents
    .map((log: any) => log.payload?.media_item_id)
    .filter((id: string | undefined): id is string => !!id);

  if (mediaIds.length === 0) throw new Error('No play history found');

  const { data: mediaItems } = await supabase
    .from('media_items')
    .select('id, title, artist')
    .in('id', mediaIds);

  if (!mediaItems || mediaItems.length === 0) throw new Error('No play history found');

  const mediaMap = new Map(mediaItems.map((item: any) => [item.id, item]));
  return mediaIds
    .map((id: string) => mediaMap.get(id))
    .filter((item: any): item is { title: string; artist: string | null } => !!item)
    .map((item: any) => ({ title: item.title, artist: item.artist }));
}

async function loadSeedsPlaylist(supabase: any, playerId: string): Promise<SeedTrack[]> {
  const { data: player } = await supabase
    .from('players')
    .select('active_playlist_id')
    .eq('id', playerId)
    .maybeSingle();

  if (!player?.active_playlist_id) throw new Error('No active playlist found');

  const { data: items } = await supabase
    .from('playlist_items')
    .select('media_item:media_items(title, artist)')
    .eq('playlist_id', player.active_playlist_id)
    .order('position', { ascending: true })
    .limit(50);

  const seeds = (items || [])
    .filter((item: any) => item.media_item)
    .map((item: any) => ({ title: item.media_item.title, artist: item.media_item.artist }));

  if (seeds.length === 0) throw new Error('No active playlist items found');
  return seeds;
}

async function matchR2(supabase: any, title: string, artist: string): Promise<any | null> {
  const { data: exact } = await supabase
    .from('r2_files')
    .select('id, title, artist, public_url, duration, thumbnail, object_key, bucket_name')
    .ilike('title', `%${title}%`)
    .ilike('artist', `%${artist}%`)
    .limit(1)
    .maybeSingle();

  if (exact) return exact;

  const { data: titleOnly } = await supabase
    .from('r2_files')
    .select('id, title, artist, public_url, duration, thumbnail, object_key, bucket_name')
    .ilike('title', `%${title}%`)
    .limit(1)
    .maybeSingle();

  return titleOnly || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY') ?? Deno.env.get('DJAMMS_RADIO');
    if (!openrouterApiKey) throw new Error('OPENROUTER_API_KEY (or DJAMMS_RADIO) not configured');

    const body = await req.json();
    const { action, player_id, source } = body;

    if (action !== 'generate') {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!player_id) {
      return new Response(JSON.stringify({ error: 'player_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['now_playing', 'history', 'playlist'].includes(source)) {
      return new Response(JSON.stringify({ error: 'source must be now_playing, history, or playlist' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let seeds: SeedTrack[];
    if (source === 'now_playing') {
      seeds = await loadSeedsNowPlaying(supabase, player_id);
    } else if (source === 'history') {
      seeds = await loadSeedsHistory(supabase, player_id);
    } else {
      seeds = await loadSeedsPlaylist(supabase, player_id);
    }

    const targetCount = calculateTargetCount(seeds.length);
    const requestCount = Math.round(targetCount * 1.5);
    const prompt = buildPrompt(seeds, requestCount);
    const llmResponse = await callLLM(prompt, openrouterApiKey);
    const recommendations = parseRecommendations(llmResponse);

    const resolvedTracks: { title: string; artist: string; mediaId: string }[] = [];

    for (const rec of recommendations) {
      if (resolvedTracks.length >= targetCount) break;
      const r2Match = await matchR2(supabase, rec.title, rec.artist);
      if (!r2Match) continue;

      const sourceId = `cloudflare:${r2Match.object_key}`;
      const { data: mediaId } = await supabase.rpc('create_or_get_media_item', {
        p_source_id: sourceId,
        p_source_type: 'cloudflare',
        p_title: r2Match.title || rec.title,
        p_artist: r2Match.artist || rec.artist,
        p_url: r2Match.public_url,
        p_duration: r2Match.duration || null,
        p_thumbnail: r2Match.thumbnail || null,
        p_metadata: { bucket: r2Match.bucket_name, object_key: r2Match.object_key },
      });

      if (mediaId) {
        resolvedTracks.push({
          title: r2Match.title || rec.title,
          artist: r2Match.artist || rec.artist,
          mediaId,
        });
      }
    }

    const finalTracks = enforceArtistCap(resolvedTracks, MAX_ARTIST_COUNT).slice(0, targetCount);
    if (finalTracks.length === 0) {
      throw new Error('No R2 tracks could be matched from the generated recommendations');
    }

    const playlistName = `RADIO - ${formatTimestamp()}`;
    const seedSummary = seeds.slice(0, 5).map((seed) => `${seed.title} - ${seed.artist || '?'}`).join(', ');
    const description = `Generated from ${source} (${seeds.length} seed${seeds.length !== 1 ? 's' : ''}): ${seedSummary}${seeds.length > 5 ? '...' : ''}`;

    const { data: playlist, error: createError } = await supabase
      .from('playlists')
      .insert({
        player_id,
        name: playlistName,
        description,
      })
      .select()
      .maybeSingle();

    if (createError) throw createError;
    if (!playlist) throw new Error('Playlist creation failed');

    const playlistItems = finalTracks.map((track, index) => ({
      playlist_id: playlist.id,
      media_item_id: track.mediaId,
      position: index,
    }));
    const { error: insertError } = await supabase.from('playlist_items').insert(playlistItems);
    if (insertError) throw insertError;

    const { error: loadError } = await supabase.rpc('load_playlist', {
      p_player_id: player_id,
      p_playlist_id: playlist.id,
      p_start_index: 0,
    });
    if (loadError) throw loadError;

    return new Response(JSON.stringify({
      playlist_id: playlist.id,
      playlist_name: playlistName,
      track_count: finalTracks.length,
      tracks: finalTracks.map((track) => ({ title: track.title, artist: track.artist })),
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
