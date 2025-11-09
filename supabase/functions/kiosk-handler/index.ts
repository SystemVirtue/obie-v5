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
    // Initialize Supabase client with service role key
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const body: KioskRequest = await req.json();
    const { action } = body;
    
    console.log('Action:', action);

    // Handle session initialization
    if (action === 'init') {
      console.log('Creating new kiosk session');
      
      // Get the default player (first player in the system)
      const { data: player, error: playerError } = await supabase
        .from('players')
        .select('id')
        .limit(1)
        .single();

      if (playerError || !player) {
        console.error('No player found:', playerError);
        return new Response(
          JSON.stringify({ error: 'No player configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create new session
      const { data: session, error: sessionError } = await supabase
        .from('kiosk_sessions')
        .insert({
          player_id: player.id,
          credits: 0,
        })
        .select()
        .single();

      if (sessionError || !session) {
        console.error('Failed to create session:', sessionError);
        return new Response(
          JSON.stringify({ error: 'Failed to create session' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Created session:', session.session_id);
      
      return new Response(
        JSON.stringify({ session }),
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
