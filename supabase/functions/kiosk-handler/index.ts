// Kiosk Handler Edge Function
// Handles kiosk operations: search, credits, song requests
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
    // Initialize Supabase client with service role key
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // Parse request body
    const body = await req.json();
    const { action } = body;
    console.log('Action:', action);
    // Handle session initialization
    if (action === 'init') {
      console.log('Creating new kiosk session');
      // Get the default player (first player in the system)
      const { data: player, error: playerError } = await supabase.from('players').select('id').limit(1).single();
      if (playerError || !player) {
        console.error('No player found:', playerError);
        return new Response(JSON.stringify({
          error: 'No player configured'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // Create new session
      const { data: session, error: sessionError } = await supabase.from('kiosk_sessions').insert({
        player_id: player.id,
        credits: 0
      }).select().single();
      if (sessionError || !session) {
        console.error('Failed to create session:', sessionError);
        return new Response(JSON.stringify({
          error: 'Failed to create session'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      console.log('Created session:', session.session_id);
      return new Response(JSON.stringify({
        session
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle free-text search forwarded to youtube-scraper (server-side)
    if (action === 'search') {
      const query = body.query || '';
      try {
        // Forward search to youtube-scraper using service role key so yt-dlp or API can be used server-side
        const scraperResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-scraper`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            query,
            type: 'search'
          })
        });
        const payload = await scraperResp.text();
        // Pass through status and body
        return new Response(payload, {
          status: scraperResp.status,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      } catch (err) {
        console.error('Kiosk handler search error:', err);
        return new Response(JSON.stringify({
          error: err.message
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Handle atomic request enqueue: deduct credits (unless freeplay) and enqueue as priority
    if (action === 'request') {
      const { session_id, media_item_id } = body;
      if (!session_id || !media_item_id) {
        return new Response(JSON.stringify({
          error: 'session_id and media_item_id are required for request action'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      try {
        // Call DB RPC which performs an atomic debit-and-enqueue
        const { data: queueId, error: rpcError } = await supabase.rpc('kiosk_request_enqueue', {
          p_session_id: session_id,
          p_media_item_id: media_item_id
        });
        if (rpcError) {
          console.error('kiosk_request_enqueue error:', rpcError);
          return new Response(JSON.stringify({
            error: rpcError.message || rpcError
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
        return new Response(JSON.stringify({
          queue_id: queueId
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      } catch (err) {
        console.error('Kiosk handler request error:', err);
        return new Response(JSON.stringify({
          error: err.message
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Handle adding credits to a session (e.g., coin insert)
    if (action === 'credit') {
      const { session_id, amount } = body;
      if (!session_id || typeof amount !== 'number') {
        return new Response(JSON.stringify({
          error: 'session_id and numeric amount are required for credit action'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      try {
        const { data: existing, error: fetchErr } = await supabase.from('kiosk_sessions').select('credits').eq('session_id', session_id).single();
        if (fetchErr || !existing) {
          return new Response(JSON.stringify({
            error: 'Session not found'
          }), {
            status: 404,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
        const newCredits = (existing.credits || 0) + amount;
        const { data: updated, error: updErr } = await supabase.from('kiosk_sessions').update({
          credits: newCredits
        }).eq('session_id', session_id).select().single();
        if (updErr) {
          console.error('Failed to update credits:', updErr);
          return new Response(JSON.stringify({
            error: updErr.message || updErr
          }), {
            status: 500,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
        return new Response(JSON.stringify({
          credits: updated.credits
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      } catch (err) {
        console.error('Credit action error:', err);
        return new Response(JSON.stringify({
          error: err.message
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
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
    console.error('Kiosk handler error:', error);
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
