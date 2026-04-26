// Player Control Edge Function
// Handles player status updates and heartbeat
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

async function logSystemEvent(supabase, playerId, event, severity = 'info', payload = {}) {
  const { error } = await supabase.from('system_logs').insert({
    player_id: playerId,
    event,
    severity,
    payload,
  });
  if (error) {
    console.error('[player-control] Failed to log system event:', event, error);
  }
}

async function isMasterEndpoint(supabase, playerId, endpointId) {
  if (!endpointId) return false;
  const { data: player } = await supabase
    .from('players')
    .select('priority_endpoint_id')
    .eq('id', playerId)
    .single();

  return player?.priority_endpoint_id === endpointId;
}

Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // Create Supabase client with service role key to bypass RLS
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // Parse request body
    const body = await req.json();
    const {
      player_id,
      state,
      progress,
      action = 'update',
      expected_media_id,
      session_id,
      endpoint_id,
      target_endpoint_id,
      stored_player_id,
      stored_endpoint_id,
      initiator,
      reason,
      event_name,
      severity,
      payload,
      origin,
      user_agent,
    } = body;
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
    // Handle heartbeat
    if (action === 'heartbeat') {
      const { error } = endpoint_id && session_id
        ? await supabase.rpc('player_endpoint_heartbeat', {
            p_player_id: player_id,
            p_endpoint_id: endpoint_id,
            p_session_id: session_id,
          })
        : await supabase.rpc('player_heartbeat', {
            p_player_id: player_id
          });
      if (error) throw error;
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

    if (action === 'client_log') {
      await logSystemEvent(
        supabase,
        player_id,
        typeof event_name === 'string' && event_name ? event_name : 'client_log',
        severity === 'debug' || severity === 'warn' || severity === 'error' ? severity : 'info',
        {
          source: initiator || 'player_client',
          reason: reason || null,
          ...(payload && typeof payload === 'object' ? payload : {}),
        },
      );
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (action === 'disconnect') {
      if (endpoint_id) {
        const { data: currentPlayer } = await supabase
          .from('players')
          .select('priority_endpoint_id')
          .eq('id', player_id)
          .single();

        const wasMaster = currentPlayer?.priority_endpoint_id === endpoint_id;

        const { error: endpointError } = await supabase
          .from('player_endpoints')
          .update({
            status: 'disconnected',
            role: 'slave',
            disconnected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('player_id', player_id)
          .eq('endpoint_id', endpoint_id);

        if (endpointError) throw endpointError;

        if (wasMaster) {
          const { error: clearError } = await supabase.rpc('clear_priority_endpoint', {
            p_player_id: player_id,
          });
          if (clearError) throw clearError;
        }
      }

      await logSystemEvent(supabase, player_id, 'player_disconnected', 'warn', {
        source: initiator || 'player_client',
        reason: reason || 'window_unload',
        endpoint_id: endpoint_id || null,
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Handle session registration for priority player mechanism
    if (action === 'register_session') {
      if (!session_id || !endpoint_id) {
        return new Response(JSON.stringify({
          error: 'session_id and endpoint_id are required for register_session'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      const now = new Date().toISOString();
      const { error: endpointUpsertError } = await supabase
        .from('player_endpoints')
        .upsert({
          endpoint_id,
          player_id,
          session_id,
          role: 'slave',
          status: 'connected',
          origin: typeof origin === 'string' ? origin : null,
          user_agent: typeof user_agent === 'string' ? user_agent : null,
          last_seen: now,
          connected_at: now,
          disconnected_at: null,
          updated_at: now,
        }, {
          onConflict: 'endpoint_id',
        });

      if (endpointUpsertError) throw endpointUpsertError;

      const { data: existingPriority } = await supabase
        .from('players')
        .select('priority_player_id, priority_endpoint_id')
        .eq('id', player_id)
        .single();

      if (existingPriority?.priority_endpoint_id) {
        const { data: currentMasterEndpoint } = await supabase
          .from('player_endpoints')
          .select('status, last_seen')
          .eq('player_id', player_id)
          .eq('endpoint_id', existingPriority.priority_endpoint_id)
          .maybeSingle();

        const masterIsStale = !currentMasterEndpoint
          || currentMasterEndpoint.status !== 'connected'
          || !currentMasterEndpoint.last_seen
          || new Date(currentMasterEndpoint.last_seen).getTime() < Date.now() - 45000;

        if (masterIsStale) {
          const { error: clearError } = await supabase.rpc('clear_priority_endpoint', {
            p_player_id: player_id,
          });
          if (clearError) throw clearError;
          existingPriority.priority_endpoint_id = null;
          existingPriority.priority_player_id = null;
        }
      }

      const shouldRestorePriority = stored_endpoint_id === endpoint_id
        || stored_player_id === player_id;

      if (existingPriority?.priority_endpoint_id === endpoint_id || (shouldRestorePriority && !existingPriority?.priority_endpoint_id)) {
        const { error: assignError } = await supabase.rpc('assign_priority_endpoint', {
          p_player_id: player_id,
          p_endpoint_id: endpoint_id,
        });
        if (assignError) throw assignError;
        await logSystemEvent(supabase, player_id, 'priority_player_assigned', 'info', {
          session_id,
          endpoint_id,
          role: 'priority',
          restored: true,
          source: 'register_session',
        });

        console.log(`[player-control] Endpoint ${endpoint_id} restored as priority player (session: ${session_id})`);
        return new Response(JSON.stringify({
          success: true,
          is_priority: true,
          restored: true
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      if (!existingPriority?.priority_endpoint_id) {
        // No priority player yet - check if any players are currently playing
        const { data: playingPlayers } = await supabase
          .from('player_status')
          .select('id')
          .eq('state', 'playing');

        if (!playingPlayers || playingPlayers.length === 0) {
          // No players are currently playing - make this one priority
          const { error: assignError } = await supabase.rpc('assign_priority_endpoint', {
            p_player_id: player_id,
            p_endpoint_id: endpoint_id,
          });
          if (assignError) throw assignError;
          await logSystemEvent(supabase, player_id, 'priority_player_assigned', 'info', {
            session_id,
            endpoint_id,
            role: 'priority',
            restored: false,
            source: 'register_session',
          });

          console.log(`[player-control] Player ${player_id} registered as priority player (no players playing, session: ${session_id})`);
          return new Response(JSON.stringify({
            success: true,
            is_priority: true
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        } else {
          // Players are playing - this becomes a slave
          await supabase
            .from('player_endpoints')
            .update({ role: 'slave', updated_at: now })
            .eq('player_id', player_id)
            .eq('endpoint_id', endpoint_id);
          await logSystemEvent(supabase, player_id, 'priority_player_waiting_assignment', 'info', {
            session_id,
            endpoint_id,
            role: 'slave',
            source: 'register_session',
            reason: 'other_players_playing',
          });
          console.log(`[player-control] Player ${player_id} registered as slave player (other players playing, session: ${session_id})`);
          return new Response(JSON.stringify({
            success: true,
            is_priority: false
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      } else {
        await supabase
          .from('player_endpoints')
          .update({ role: 'slave', updated_at: now })
          .eq('player_id', player_id)
          .eq('endpoint_id', endpoint_id);
        await logSystemEvent(supabase, player_id, 'player_connected', 'info', {
          session_id,
          endpoint_id,
          role: 'slave',
          source: 'register_session',
          reason: 'priority_exists',
        });
        console.log(`[player-control] Player ${player_id} registered as slave player (priority exists, session: ${session_id})`);
        return new Response(JSON.stringify({
          success: true,
          is_priority: false
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Handle reset priority player
    if (action === 'reset_priority') {
      const { error: resetError } = await supabase.rpc('clear_priority_endpoint', {
        p_player_id: player_id,
      });
      if (resetError) throw resetError;
      await logSystemEvent(supabase, player_id, 'priority_player_reset', 'warn', {
        source: initiator || 'admin_ui',
      });

      console.log(`[player-control] Priority player reset for player ${player_id}`);
      return new Response(JSON.stringify({
        success: true,
        message: 'Priority player reset'
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (action === 'identify_endpoint') {
      if (!target_endpoint_id) {
        return new Response(JSON.stringify({
          error: 'target_endpoint_id is required for identify_endpoint'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      const identifyUntil = new Date(Date.now() + 12000).toISOString();
      const { data: updatedEndpoint, error: identifyError } = await supabase
        .from('player_endpoints')
        .update({
          identify_until: identifyUntil,
          updated_at: new Date().toISOString(),
        })
        .eq('player_id', player_id)
        .eq('endpoint_id', target_endpoint_id)
        .eq('status', 'connected')
        .select('endpoint_id')
        .maybeSingle();

      if (identifyError) throw identifyError;
      if (!updatedEndpoint) {
        return new Response(JSON.stringify({
          success: false,
          reason: 'endpoint_not_connected'
        }), {
          status: 409,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      await logSystemEvent(supabase, player_id, 'player_identify_requested', 'info', {
        source: initiator || 'admin_ui',
        endpoint_id: target_endpoint_id,
      });

      return new Response(JSON.stringify({
        success: true,
        endpoint_id: target_endpoint_id,
        identify_until: identifyUntil,
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (action === 'set_master_endpoint') {
      if (!target_endpoint_id) {
        return new Response(JSON.stringify({
          error: 'target_endpoint_id is required for set_master_endpoint'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      const { error: assignError } = await supabase.rpc('assign_priority_endpoint', {
        p_player_id: player_id,
        p_endpoint_id: target_endpoint_id,
      });
      if (assignError) throw assignError;

      await logSystemEvent(supabase, player_id, 'priority_player_assigned', 'info', {
        source: initiator || 'admin_ui',
        endpoint_id: target_endpoint_id,
        role: 'priority',
        restored: false,
      });

      return new Response(JSON.stringify({
        success: true,
        endpoint_id: target_endpoint_id,
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Handle status update
    if (action === 'update' || action === 'ended' || action === 'skip') {
      // For skip: capture current player state BEFORE updating, so we can decide
      // whether the player needs to fade out or whether it's already idle.
      let preUpdateState: string | null = null;
      if (action === 'skip') {
        const { data: currentStatus } = await supabase
          .from('player_status')
          .select('state')
          .eq('player_id', player_id)
          .single();
        preUpdateState = currentStatus?.state ?? null;
      }

      const updateData: Record<string, unknown> = {
        last_updated: new Date().toISOString()
      };
      // For 'ended', skip writing state to player_status.  Writing state='idle' here
      // fires a Realtime event that the player's status subscription misinterprets as
      // an admin skip (playing→idle), triggering a second queue_next call.
      // queue_next will set state='loading' atomically, so no intermediate write needed.
      if (action !== 'ended' && state !== undefined) {
        updateData.state = state;
      }
      if (progress !== undefined) {
        updateData.progress = Math.min(1, Math.max(0, progress));
      }
      const { error: updateError } = await supabase.from('player_status').update(updateData).eq('player_id', player_id);
      if (updateError) throw updateError;
      if (initiator === 'admin_ui') {
        if (action === 'skip') {
          await logSystemEvent(supabase, player_id, 'admin_skip', 'warn', {
            source: 'admin_ui',
            state,
            reason: reason || null,
            pre_update_state: preUpdateState,
          });
        } else if (action === 'update' && (state === 'playing' || state === 'paused')) {
          await logSystemEvent(supabase, player_id, state === 'playing' ? 'admin_play' : 'admin_pause', 'info', {
            source: 'admin_ui',
            state,
            reason: reason || null,
          });
        }
      }
      // If action is 'skip' from Admin, check if player was already idle.
      // If idle: call queue_next directly (no fade needed, nothing is playing).
      // If playing/paused: let the Player handle the fade and then call queue_next.
      if (action === 'skip' && state === 'idle') {
        const callerIsMaster = initiator === 'admin_ui'
          ? true
          : await isMasterEndpoint(supabase, player_id, endpoint_id);

        if (!callerIsMaster) {
          console.log(`[player-control] Ignoring skip from non-priority player ${player_id}`);
          return new Response(JSON.stringify({
            success: false,
            reason: 'not_priority_player'
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }

        if (preUpdateState === 'idle') {
          // Player was already idle — no video playing, skip the fade and advance queue now.
          console.log('[player-control] Skip while idle - calling queue_next directly (no fade needed)');
          const { data: idleStatus } = await supabase
            .from('player_status')
            .select('current_media_id')
            .eq('player_id', player_id)
            .single();
          const { data: nextItem, error: nextError } = await supabase.rpc('queue_next', {
            p_player_id: player_id,
            p_expected_media_id: typeof expected_media_id === 'string' ? expected_media_id : idleStatus?.current_media_id ?? null,
          });
          if (nextError) {
            console.error('[player-control] ❌ Failed to get next item on idle-skip:', nextError);
          } else {
            console.log('[player-control] 🎵 Idle-skip queue_next returned:', nextItem?.[0]?.title?.slice(0, 30) || 'none');
          }
          return new Response(JSON.stringify({
            success: true,
            next_item: nextItem?.[0] || null,
            action: 'skip_idle'
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }

        console.log('[player-control] Skip action from Admin - state updated, Player will handle fade');
        return new Response(JSON.stringify({
          success: true,
          skip_pending: true
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // If song ended naturally (from Player), trigger queue_next
      if (action === 'ended' || state === 'idle') {
        const { data: currentStatus } = await supabase
          .from('player_status')
          .select('state, current_media_id')
          .eq('player_id', player_id)
          .single();

        if (action === 'ended' && typeof expected_media_id === 'string' && currentStatus?.current_media_id !== expected_media_id) {
          console.log('[player-control] Ignoring duplicate ended for already-advanced media', {
            expected_media_id,
            actual_media_id: currentStatus?.current_media_id ?? null,
            state: currentStatus?.state ?? null,
          });
          return new Response(JSON.stringify({
            success: true,
            skipped: true,
            reason: 'already_advanced'
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }

        const callerIsMaster = initiator === 'admin_ui'
          ? true
          : await isMasterEndpoint(supabase, player_id, endpoint_id);

        if (!callerIsMaster) {
          console.log(`[player-control] Ignoring ${action} from non-priority player ${player_id}`);
          return new Response(JSON.stringify({
            success: false,
            reason: 'not_priority_player'
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }

        console.log('[player-control] Song ended, calling queue_next for priority player:', player_id);
        const { data: endedStatus } = await supabase
          .from('player_status')
          .select('current_media_id')
          .eq('player_id', player_id)
          .single();
        const { data: nextItem, error: nextError } = await supabase.rpc('queue_next', {
          p_player_id: player_id,
          p_expected_media_id: typeof expected_media_id === 'string' ? expected_media_id : endedStatus?.current_media_id ?? null,
        });
        if (nextError) {
          console.error('[player-control] ❌ Failed to get next item:', nextError);
        } else {
          console.log('[player-control] 🎵 Queue_next returned:', {
            next_item: nextItem,
            media_id: nextItem?.[0]?.id?.slice(0, 8) || 'none',
            title: nextItem?.[0]?.title?.slice(0, 30) || 'none',
            url: nextItem?.[0]?.url?.slice(0, 50) || 'none'
          });
          
          // Also check what's in the queue now
          const { data: currentQueue } = await supabase
            .from('queue')
            .select('id, media_item_id, type, position, played_at, media_items!inner(*)')
            .eq('player_id', player_id)
            .is('played_at', null)
            .order('type', { ascending: false })
            .order('position', { ascending: true });
            
          console.log('[player-control] 📋 Current queue after queue_next:', {
            total_items: currentQueue?.length || 0,
            items: currentQueue?.map(item => ({
              id: item.id.slice(0, 8),
              media_id: item.media_item_id?.slice(0, 8),
              type: item.type,
              position: item.position,
              title: item.media_items?.title?.slice(0, 30) || 'none',
              played_at: item.played_at
            }))
          });
        }
        return new Response(JSON.stringify({
          success: true,
          next_item: nextItem?.[0] || null,
          action
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
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
    return new Response(JSON.stringify({
      error: 'Invalid action'
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Player control error:', error);
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
