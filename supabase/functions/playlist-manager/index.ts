// Playlist Manager Edge Function
// Handles playlist CRUD operations and media scraping
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAuthenticatedUserId, userOwnsPlayer } from '../_shared/authorization.ts';
import { corsHeaders } from '../_shared/cors.ts';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const UNVERIFIED_OR_BLOCKED_STATUSES = new Set(['unknown', 'embed_blocked', 'restricted', 'unavailable', 'invalid', 'check_failed']);
const AUTO_REPLACEMENT_MIN_SCORE = 82;

function extractYouTubeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match =
    String(value).match(/youtube:([A-Za-z0-9_-]{11})$/) ||
    String(value).match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    String(value).match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    String(value).match(/\/embed\/([A-Za-z0-9_-]{11})/) ||
    String(value).match(/([A-Za-z0-9_-]{11})$/);
  return match?.[1] || null;
}

function videoPlayabilityStatus(video: any): string {
  if (video?.playabilityStatus) return video.playabilityStatus;
  if (video?.embeddable === false) return 'embed_blocked';
  return 'unknown';
}

function videoPlayabilityReason(video: any): string | null {
  if (video?.playabilityReason) return video.playabilityReason;
  if (video?.embeddable === false) return 'youtube_status_not_embeddable';
  return null;
}

async function recordVideoPlayability(supabase: any, mediaItemId: string | null, video: any, checkedBy: string): Promise<void> {
  if (!mediaItemId && !video?.id) return;
  const { error } = await supabase.rpc('record_youtube_playability', {
    p_media_item_id: mediaItemId,
    p_youtube_id: video?.id || null,
    p_status: videoPlayabilityStatus(video),
    p_reason: videoPlayabilityReason(video),
    p_checked_by: checkedBy,
    p_embeddable: typeof video?.embeddable === 'boolean' ? video.embeddable : null,
    p_oembed_ok: typeof video?.oembedOk === 'boolean' ? video.oembedOk : null,
    p_error_code: null,
    p_details: {
      title: video?.title || null,
      artist: video?.artist || null,
      url: video?.url || null,
    },
  });
  if (error) throw error;
}

async function findCloudflareFallback(supabase: any, youtubeId: string | null): Promise<any | null> {
  if (!youtubeId) return null;
  const { data, error } = await supabase
    .from('r2_files')
    .select('id, public_url, object_key, title, artist, duration, thumbnail, bucket_name')
    .eq('youtube_id', youtubeId)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[playlist-manager] R2 fallback lookup failed:', error.message || error);
    return null;
  }

  return data || null;
}

async function upsertPlaybackOverride(supabase: any, mediaItemId: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('media_playback_overrides')
    .upsert({
      media_item_id: mediaItemId,
      ...values,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'media_item_id' });

  if (error) {
    console.warn('[playlist-manager] Failed to upsert playback override:', error.message || error);
  }
}

async function markMediaExcluded(supabase: any, mediaItemId: string, reason: string, details: Record<string, unknown> = {}): Promise<void> {
  await supabase
    .from('media_items')
    .update({
      excluded_from_playback: true,
      excluded_reason: reason,
      excluded_at: new Date().toISOString(),
    })
    .eq('id', mediaItemId);

  await upsertPlaybackOverride(supabase, mediaItemId, {
    override_type: 'excluded',
    reason,
    confidence: 100,
    details,
  });
}

async function findPlayableAlternative(video: any): Promise<any | null> {
  const scraperResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-scraper`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({
      type: 'alternatives',
      title: video.title,
      artist: video.artist || null,
      duration: video.duration || null,
      youtube_id: video.id,
      max_results: 8,
    }),
  });

  if (!scraperResp.ok) {
    console.warn('[playlist-manager] Alternative lookup failed:', scraperResp.status, await scraperResp.text());
    return null;
  }

  const payload = await scraperResp.json();
  const candidates = Array.isArray(payload.videos) ? payload.videos : [];
  return candidates.find((candidate: any) =>
    candidate?.playabilityStatus === 'playable' &&
    Number(candidate?.alternativeScore || 0) >= AUTO_REPLACEMENT_MIN_SCORE
  ) || null;
}

async function createYouTubeMediaItem(supabase: any, video: any): Promise<string | null> {
  const { data: mediaId, error } = await supabase.rpc('create_or_get_media_item', {
    p_source_id:   `youtube:${video.id}`,
    p_source_type: 'youtube',
    p_title:       video.title,
    p_artist:      video.artist || null,
    p_url:         video.url,
    p_duration:    video.duration || null,
    p_thumbnail:   video.thumbnail || null,
    p_metadata:    {
      youtube_playability_status: videoPlayabilityStatus(video),
      youtube_playability_reason: videoPlayabilityReason(video),
      youtube_embeddable: typeof video.embeddable === 'boolean' ? video.embeddable : null,
      youtube_oembed_ok: typeof video.oembedOk === 'boolean' ? video.oembedOk : null,
      replacement_candidate: true,
    },
  });

  if (error) {
    console.warn('[playlist-manager] Failed to create alternative media item:', error.message || error);
    return null;
  }

  await recordVideoPlayability(supabase, mediaId, video, 'playlist_auto_replacement');
  return mediaId || null;
}

async function resolveImportedYouTubeMedia(supabase: any, mediaItemId: string, video: any): Promise<string | null> {
  const status = videoPlayabilityStatus(video);
  if (!UNVERIFIED_OR_BLOCKED_STATUSES.has(status)) {
    return mediaItemId;
  }

  const youtubeId = video.id || extractYouTubeId(video.url);
  const r2Fallback = await findCloudflareFallback(supabase, youtubeId);
  if (r2Fallback?.public_url) {
    await upsertPlaybackOverride(supabase, mediaItemId, {
      override_type: 'cloudflare',
      playback_url: r2Fallback.public_url,
      r2_file_id: r2Fallback.id,
      confidence: 100,
      reason: `youtube_${status}_r2_fallback`,
      details: { youtube_id: youtubeId, object_key: r2Fallback.object_key },
    });
    await supabase
      .from('media_items')
      .update({
        excluded_from_playback: false,
        excluded_reason: null,
        excluded_at: null,
      })
      .eq('id', mediaItemId);
    return mediaItemId;
  }

  const alternative = await findPlayableAlternative(video);
  if (alternative) {
    const replacementMediaId = await createYouTubeMediaItem(supabase, alternative);
    if (replacementMediaId) {
      if (youtubeId) {
        await supabase
          .from('youtube_alternative_candidates')
          .upsert({
            source_media_item_id: mediaItemId,
            source_youtube_id: youtubeId,
            candidate_youtube_id: alternative.id,
            candidate_title: alternative.title || 'Unknown title',
            candidate_artist: alternative.artist || null,
            candidate_url: alternative.url,
            candidate_duration: alternative.duration || null,
            candidate_thumbnail: alternative.thumbnail || null,
            score: alternative.alternativeScore || 0,
            playability_status: alternative.playabilityStatus || 'playable',
            playability_reason: alternative.playabilityReason || null,
            details: alternative,
          }, { onConflict: 'source_youtube_id,candidate_youtube_id' });
      }

      await supabase
        .from('media_items')
        .update({
          replacement_media_item_id: replacementMediaId,
          excluded_from_playback: false,
          excluded_reason: null,
          excluded_at: null,
        })
        .eq('id', mediaItemId);

      await upsertPlaybackOverride(supabase, mediaItemId, {
        override_type: 'replacement',
        replacement_media_item_id: replacementMediaId,
        confidence: alternative.alternativeScore || 0,
        reason: `youtube_${status}_auto_replacement`,
        details: {
          youtube_id: youtubeId,
          replacement_youtube_id: alternative.id,
          title: alternative.title,
        },
      });

      return replacementMediaId;
    }
  }

  await markMediaExcluded(supabase, mediaItemId, `youtube_${status}_no_route`, {
    youtube_id: youtubeId,
    playability_status: status,
    playability_reason: videoPlayabilityReason(video),
  });

  return null;
}

Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  try {
    // Create Supabase client (uses service role for admin operations)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    // Parse request body
    const body = await req.json();
    const { action, player_id, playlist_id, name, description, media_item_id, item_ids, url, current_index } = body;
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let targetPlayerId = typeof player_id === 'string' ? player_id : null;
    if (!targetPlayerId && typeof playlist_id === 'string') {
      const { data: playlist, error: playlistError } = await supabase
        .from('playlists')
        .select('player_id')
        .eq('id', playlist_id)
        .maybeSingle();
      if (playlistError) throw playlistError;
      if (!playlist) {
        return new Response(JSON.stringify({ error: 'Playlist not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      targetPlayerId = playlist.player_id;
    }

    if (targetPlayerId && !await userOwnsPlayer(supabase, userId, targetPlayerId)) {
      return new Response(JSON.stringify({ error: 'Not authorized for this player' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Handle playlist creation
    if (action === 'create') {
      if (!player_id || !name) {
        return new Response(JSON.stringify({
          error: 'player_id and name are required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { data: playlist, error: createError } = await supabase.from('playlists').insert({
        player_id,
        name,
        description: description || null
      }).select().maybeSingle();
      if (createError) throw createError;
      if (!playlist) {
        return new Response(JSON.stringify({
          error: 'Playlist creation failed'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      return new Response(JSON.stringify({
        playlist
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle playlist update
    if (action === 'update') {
      if (!playlist_id) {
        return new Response(JSON.stringify({
          error: 'playlist_id is required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const updateData: Record<string, unknown> = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      const { data: playlist, error: updateError } = await supabase.from('playlists').update(updateData).eq('id', playlist_id).select().maybeSingle();
      if (updateError) throw updateError;
      if (!playlist) {
        return new Response(JSON.stringify({
          error: 'Playlist update failed'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      return new Response(JSON.stringify({
        playlist
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle playlist deletion
    if (action === 'delete') {
      if (!playlist_id) {
        return new Response(JSON.stringify({
          error: 'playlist_id is required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { error: deleteError } = await supabase.from('playlists').delete().eq('id', playlist_id);
      if (deleteError) throw deleteError;
      return new Response(JSON.stringify({
        success: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle adding item to playlist
    if (action === 'add_item') {
      if (!playlist_id || !media_item_id) {
        return new Response(JSON.stringify({
          error: 'playlist_id and media_item_id are required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { data: items, error: addError } = await supabase.rpc('playlist_add_item', {
        p_playlist_id: playlist_id,
        p_media_item_id: media_item_id,
      });
      if (addError) throw addError;
      const item = Array.isArray(items) ? items[0] : items;
      if (!item) {
        return new Response(JSON.stringify({
          error: 'Failed to add item to playlist'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      return new Response(JSON.stringify({
        item
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle removing item from playlist
    if (action === 'remove_item') {
      if (!playlist_id || !media_item_id) {
        return new Response(JSON.stringify({
          error: 'playlist_id and media_item_id are required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { error: removeError } = await supabase.rpc('playlist_remove_item', {
        p_playlist_id: playlist_id,
        p_media_item_id: media_item_id,
      });
      if (removeError) throw removeError;
      return new Response(JSON.stringify({
        success: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle reordering playlist items
    if (action === 'reorder') {
      if (!playlist_id || !item_ids || !Array.isArray(item_ids)) {
        return new Response(JSON.stringify({
          error: 'playlist_id and item_ids array are required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { error: reorderError } = await supabase.rpc('playlist_reorder_items', {
        p_playlist_id: playlist_id,
        p_item_ids: item_ids,
      });
      if (reorderError) throw reorderError;
      return new Response(JSON.stringify({
        success: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle media scraping (YouTube integration)
    if (action === 'scrape') {
      if (!url) {
        return new Response(JSON.stringify({
          error: 'url is required for scraping'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // Call youtube-scraper function
      const scrapeResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-scraper`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          url
        })
      });
      if (!scrapeResponse.ok) {
        const errorData = await scrapeResponse.json();
        throw new Error(errorData.error || 'YouTube scraper failed');
      }
      const { videos } = await scrapeResponse.json();
      if (!videos || videos.length === 0) {
        return new Response(JSON.stringify({
          error: 'No videos found at the provided URL'
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // Insert media items — canonical deduplication via create_or_get_media_item RPC
      const mediaItems = [];
      const playabilitySummary = {
        playable: 0,
        embed_blocked: 0,
        restricted: 0,
        unavailable: 0,
        invalid: 0,
        check_failed: 0,
        unknown: 0,
      };
      for (const video of videos){
        const playabilityStatus = videoPlayabilityStatus(video);
        if (playabilityStatus in playabilitySummary) {
          playabilitySummary[playabilityStatus as keyof typeof playabilitySummary]++;
        } else {
          playabilitySummary.unknown++;
        }

        const { data: mediaId, error: mediaError } = await supabase.rpc('create_or_get_media_item', {
          p_source_id:   video.id,
          p_source_type: 'youtube',
          p_title:       video.title,
          p_artist:      video.artist || null,
          p_url:         video.url,
          p_duration:    video.duration || null,
          p_thumbnail:   video.thumbnail || null,
          p_metadata:    {
            youtube_playability_status: playabilityStatus,
            youtube_playability_reason: videoPlayabilityReason(video),
            youtube_embeddable: typeof video.embeddable === 'boolean' ? video.embeddable : null,
            youtube_oembed_ok: typeof video.oembedOk === 'boolean' ? video.oembedOk : null,
          },
        });
        if (mediaError) throw mediaError;
        if (mediaId) {
          await recordVideoPlayability(supabase, mediaId, video, playlist_id ? 'playlist_import' : 'playlist_scrape');
          const resolvedMediaId = await resolveImportedYouTubeMedia(supabase, mediaId, video);
          if (!resolvedMediaId) continue;

          const { data: fullItem, error: fullItemError } = await supabase.from('media_items').select('*').eq('id', resolvedMediaId).maybeSingle();
          if (fullItemError) throw fullItemError;
          if (fullItem) mediaItems.push(fullItem);
        }
      }
      // If playlist_id provided, add items to playlist
      if (playlist_id) {
        const { error: appendError } = await supabase.rpc('playlist_append_items', {
          p_playlist_id: playlist_id,
          p_media_item_ids: mediaItems.map((media) => media.id),
        });
        if (appendError) throw appendError;
      }
      return new Response(JSON.stringify({
        media_items: mediaItems,
        count: mediaItems.length,
        playability_summary: playabilitySummary,
        playlist_id: playlist_id || null
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle setting a playlist as active for a player (server-side)
    if (action === 'set_active') {
      if (!player_id || !playlist_id
        || (current_index !== undefined && (!Number.isSafeInteger(current_index) || current_index < -1))) {
        return new Response(JSON.stringify({
          error: 'player_id and playlist_id are required; current_index must be an integer of -1 or greater'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { error: activeError } = await supabase.rpc('playlist_set_active', {
        p_player_id: player_id,
        p_playlist_id: playlist_id,
        p_current_index: current_index ?? null,
      });
      if (activeError) throw activeError;
      return new Response(JSON.stringify({
        success: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle clearing the queue
    // NOTE: always pass p_type='normal' so priority (kiosk) items are never destroyed.
    // The old 3-step flow (set_active→clear_queue→import_queue) called this with no type,
    // which cleared ALL items including priority queue entries.
    if (action === 'clear_queue') {
      if (!player_id) {
        return new Response(JSON.stringify({
          error: 'player_id is required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { error: clearError } = await supabase.rpc('queue_clear', {
        p_player_id: player_id,
        p_type: 'normal'
      });
      if (clearError) throw clearError;
      return new Response(JSON.stringify({
        success: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle importing playlist into queue
    if (action === 'import_queue') {
      if (!player_id || !playlist_id) {
        return new Response(JSON.stringify({
          error: 'player_id and playlist_id are required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // Use load_playlist RPC to import the playlist into queue
      const { data: loaded, error: importError } = await supabase.rpc('load_playlist', {
        p_player_id: player_id,
        p_playlist_id: playlist_id,
        p_start_index: 0
      });
      if (importError) throw importError;
      return new Response(JSON.stringify({
        loaded_count: loaded?.[0]?.loaded_count || 0
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle atomic playlist load (replaces the 3-call set_active+clear_queue+import_queue sequence)
    // Uses the load_playlist RPC which handles locking, shuffle, queue clear, and status update atomically.
    if (action === 'load_playlist') {
      if (!player_id || !playlist_id) {
        return new Response(JSON.stringify({
          error: 'player_id and playlist_id are required'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const { data: loaded, error: loadError } = await supabase.rpc('load_playlist', {
        p_player_id:   player_id,
        p_playlist_id: playlist_id,
        p_start_index: 0
      });
      if (loadError) throw loadError;
      return new Response(JSON.stringify({
        success: true,
        loaded_count: loaded?.[0]?.loaded_count || 0
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    // Handle removing a media item from future playback for a player.
    // This is now a soft exclusion: playlist rows remain for audit/history, but
    // load_playlist/queue_next will skip the item unless an override is added.
    if (action === 'remove_media_globally') {
      if (!player_id || !media_item_id) {
        return new Response(JSON.stringify({
          error: 'player_id and media_item_id are required'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await markMediaExcluded(supabase, media_item_id, 'runtime_unavailable', {
        player_id,
        requested_by: 'player_runtime',
      });

      const { error: queueDeleteError } = await supabase
        .from('queue')
        .delete()
        .eq('player_id', player_id)
        .eq('media_item_id', media_item_id)
        .is('played_at', null);
      if (queueDeleteError) throw queueDeleteError;

      await supabase.from('system_logs').insert({
        player_id,
        severity: 'warn',
        event: 'media_soft_excluded_unavailable',
        payload: { media_item_id }
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({
      error: `Unknown action: ${action}`
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Playlist manager error:', error);
    return new Response(JSON.stringify({
      error: errorMessage(error)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
