// Kiosk Handler Edge Function
// Handles kiosk operations: search, credits, song requests

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface KioskRequest {
  session_id?: string;
  player_id?: string;
  action: 'init' | 'search' | 'credit' | 'request';
  query?: string;
  media_item_id?: string;
  amount?: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client (anon access for kiosk)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Parse request body
    const body: KioskRequest = await req.json();
    const { session_id, player_id, action, query, media_item_id, amount = 1 } = body;

    // Handle session initialization
    if (action === 'init') {
      if (!player_id) {
        return new Response(
          JSON.stringify({ error: 'player_id is required for init' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get or create kiosk session
      const { data: existingSession } = await supabase
        .from('kiosk_sessions')
        .select('*')
        .eq('player_id', player_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingSession && (new Date().getTime() - new Date(existingSession.last_active).getTime()) < 3600000) {
        // Reuse session if < 1 hour old
        return new Response(
          JSON.stringify({ session: existingSession }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create new session
      const { data: newSession, error: sessionError } = await supabase
        .from('kiosk_sessions')
        .insert({
          player_id,
          credits: 0,
          ip_address: req.headers.get('x-forwarded-for') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown'
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      return new Response(
        JSON.stringify({ session: newSession }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // All other actions require session_id
    if (!session_id) {
      return new Response(
        JSON.stringify({ error: 'session_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle search
    if (action === 'search') {
      if (!query || query.trim().length === 0) {
        return new Response(
          JSON.stringify({ results: [] }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Search media items (simple text search - can be enhanced)
      const { data: results, error: searchError } = await supabase
        .from('media_items')
        .select('*')
        .or(`title.ilike.%${query}%,artist.ilike.%${query}%`)
        .limit(20);

      if (searchError) throw searchError;

      // TODO: Integrate yt-dlp for external search
      // For now, just return local database results

      return new Response(
        JSON.stringify({ results: results || [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle credit increment
    if (action === 'credit') {
      const { data: newCredits, error: creditError } = await supabase
        .rpc('kiosk_increment_credit', {
          p_session_id: session_id,
          p_amount: amount
        });

      if (creditError) throw creditError;

      return new Response(
        JSON.stringify({ credits: newCredits }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle song request
    if (action === 'request') {
      if (!media_item_id) {
        return new Response(
          JSON.stringify({ error: 'media_item_id is required for request' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get session and player settings
      const { data: session, error: sessionError } = await supabase
        .from('kiosk_sessions')
        .select('*, player:players!inner(*)')
        .eq('session_id', session_id)
        .single();

      if (sessionError || !session) {
        return new Response(
          JSON.stringify({ error: 'Session not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: settings } = await supabase
        .from('player_settings')
        .select('freeplay, coin_per_song')
        .eq('player_id', session.player_id)
        .single();

      // Check credits or freeplay
      if (!settings?.freeplay && session.credits < (settings?.coin_per_song || 1)) {
        return new Response(
          JSON.stringify({ error: 'Insufficient credits' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Add to priority queue
      const { data: queueId, error: queueError } = await supabase
        .rpc('queue_add', {
          p_player_id: session.player_id,
          p_media_item_id: media_item_id,
          p_type: 'priority',
          p_requested_by: session_id
        });

      if (queueError) throw queueError;

      // Deduct credits (if not freeplay)
      let newCredits = session.credits;
      if (!settings?.freeplay) {
        const { data: credits, error: deductError } = await supabase
          .rpc('kiosk_decrement_credit', {
            p_session_id: session_id,
            p_amount: settings?.coin_per_song || 1
          });

        if (deductError) throw deductError;
        newCredits = credits;
      }

      return new Response(
        JSON.stringify({
          success: true,
          queue_id: queueId,
          credits: newCredits
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Kiosk handler error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
