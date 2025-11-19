// Helper: Sync queue to playlist order if playlist is active
async function syncQueueIfActive(supabase, player_id, playlist_id) {
  // Check if this playlist is the active one for the player
  const { data: player } = await supabase.from('players').select('active_playlist_id').eq('id', player_id).maybeSingle();
  if (!player || player.active_playlist_id !== playlist_id) return;
  // Get playlist items in order
  const { data: items } = await supabase.from('playlist_items').select('media_item_id').eq('playlist_id', playlist_id).order('position', {
    ascending: true
  });
  if (!items || items.length === 0) return;
  // Find all queue items for this player/type that match the playlist order
  const { data: queueItems } = await supabase.from('queue').select('id,media_item_id').eq('player_id', player_id).eq('type', 'normal').is('played_at', null);
  if (!queueItems) return;
  // Build ordered list of queue IDs matching playlist order
  const queueIdOrder = items.map((pl)=>queueItems.find((q)=>q.media_item_id === pl.media_item_id)).filter(Boolean).map((q)=>q.id);
  if (queueIdOrder.length === 0) return;
  // Call queue_reorder to update the queue order
  await supabase.rpc('queue_reorder_wrapper', {
    p_player_id: player_id,
    p_queue_ids: queueIdOrder,
    p_type: 'normal'
  });
}
// Playlist Manager Edge Function
// Handles playlist CRUD operations and media scraping
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
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
      const updateData = {};
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
      // Get next position
      const { data: maxPos } = await supabase.from('playlist_items').select('position').eq('playlist_id', playlist_id).order('position', {
        ascending: false
      }).limit(1).maybeSingle();
      const nextPosition = (maxPos?.position ?? -1) + 1;
      const { data: item, error: addError } = await supabase.from('playlist_items').insert({
        playlist_id,
        media_item_id,
        position: nextPosition
      }).select().maybeSingle();
      if (addError) throw addError;
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
      // Sync queue if this is the active playlist
      if (player_id) await syncQueueIfActive(supabase, player_id, playlist_id);
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
      const { error: removeError } = await supabase.from('playlist_items').delete().eq('playlist_id', playlist_id).eq('media_item_id', media_item_id);
      if (removeError) throw removeError;
      // Reorder remaining items
      const { data: items } = await supabase.from('playlist_items').select('id').eq('playlist_id', playlist_id).order('position', {
        ascending: true
      });
      if (items && items.length > 0) {
        for(let i = 0; i < items.length; i++){
          await supabase.from('playlist_items').update({
            position: i
          }).eq('id', items[i].id);
        }
      }
      // Sync queue if this is the active playlist
      if (player_id) await syncQueueIfActive(supabase, player_id, playlist_id);
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
      // Update positions
      for(let i = 0; i < item_ids.length; i++){
        await supabase.from('playlist_items').update({
          position: i
        }).eq('id', item_ids[i]).eq('playlist_id', playlist_id);
      }
      // Sync queue if this is the active playlist
      if (player_id) await syncQueueIfActive(supabase, player_id, playlist_id);
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
      // Stream videos in batches to handle large playlists
      let totalProcessed = 0;
      let pageToken = null;
      const BATCH_SIZE = 25; // Smaller batch size
      
      do {
        // Call youtube-scraper with pagination
        const scrapeResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-scraper`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            url,
            maxResults: BATCH_SIZE,
            pageToken
          })
        });
        
        if (!scrapeResponse.ok) {
          const errorData = await scrapeResponse.json();
          throw new Error(errorData.error || 'YouTube scraper failed');
        }
        
        const { videos: batchVideos, nextPageToken } = await scrapeResponse.json();
        if (!batchVideos || batchVideos.length === 0) {
          break; // No more videos
        }
        
        console.log(`Processing batch of ${batchVideos.length} videos...`);
        
        // Process this batch immediately
        const batchMediaItems = [];
        for (const video of batchVideos) {
          const mediaData = {
            source_id: video.id,
            source_type: 'youtube',
            title: video.title,
            artist: video.artist,
            url: video.url,
            duration: video.duration,
            thumbnail: video.thumbnail,
            metadata: {}
          };
          // Check if media item already exists
          const { data: existing } = await supabase.from('media_items').select('id').eq('source_id', video.id).eq('source_type', 'youtube').maybeSingle();
          if (existing) {
            // Update existing record
            const { data: updated } = await supabase.from('media_items').update(mediaData).eq('id', existing.id).select().maybeSingle();
            if (updated) batchMediaItems.push(updated);
          } else {
            // Insert new record
            const { data: inserted } = await supabase.from('media_items').insert(mediaData).select().maybeSingle();
            if (inserted) batchMediaItems.push(inserted);
          }
        }
        
        // If playlist_id provided, add this batch to playlist (skip duplicates)
        if (playlist_id && batchMediaItems.length > 0) {
          // Get existing media_item_ids in this playlist
          const { data: existingItems } = await supabase.from('playlist_items').select('media_item_id').eq('playlist_id', playlist_id);
          const existingIds = new Set(existingItems?.map(item => item.media_item_id) || []);
          
          // Filter out items already in playlist
          const newItems = batchMediaItems.filter(media => !existingIds.has(media.id));
          
          if (newItems.length > 0) {
            // Get current max position
            const { data: maxPos } = await supabase.from('playlist_items').select('position').eq('playlist_id', playlist_id).order('position', {
              ascending: false
            }).limit(1).maybeSingle();
            let position = (maxPos?.position || 0) + 1;
            
            const playlistItems = newItems.map((media) => ({
              playlist_id,
              media_item_id: media.id,
              position: position++
            }));
            
            await supabase.from('playlist_items').insert(playlistItems);
            console.log(`Added ${newItems.length} new items to playlist`);
          } else {
            console.log(`All ${batchMediaItems.length} items already in playlist`);
          }
        }
        
        totalProcessed += batchVideos.length;
        pageToken = nextPageToken;
        
        console.log(`Completed batch. Total processed: ${totalProcessed}`);
        
      } while (pageToken);
      
      // Sync queue if this is the active playlist (only once at the end)
      if (playlist_id && player_id) {
        await syncQueueIfActive(supabase, player_id, playlist_id);
      }
      return new Response(JSON.stringify({
        media_items: [], // Don't return all items for large playlists
        count: totalProcessed,
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
      // Unset any existing active playlists for this player
      const { error: unsetError } = await supabase.from('playlists').update({
        is_active: false
      }).eq('player_id', player_id);
      if (unsetError) throw unsetError;
      // Set the requested playlist active
      const { error: setError } = await supabase.from('playlists').update({
        is_active: true
      }).eq('id', playlist_id);
      if (setError) throw setError;
      // Update player's active_playlist_id
      const { error: playerUpdateError } = await supabase.from('players').update({
        active_playlist_id: playlist_id
      }).eq('id', player_id);
      if (playerUpdateError) throw playerUpdateError;
      // If current_index is provided, update player_status
      if (current_index !== undefined) {
        const { error: statusError } = await supabase.from('player_status').update({
          now_playing_index: current_index
        }).eq('player_id', player_id);
        if (statusError) throw statusError;
      }
      // Sync queue if this is the active playlist (it always is after set_active)
      await syncQueueIfActive(supabase, player_id, playlist_id);
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
        p_player_id: player_id
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
      // Check current player state
      const { data: currentStatus } = await supabase.from('player_status').select('state').eq('player_id', player_id).maybeSingle();
      // Use load_playlist RPC to import the playlist into queue
      const { data: loaded, error: importError } = await supabase.rpc('load_playlist', {
        p_player_id: player_id,
        p_playlist_id: playlist_id,
        p_start_index: 0
      });
      if (importError) throw importError;
      // Reset now_playing_index to -1 (Now Playing position)
      // Only reset state/progress/current_media if player is not currently playing
      const updateData = {
        now_playing_index: -1
      };
      // If player is not playing or paused, reset the playback state
      if (!currentStatus || currentStatus.state !== 'playing' && currentStatus.state !== 'paused') {
        updateData.current_media_id = null;
        updateData.state = 'idle';
        updateData.progress = 0;
      }
      const { error: indexError } = await supabase.from('player_status').update(updateData).eq('player_id', player_id);
      if (indexError) throw indexError;
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
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
