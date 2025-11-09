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

  // Handle free-text search forwarded to youtube-scraper (server-side)
    if (action === 'search') {
      const query = body.query || '';
      try {
        // Forward search to youtube-scraper using service role key so yt-dlp or API can be used server-side
        const scraperResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-scraper`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ query, type: 'search' }),
        });

        const payload = await scraperResp.text();
        // Pass through status and body
        return new Response(payload, { status: scraperResp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (err) {
        console.error('Kiosk handler search error:', err);
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Handle atomic request enqueue: deduct credits (unless freeplay) and enqueue as priority
    // Accept either media_item_id (already scraped) or url - in the latter case, the handler
    // will call playlist-manager.scrape (server-side) to create/fetch the media_item, then enqueue.
    if (action === 'request') {
      const { session_id, media_item_id, url } = body as any;
      if (!session_id || (!media_item_id && !url)) {
        return new Response(
          JSON.stringify({ error: 'session_id and media_item_id or url are required for request action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      try {
        let mId = media_item_id;

        // If client provided a URL, call playlist-manager to scrape/create the media item(s)
        if (!mId && url) {
          try {
            const scraperResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/playlist-manager`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({ action: 'scrape', url, player_id: body.player_id }),
            });

            if (!scraperResp.ok) {
              const text = await scraperResp.text();
              console.error('playlist-manager.scrape failed:', text);
              return new Response(JSON.stringify({ error: 'Failed to scrape media item' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            const scraped = await scraperResp.json();
            // playlist-manager may return an array of media items or an object
            if (Array.isArray(scraped) && scraped.length > 0 && scraped[0].id) {
              mId = scraped[0].id;
            } else if (scraped.media_items && scraped.media_items.length && scraped.media_items[0].id) {
              mId = scraped.media_items[0].id;
            } else if (scraped.id) {
              mId = scraped.id;
            }

            if (!mId) {
              console.error('Unable to determine media_item_id from playlist-manager response:', scraped);
              return new Response(JSON.stringify({ error: 'Failed to obtain media_item_id from scraper' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
          } catch (err) {
            console.error('Error calling playlist-manager from kiosk-handler:', err);
            return new Response(JSON.stringify({ error: 'Scrape error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }

        // Call DB RPC which performs an atomic debit-and-enqueue
        const { data: queueId, error: rpcError } = await supabase.rpc('kiosk_request_enqueue', {
          p_session_id: session_id,
          p_media_item_id: mId,
        } as any);

        if (rpcError) {
          console.error('kiosk_request_enqueue error:', rpcError);
          return new Response(
            JSON.stringify({ error: rpcError.message || rpcError }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify({ queue_id: queueId }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (err) {
        console.error('Kiosk handler request error:', err);
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Handle adding credits to a session (e.g., coin insert)
    if (action === 'credit') {
      const { session_id, amount } = body as any;
      if (!session_id || typeof amount !== 'number') {
        return new Response(
          JSON.stringify({ error: 'session_id and numeric amount are required for credit action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      try {
        const { data: existing, error: fetchErr } = await supabase
          .from('kiosk_sessions')
          .select('credits')
          .eq('session_id', session_id)
          .single();

        if (fetchErr || !existing) {
          return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const newCredits = (existing.credits || 0) + amount;

        const { data: updated, error: updErr } = await supabase
          .from('kiosk_sessions')
          .update({ credits: newCredits })
          .eq('session_id', session_id)
          .select()
          .single();

        if (updErr) {
          console.error('Failed to update credits:', updErr);
          return new Response(JSON.stringify({ error: updErr.message || updErr }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ credits: updated.credits }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (err) {
        console.error('Credit action error:', err);
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
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
