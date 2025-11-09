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
    console.log('Kiosk handler called');
    
    // Parse request body
    const body: KioskRequest = await req.json();
    const { action } = body;
    
    console.log('Action:', action);

    // Handle session initialization
    if (action === 'init') {
      console.log('Init action - returning test response');
      
      // Test response without database operations
      return new Response(
        JSON.stringify({ 
          session: {
            session_id: 'test-session-id',
            player_id: '00000000-0000-0000-0000-000000000001',
            credits: 0,
            created_at: new Date().toISOString()
          }
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
