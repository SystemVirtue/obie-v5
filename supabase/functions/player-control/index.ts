// Player Control Edge Function
// Handles player status updates and heartbeat
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const nonMasterStatusLogThrottle = new Map<string, number>();

async function logSystemEvent(supabase: any, playerId: string, event: string, severity = 'info', payload: Record<string, unknown> = {}) {
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

function isTransientDatabaseError(error: any) {
  const message = `${error?.message ?? ''} ${error?.code ?? ''}`.toLowerCase();
  return message.includes('timeout')
    || message.includes('temporarily')
    || message.includes('connection')
    || message.includes('unavailable')
    || error?.code === '57014'
    || error?.code === '53300'
    || error?.code === '08006';
}

async function findCloudflareFallback(supabase: any, youtubeId?: string | null) {
  if (!youtubeId) return null;
  const { data, error } = await supabase
    .from('r2_files')
    .select('id, public_url, object_key')
    .eq('youtube_id', youtubeId)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[player-control] R2 fallback lookup failed:', error.message || error);
    return null;
  }
  return data || null;
}

async function upsertPlaybackOverride(supabase: any, mediaItemId: string, values: Record<string, unknown>) {
  const { error } = await supabase
    .from('media_playback_overrides')
    .upsert({
      media_item_id: mediaItemId,
      ...values,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'media_item_id' });
  if (error) {
    console.warn('[player-control] Failed to upsert playback override:', error.message || error);
  }
}

async function isMasterEndpoint(supabase: any, playerId: string, endpointId?: string | null, sessionId?: string | null) {
  const { data: player } = await supabase
    .from('players')
    .select('priority_player_id, priority_endpoint_id')
    .eq('id', playerId)
    .single();

  if (!endpointId) {
    // Transitional compatibility for already-open player screens that still use
    // the pre-endpoint priority model. Once the page refreshes, endpoint_id will
    // be present and the stricter endpoint ownership check below applies.
    return player?.priority_player_id === playerId && !player?.priority_endpoint_id;
  }

  if (player?.priority_endpoint_id !== endpointId) return false;

  const { data: endpoint } = await supabase
    .from('player_endpoints')
    .select('session_id, status, last_seen')
    .eq('player_id', playerId)
    .eq('endpoint_id', endpointId)
    .maybeSingle();

  if (!endpoint || endpoint.status !== 'connected') return false;
  if (sessionId && endpoint.session_id && endpoint.session_id !== sessionId) {
    return false;
  }

  return true;
}

function shouldLogNonMasterStatus(playerId: string, action: string, endpointId?: string | null): boolean {
  if (endpointId || action !== 'update') return true;

  const throttleKey = `${playerId}:missing-endpoint:update`;
  const now = Date.now();
  const lastLoggedAt = nonMasterStatusLogThrottle.get(throttleKey) ?? 0;
  if (now - lastLoggedAt < 60_000) {
    return false;
  }

  nonMasterStatusLogThrottle.set(throttleKey, now);
  return true;
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
      const { data, error } = endpoint_id && session_id
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
        success: data?.success !== false,
        ignored: data?.ignored || false,
        reason: data?.reason || null,
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
          endpoint_id: endpoint_id || null,
          session_id: session_id || null,
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
        const { data: currentEndpoint } = await supabase
          .from('player_endpoints')
          .select('session_id, role')
          .eq('player_id', player_id)
          .eq('endpoint_id', endpoint_id)
          .maybeSingle();

        if (session_id && currentEndpoint?.session_id && currentEndpoint.session_id !== session_id) {
          await logSystemEvent(supabase, player_id, 'stale_disconnect_ignored', 'warn', {
            source: initiator || 'player_client',
            endpoint_id,
            session_id,
            current_session_id: currentEndpoint.session_id,
          });
          return new Response(JSON.stringify({ success: true, ignored: true, reason: 'stale_session' }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }

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
        && stored_player_id === player_id;

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
      const { data: currentPlayer } = await supabase
        .from('players')
        .select('priority_player_id, priority_endpoint_id')
        .eq('id', player_id)
        .single();

      if (!currentPlayer?.priority_player_id && !currentPlayer?.priority_endpoint_id) {
        return new Response(JSON.stringify({
          success: true,
          ignored: true,
          reason: 'priority_already_clear'
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      const { error: resetError } = await supabase.rpc('clear_priority_endpoint', {
        p_player_id: player_id,
      });
      if (resetError) throw resetError;
      await logSystemEvent(supabase, player_id, 'priority_player_reset', 'warn', {
        source: initiator || 'admin_ui',
        previous_priority_player_id: currentPlayer?.priority_player_id || null,
        previous_priority_endpoint_id: currentPlayer?.priority_endpoint_id || null,
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

    if (action === 'playback_failed') {
      const callerIsMaster = initiator === 'admin_ui'
        ? true
        : await isMasterEndpoint(supabase, player_id, endpoint_id, session_id);

      await logSystemEvent(supabase, player_id, typeof event_name === 'string' && event_name ? event_name : 'playback_failed', 'error', {
        source: initiator || 'player_client',
        reason: reason || 'playback_failed',
        endpoint_id: endpoint_id || null,
        session_id: session_id || null,
        ...(payload && typeof payload === 'object' ? payload : {}),
        ignored: !callerIsMaster,
      });

      if (!callerIsMaster) {
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

      const updateData: Record<string, unknown> = {
        playback_error: reason || 'playback_failed',
        playback_error_code: payload && typeof payload === 'object' && 'error_code' in payload ? String(payload.error_code) : null,
        playback_error_at: new Date().toISOString(),
        last_recovery_reason: reason || 'playback_failed',
        last_updated: new Date().toISOString(),
      };

      const { error: failureUpdateError } = await supabase
        .from('player_status')
        .update(updateData)
        .eq('player_id', player_id);
      if (failureUpdateError) throw failureUpdateError;

      const failurePayload = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const mediaItemId = typeof failurePayload.media_item_id === 'string' ? failurePayload.media_item_id : null;
      const youtubeId = typeof failurePayload.youtube_id === 'string' ? failurePayload.youtube_id : null;
      const errorCode = 'error_code' in failurePayload ? String(failurePayload.error_code) : null;
      const playabilityStatus =
        reason === 'youtube_embed_blocked' ? 'embed_blocked'
        : reason === 'youtube_video_unavailable' ? 'unavailable'
        : reason === 'youtube_invalid_parameter_or_restricted' ? 'restricted'
        : reason === 'youtube_html5_playback_error' ? 'check_failed'
        : String(reason || '').startsWith('youtube_') ? 'check_failed'
        : null;

      if (playabilityStatus && (mediaItemId || youtubeId)) {
        const { error: playabilityError } = await supabase.rpc('record_youtube_playability', {
          p_media_item_id: mediaItemId,
          p_youtube_id: youtubeId,
          p_status: playabilityStatus,
          p_reason: reason || 'playback_failed',
          p_checked_by: 'player_runtime',
          p_embeddable: playabilityStatus === 'embed_blocked' ? false : null,
          p_oembed_ok: null,
          p_error_code: errorCode,
          p_details: failurePayload,
        });

        if (playabilityError) {
          await logSystemEvent(supabase, player_id, 'youtube_playability_record_failed', 'warn', {
            media_item_id: mediaItemId,
            youtube_id: youtubeId,
            playability_status: playabilityStatus,
            error: playabilityError.message || playabilityError,
          });
        }

        if (mediaItemId && ['embed_blocked', 'restricted', 'unavailable', 'invalid', 'check_failed'].includes(playabilityStatus)) {
          const r2Fallback = await findCloudflareFallback(supabase, youtubeId);
          if (r2Fallback?.public_url) {
            await upsertPlaybackOverride(supabase, mediaItemId, {
              override_type: 'cloudflare',
              playback_url: r2Fallback.public_url,
              r2_file_id: r2Fallback.id,
              confidence: 100,
              reason: `${playabilityStatus}_runtime_r2_fallback`,
              details: {
                youtube_id: youtubeId,
                object_key: r2Fallback.object_key,
                error_code: errorCode,
              },
            });
          } else {
            await supabase
              .from('media_items')
              .update({
                excluded_from_playback: true,
                excluded_reason: `${playabilityStatus}_runtime_failure`,
                excluded_at: new Date().toISOString(),
              })
              .eq('id', mediaItemId);

            await upsertPlaybackOverride(supabase, mediaItemId, {
              override_type: 'excluded',
              confidence: 100,
              reason: `${playabilityStatus}_runtime_failure`,
              details: {
                youtube_id: youtubeId,
                error_code: errorCode,
              },
            });
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Handle status update
    if (action === 'update' || action === 'ended' || action === 'skip') {
      const callerIsMaster = initiator === 'admin_ui'
        ? true
        : await isMasterEndpoint(supabase, player_id, endpoint_id, session_id);

      if (!callerIsMaster) {
        if (action === 'update' && state === 'playing' && typeof expected_media_id === 'string') {
          const { data: currentStatusForConfirmation } = await supabase
            .from('player_status')
            .select('state, current_media_id, playback_started_at')
            .eq('player_id', player_id)
            .single();

          if (
            currentStatusForConfirmation?.state === 'loading'
            && currentStatusForConfirmation?.current_media_id === expected_media_id
          ) {
            const playbackStartedAt = currentStatusForConfirmation.playback_started_at || new Date().toISOString();
            const { error: confirmError } = await supabase
              .from('player_status')
              .update({
                state: 'playing',
                progress: progress !== undefined ? Math.min(1, Math.max(0, progress)) : 0,
                playback_started_at: playbackStartedAt,
                playback_error: null,
                playback_error_code: null,
                playback_error_at: null,
                last_recovery_reason: null,
                last_updated: new Date().toISOString(),
              })
              .eq('player_id', player_id)
              .eq('current_media_id', expected_media_id);
            if (confirmError) throw confirmError;

            await logSystemEvent(supabase, player_id, 'playback_started_confirmed_by_non_master', 'info', {
              source: initiator || 'player_client',
              endpoint_id: endpoint_id || null,
              session_id: session_id || null,
              media_item_id: expected_media_id,
            });

            return new Response(JSON.stringify({
              success: true,
              confirmed_by_non_master: true
            }), {
              status: 200,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
        }

        const shouldLog = shouldLogNonMasterStatus(player_id, action, endpoint_id);
        const logPayload = {
          player_id,
          endpoint_id: endpoint_id || null,
          session_id: session_id || null,
          state: state || null,
        };
        if (shouldLog) {
          console.log(`[player-control] Ignoring ${action} update from non-priority endpoint`, logPayload);
          await logSystemEvent(supabase, player_id, 'non_master_status_ignored', 'warn', {
            source: initiator || 'player_client',
            action,
            state: state || null,
            endpoint_id: endpoint_id || null,
            session_id: session_id || null,
            throttled: !endpoint_id && action === 'update',
          });
        } else {
          console.debug(`[player-control] Non-master ${action} update suppressed by throttle`, logPayload);
        }
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

      const { data: currentStatusForUpdate } = await supabase
        .from('player_status')
        .select('state, current_media_id, source, playback_started_at')
        .eq('player_id', player_id)
        .single();

      // For skip: capture current player state BEFORE updating, so we can decide
      // whether the player needs to fade out or whether it's already idle.
      let preUpdateState: string | null = null;
      if (action === 'skip') {
        preUpdateState = currentStatusForUpdate?.state ?? null;
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
      if (state === 'playing') {
        updateData.playback_started_at = currentStatusForUpdate?.playback_started_at || new Date().toISOString();
        updateData.playback_error = null;
        updateData.playback_error_code = null;
        updateData.playback_error_at = null;
        updateData.last_recovery_reason = null;
      }
      if (action === 'skip' && initiator === 'admin_ui') {
        updateData.last_recovery_reason = 'admin_skip';
      }
      const { error: updateError } = await supabase.from('player_status').update(updateData).eq('player_id', player_id);
      if (updateError) throw updateError;
      if (state === 'playing' && !currentStatusForUpdate?.playback_started_at) {
        await logSystemEvent(supabase, player_id, 'playback_started_confirmed', 'info', {
          source: initiator || 'player_client',
          endpoint_id: endpoint_id || null,
          session_id: session_id || null,
          media_item_id: currentStatusForUpdate?.current_media_id || null,
          playback_source: currentStatusForUpdate?.source || null,
        });
      }
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
      // If action is 'skip' from Admin, advance the queue immediately. The player
      // endpoint is responsible for stopping/fading its current media, but queue
      // ownership must live server-side so a YouTube pause/retry event cannot
      // restart the skipped iframe and strand Admin/Player on different tracks.
      if (action === 'skip' && state === 'idle') {
        if (preUpdateState === 'playing' || preUpdateState === 'paused') {
          console.log('[player-control] Admin skip - waiting for player fade before queue_next', {
            player_id,
            pre_update_state: preUpdateState,
          });
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        console.log('[player-control] Admin skip - calling queue_next directly', {
          player_id,
          pre_update_state: preUpdateState,
          expected_media_id: typeof expected_media_id === 'string' ? expected_media_id : null,
        });
        const { data: skipStatus } = await supabase
          .from('player_status')
          .select('current_media_id')
          .eq('player_id', player_id)
          .single();
        const { data: nextItem, error: nextError } = await supabase.rpc('queue_next', {
          p_player_id: player_id,
          p_expected_media_id: typeof expected_media_id === 'string' ? expected_media_id : skipStatus?.current_media_id ?? null,
        });
        if (nextError) {
          console.error('[player-control] ❌ Failed to get next item on admin skip:', nextError);
          throw nextError;
        } else {
          console.log('[player-control] 🎵 Admin skip queue_next returned:', nextItem?.[0]?.title?.slice(0, 30) || 'none');
        }
        return new Response(JSON.stringify({
          success: true,
          next_item: nextItem?.[0] || null,
          action: 'skip'
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
          throw nextError;
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
              title: (Array.isArray(item.media_items) ? item.media_items[0] : item.media_items)?.title?.slice(0, 30) || 'none',
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Player control error:', error);
    const status = isTransientDatabaseError(error) ? 503 : 500;
    return new Response(JSON.stringify({
      error: errorMessage
    }), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
