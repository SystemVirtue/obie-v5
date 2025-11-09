// Queue Manager Edge Function
// Handles all queue operations with atomic RPC calls

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface QueueRequest {
  player_id: string;
  action: 'add' | 'remove' | 'reorder' | 'next' | 'skip' | 'clear';
  media_item_id?: string;
  queue_id?: string;
  queue_ids?: string[];
  type?: 'normal' | 'priority';
  requested_by?: string;
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
    const body: QueueRequest = await req.json();
    const { player_id, action, media_item_id, queue_id, queue_ids, type = 'normal', requested_by = 'admin' } = body;

    if (!player_id) {
      return new Response(
        JSON.stringify({ error: 'player_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if player is online
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('status')
      .eq('id', player_id)
      .single();

    if (playerError || !player) {
      return new Response(
        JSON.stringify({ error: 'Player not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (player.status !== 'online') {
      return new Response(
        JSON.stringify({ error: 'Player is offline' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Execute action via RPC
    let result;
    switch (action) {
      case 'add':
        if (!media_item_id) {
          return new Response(
            JSON.stringify({ error: 'media_item_id is required for add action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data: queueId, error: addError } = await supabase
          .rpc('queue_add', {
            p_player_id: player_id,
            p_media_item_id: media_item_id,
            p_type: type,
            p_requested_by: requested_by
          });
        if (addError) throw addError;
        result = { queue_id: queueId };
        break;

      case 'remove':
        if (!queue_id) {
          return new Response(
            JSON.stringify({ error: 'queue_id is required for remove action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { error: removeError } = await supabase
          .rpc('queue_remove', { p_queue_id: queue_id });
        if (removeError) throw removeError;
        result = { success: true };
        break;

      case 'reorder':
        if (!queue_ids || !Array.isArray(queue_ids)) {
          return new Response(
            JSON.stringify({ error: 'queue_ids array is required for reorder action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // Call the unambiguous wrapper RPC to avoid overload ambiguity
        const { error: reorderError } = await supabase
          .rpc('queue_reorder_wrapper', {
            p_player_id: player_id,
            p_queue_ids: queue_ids,
            p_type: type
          });
        if (reorderError) throw reorderError;
        result = { success: true };
        break;

      case 'next':
        const { data: nextItem, error: nextError } = await supabase
          .rpc('queue_next', { p_player_id: player_id });
        if (nextError) throw nextError;
        result = { next_item: nextItem?.[0] || null };
        break;

      case 'skip':
        const { error: skipError } = await supabase
          .rpc('queue_skip', { p_player_id: player_id });
        if (skipError) throw skipError;
        result = { success: true };
        break;

      case 'clear':
        const { error: clearError } = await supabase
          .rpc('queue_clear', {
            p_player_id: player_id,
            p_type: type === 'normal' ? type : (type === 'priority' ? type : null)
          });
        if (clearError) throw clearError;
        result = { success: true };
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Queue manager error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
