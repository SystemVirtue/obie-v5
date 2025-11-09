// Helper: Sync queue to playlist order if playlist is active
async function syncQueueIfActive(supabase: any, player_id: string, playlist_id: string) {
  // Check if this playlist is the active one for the player
  const { data: player } = await supabase
    .from('players')
    .select('active_playlist_id')
    .eq('id', player_id)
    .maybeSingle();
  if (!player || player.active_playlist_id !== playlist_id) return;

  // Get playlist items in order
  const { data: items } = await supabase
    .from('playlist_items')
    .select('media_item_id')
    .eq('playlist_id', playlist_id)
    .order('position', { ascending: true });
  if (!items || items.length === 0) return;

  // Find all queue items for this player/type that match the playlist order
  const { data: queueItems } = await supabase
    .from('queue')
    .select('id,media_item_id')
    .eq('player_id', player_id)
    .eq('type', 'normal')
    .is('played_at', null);
  if (!queueItems) return;

  // Build ordered list of queue IDs matching playlist order
  const queueIdOrder = items
    .map((pl: any) => queueItems.find((q: any) => q.media_item_id === pl.media_item_id))
    .filter(Boolean)
    .map((q: any) => q.id);
  if (queueIdOrder.length === 0) return;

  // Call queue_reorder to update the queue order
  await supabase.rpc('queue_reorder_wrapper', {
    p_player_id: player_id,
    p_queue_ids: queueIdOrder,
    p_type: 'normal',
  });
}
// Playlist Manager Edge Function
// Handles playlist CRUD operations and media scraping

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface PlaylistRequest {
  action: 'create' | 'update' | 'delete' | 'add_item' | 'remove_item' | 'reorder' | 'scrape';
  player_id?: string;
  playlist_id?: string;
  name?: string;
  description?: string;
  media_item_id?: string;
  item_ids?: string[];
  url?: string; // for scraping
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client (uses service role for admin operations)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // Parse request body
    const body: PlaylistRequest = await req.json();
    const { action, player_id, playlist_id, name, description, media_item_id, item_ids, url } = body;

    // Handle playlist creation
    if (action === 'create') {
      if (!player_id || !name) {
        return new Response(
          JSON.stringify({ error: 'player_id and name are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: playlist, error: createError } = await supabase
        .from('playlists')
        .insert({
          player_id,
          name,
          description: description || null
        })
        .select()
        .maybeSingle();
      if (createError) throw createError;
      if (!playlist) {
        return new Response(
          JSON.stringify({ error: 'Playlist creation failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ playlist }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle playlist update
    if (action === 'update') {
      if (!playlist_id) {
        return new Response(
          JSON.stringify({ error: 'playlist_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const updateData: any = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;

      const { data: playlist, error: updateError } = await supabase
        .from('playlists')
        .update(updateData)
        .eq('id', playlist_id)
        .select()
        .maybeSingle();
      if (updateError) throw updateError;
      if (!playlist) {
        return new Response(
          JSON.stringify({ error: 'Playlist update failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ playlist }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle playlist deletion
    if (action === 'delete') {
      if (!playlist_id) {
        return new Response(
          JSON.stringify({ error: 'playlist_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error: deleteError } = await supabase
        .from('playlists')
        .delete()
        .eq('id', playlist_id);

      if (deleteError) throw deleteError;

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle adding item to playlist
    if (action === 'add_item') {
      if (!playlist_id || !media_item_id) {
        return new Response(
          JSON.stringify({ error: 'playlist_id and media_item_id are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get next position
      const { data: maxPos } = await supabase
        .from('playlist_items')
        .select('position')
        .eq('playlist_id', playlist_id)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextPosition = (maxPos?.position ?? -1) + 1;
      const { data: item, error: addError } = await supabase
        .from('playlist_items')
        .insert({
          playlist_id,
          media_item_id,
          position: nextPosition
        })
        .select()
        .maybeSingle();
      if (addError) throw addError;
      if (!item) {
        return new Response(
          JSON.stringify({ error: 'Failed to add item to playlist' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Sync queue if this is the active playlist
      if (player_id) await syncQueueIfActive(supabase, player_id, playlist_id);
      return new Response(
        JSON.stringify({ item }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle removing item from playlist
    if (action === 'remove_item') {
      if (!playlist_id || !media_item_id) {
        return new Response(
          JSON.stringify({ error: 'playlist_id and media_item_id are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error: removeError } = await supabase
        .from('playlist_items')
        .delete()
        .eq('playlist_id', playlist_id)
        .eq('media_item_id', media_item_id);

      if (removeError) throw removeError;

      // Reorder remaining items
      const { data: items } = await supabase
        .from('playlist_items')
        .select('id')
        .eq('playlist_id', playlist_id)
        .order('position', { ascending: true });

      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          await supabase
            .from('playlist_items')
            .update({ position: i })
            .eq('id', items[i].id);
        }
      }

      // Sync queue if this is the active playlist
      if (player_id) await syncQueueIfActive(supabase, player_id, playlist_id);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle reordering playlist items
    if (action === 'reorder') {
      if (!playlist_id || !item_ids || !Array.isArray(item_ids)) {
        return new Response(
          JSON.stringify({ error: 'playlist_id and item_ids array are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update positions
      for (let i = 0; i < item_ids.length; i++) {
        await supabase
          .from('playlist_items')
          .update({ position: i })
          .eq('id', item_ids[i])
          .eq('playlist_id', playlist_id);
      }

      // Sync queue if this is the active playlist
      if (player_id) await syncQueueIfActive(supabase, player_id, playlist_id);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle media scraping (YouTube integration)
    if (action === 'scrape') {
      if (!url) {
        return new Response(
          JSON.stringify({ error: 'url is required for scraping' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Call youtube-scraper function
      const scrapeResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-scraper`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ url }),
        }
      );

      if (!scrapeResponse.ok) {
        const errorData = await scrapeResponse.json();
        throw new Error(errorData.error || 'YouTube scraper failed');
      }

      const { videos } = await scrapeResponse.json();

      if (!videos || videos.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No videos found at the provided URL' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Insert media items (with deduplication by source_id)
      const mediaItems = [];
      for (const video of videos) {
        const mediaData = {
          source_id: video.id,
          source_type: 'youtube',
          title: video.title,
          artist: video.artist,
          url: video.url,
          duration: video.duration,
          thumbnail: video.thumbnail,
          metadata: {},
        };

        // Check if media item already exists
        const { data: existing } = await supabase
          .from('media_items')
          .select('id')
          .eq('source_id', video.id)
          .eq('source_type', 'youtube')
          .maybeSingle();
        if (existing) {
          // Update existing record
          const { data: updated } = await supabase
            .from('media_items')
            .update(mediaData)
            .eq('id', existing.id)
            .select()
            .maybeSingle();
          if (updated) mediaItems.push(updated);
        } else {
          // Insert new record
          const { data: inserted } = await supabase
            .from('media_items')
            .insert(mediaData)
            .select()
            .maybeSingle();
          if (inserted) mediaItems.push(inserted);
        }
      }

      // If playlist_id provided, add items to playlist
      if (playlist_id) {
        // Get current max position
        const { data: maxPos } = await supabase
          .from('playlist_items')
          .select('position')
          .eq('playlist_id', playlist_id)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        let position = (maxPos?.position || 0) + 1;

        // Batch insert playlist items
        const playlistItems = mediaItems.map(media => ({
          playlist_id,
          media_item_id: media.id,
          position: position++,
        }));

        await supabase
          .from('playlist_items')
          .insert(playlistItems);

        // Sync queue if this is the active playlist
        if (player_id) await syncQueueIfActive(supabase, player_id, playlist_id);
      }

      return new Response(
        JSON.stringify({ 
          media_items: mediaItems,
          count: mediaItems.length,
          playlist_id: playlist_id || null,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle setting a playlist as active for a player (server-side)
    if (action === 'set_active') {
      if (!player_id || !playlist_id) {
        return new Response(
          JSON.stringify({ error: 'player_id and playlist_id are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Unset any existing active playlists for this player
      const { error: unsetError } = await supabase
        .from('playlists')
        .update({ is_active: false })
        .eq('player_id', player_id);
      if (unsetError) throw unsetError;

      // Set the requested playlist active
      const { error: setError } = await supabase
        .from('playlists')
        .update({ is_active: true })
        .eq('id', playlist_id);
      if (setError) throw setError;

      // Update player's active_playlist_id
      const { error: playerUpdateError } = await supabase
        .from('players')
        .update({ active_playlist_id: playlist_id })
        .eq('id', player_id);
      if (playerUpdateError) throw playerUpdateError;

      // Sync queue if this is the active playlist (it always is after set_active)
      await syncQueueIfActive(supabase, player_id, playlist_id);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Playlist manager error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
