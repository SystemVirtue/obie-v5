import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type CheckStatus = 'ok' | 'warn' | 'error';

type HealthCheck = {
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const OPTIONAL_ENV = [
  'YOUTUBE_API_KEY',
  'YOUTUBE_API_KEYS',
  'CLOUDFLARE_R2_PUBLIC_URL',
  'CLOUDFLARE_R2_ENDPOINT',
];

const PLAYER_ID = '00000000-0000-0000-0000-000000000001';

function addCheck(checks: HealthCheck[], check: HealthCheck) {
  checks.push(check);
}

function overallStatus(checks: HealthCheck[]): CheckStatus {
  if (checks.some((check) => check.status === 'error')) return 'error';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'ok';
}

function redactUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  return userAgent.slice(0, 120);
}

async function maybeFetchJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${response.status} ${payload.error || text}`);
  }
  return payload;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const checks: HealthCheck[] = [];

  try {
    const missingRequired = REQUIRED_ENV.filter((name) => !Deno.env.get(name));
    addCheck(checks, {
      name: 'required_environment',
      status: missingRequired.length > 0 ? 'error' : 'ok',
      message: missingRequired.length > 0 ? `Missing ${missingRequired.join(', ')}` : 'Required Supabase environment is present',
      details: {
        missing: missingRequired,
      },
    });

    const presentOptional = OPTIONAL_ENV.filter((name) => !!Deno.env.get(name));
    addCheck(checks, {
      name: 'optional_environment',
      status: presentOptional.some((name) => name.startsWith('YOUTUBE_API_KEY')) ? 'ok' : 'warn',
      message: presentOptional.some((name) => name.startsWith('YOUTUBE_API_KEY'))
        ? 'YouTube API configuration is present'
        : 'No YouTube API key environment variables detected',
      details: {
        present: presentOptional,
        missing: OPTIONAL_ENV.filter((name) => !Deno.env.get(name)),
      },
    });

    if (missingRequired.length > 0) {
      return new Response(JSON.stringify({
        checked_at: new Date().toISOString(),
        status: overallStatus(checks),
        duration_ms: Date.now() - startedAt,
        checks,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, name, status, last_heartbeat, priority_player_id, priority_endpoint_id')
      .eq('id', PLAYER_ID)
      .maybeSingle();
    addCheck(checks, {
      name: 'database_player',
      status: playerError || !player ? 'error' : 'ok',
      message: playerError ? playerError.message : player ? 'Canonical player row is readable' : 'Canonical player row is missing',
      details: player ? {
        status: player.status,
        last_heartbeat: player.last_heartbeat,
        priority_player_id: player.priority_player_id,
        priority_endpoint_id: player.priority_endpoint_id,
      } : undefined,
    });

    const { data: status, error: statusError } = await supabase
      .from('player_status')
      .select('state, current_media_id, playback_started_at, playback_error, playback_error_code, playback_error_at, last_updated')
      .eq('player_id', PLAYER_ID)
      .maybeSingle();
    addCheck(checks, {
      name: 'database_player_status',
      status: statusError || !status ? 'error' : status.playback_error ? 'warn' : 'ok',
      message: statusError ? statusError.message : status ? 'Player status is readable' : 'Player status row is missing',
      details: status || undefined,
    });

    const { data: endpoints, error: endpointError } = await supabase
      .from('player_endpoints')
      .select('endpoint_id, session_id, role, status, origin, user_agent, last_seen')
      .eq('player_id', PLAYER_ID)
      .eq('status', 'connected')
      .order('last_seen', { ascending: false })
      .limit(10);
    const activeEndpoints = ((endpoints || []) as any[]).filter((endpoint) => {
      const lastSeenMs = endpoint.last_seen ? new Date(endpoint.last_seen).getTime() : 0;
      return Date.now() - lastSeenMs <= 45_000;
    });
    const activeMaster = activeEndpoints.find((endpoint) => endpoint.role === 'master' && endpoint.endpoint_id === player?.priority_endpoint_id);
    addCheck(checks, {
      name: 'connected_player_endpoints',
      status: endpointError ? 'error' : activeMaster ? 'ok' : activeEndpoints.length > 0 ? 'warn' : 'warn',
      message: endpointError
        ? endpointError.message
        : activeMaster
          ? 'Active master endpoint is connected'
          : activeEndpoints.length > 0
            ? 'Connected endpoints exist but active master was not confirmed'
            : 'No active connected endpoint seen in the last 45 seconds',
      details: endpointError ? undefined : {
        active_count: activeEndpoints.length,
        configured_master_endpoint_id: player?.priority_endpoint_id || null,
        endpoints: activeEndpoints.map((endpoint) => ({
          endpoint_id: endpoint.endpoint_id,
          session_id: endpoint.session_id,
          role: endpoint.role,
          origin: endpoint.origin,
          user_agent: redactUserAgent(endpoint.user_agent),
          last_seen: endpoint.last_seen,
        })),
      },
    });

    const { count: youtubeOnlyCount, error: youtubeOnlyError } = await supabase
      .from('media_items')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'youtube');
    const { count: blockedCount, error: blockedError } = await supabase
      .from('media_items')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'youtube')
      .in('youtube_playability_status', ['embed_blocked', 'restricted', 'unavailable', 'invalid', 'check_failed']);
    addCheck(checks, {
      name: 'youtube_catalog_health',
      status: youtubeOnlyError || blockedError ? 'error' : (blockedCount || 0) > 0 ? 'warn' : 'ok',
      message: youtubeOnlyError?.message || blockedError?.message || `${blockedCount || 0} known risky YouTube-only items`,
      details: {
        youtube_only_count: youtubeOnlyCount || 0,
        risky_count: blockedCount || 0,
      },
    });

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentLogs, error: logsError } = await supabase
      .from('system_logs')
      .select('event, severity')
      .gte('timestamp', since)
      .in('severity', ['warn', 'error'])
      .limit(500);
    const recentErrors = ((recentLogs || []) as any[]).filter((log) => log.severity === 'error');
    addCheck(checks, {
      name: 'recent_warning_error_logs',
      status: logsError ? 'error' : recentErrors.length > 0 ? 'warn' : 'ok',
      message: logsError ? logsError.message : `${recentLogs?.length || 0} warn/error logs in the last hour`,
      details: logsError ? undefined : {
        sampled_count: recentLogs?.length || 0,
        error_count: recentErrors.length,
        top_events: (Object.entries(((recentLogs || []) as any[]).reduce((acc, log) => {
          acc[log.event] = (acc[log.event] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)) as [string, number][])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([event, count]) => ({ event, count })),
      },
    });

    try {
      const keyAudit = await maybeFetchJson(`${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-key-audit`, {});
      const results = Array.isArray(keyAudit.results) ? keyAudit.results : [];
      const valid = results.filter((result: any) => result.status === 'valid').length;
      const configured = results.filter((result: any) => result.configured && result.status !== 'duplicate').length;
      addCheck(checks, {
        name: 'youtube_api_key_audit',
        status: valid > 0 ? 'ok' : configured > 0 ? 'warn' : 'warn',
        message: valid > 0 ? `${valid} valid YouTube API key slot${valid === 1 ? '' : 's'}` : 'No valid YouTube API key slot confirmed',
        details: {
          configured_count: configured,
          valid_count: valid,
          statuses: results.reduce((acc: Record<string, number>, result: any) => {
            acc[result.status] = (acc[result.status] || 0) + 1;
            return acc;
          }, {}),
        },
      });
    } catch (error) {
      addCheck(checks, {
        name: 'youtube_api_key_audit',
        status: 'warn',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const statusCode = overallStatus(checks) === 'error' ? 503 : 200;
    return new Response(JSON.stringify({
      checked_at: new Date().toISOString(),
      status: overallStatus(checks),
      duration_ms: Date.now() - startedAt,
      checks,
    }), {
      status: statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addCheck(checks, {
      name: 'system_health_exception',
      status: 'error',
      message,
    });

    return new Response(JSON.stringify({
      checked_at: new Date().toISOString(),
      status: 'error',
      duration_ms: Date.now() - startedAt,
      checks,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
