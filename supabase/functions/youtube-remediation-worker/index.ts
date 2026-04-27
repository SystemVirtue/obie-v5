import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const DEFAULT_STATUSES = ['embed_blocked', 'restricted', 'unavailable', 'invalid', 'check_failed'];

function extractYouTubeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/([A-Za-z0-9_-]{11})$/) || text.match(/[?&]v=([A-Za-z0-9_-]{11})/) || text.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return match?.[1] || null;
}

async function callFunction(name: string, body: Record<string, unknown>) {
  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${baseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${payload.error || text}`);
  }
  return payload;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit || 25), 100));
    const maxResults = Math.max(1, Math.min(Number(body.max_results || 5), 10));
    const auditFirst = body.audit_first !== false;
    const statuses = Array.isArray(body.statuses) && body.statuses.length > 0
      ? body.statuses.map(String)
      : DEFAULT_STATUSES;

    let audit = null;
    if (auditFirst) {
      audit = await callFunction('youtube-playability-audit', {
        limit: Math.max(limit, Number(body.audit_limit || limit)),
        stale_hours: Math.max(1, Number(body.stale_hours || 24)),
        checked_by: body.checked_by || 'youtube_remediation_worker',
      });
    }

    const { data: mediaItems, error } = await supabase
      .from('media_items')
      .select('id, source_id, source_type, title, artist, duration, youtube_playability_status, youtube_playability_reason, youtube_playability_checked_at, youtube_last_error_at')
      .eq('source_type', 'youtube')
      .in('youtube_playability_status', statuses)
      .order('youtube_last_error_at', { ascending: false, nullsFirst: false })
      .order('youtube_playability_checked_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw error;

    const results = [];
    for (const media of mediaItems || []) {
      const youtubeId = extractYouTubeId(media.source_id);
      try {
        const result = await callFunction('youtube-alternative-finder', {
          media_item_id: media.id,
          youtube_id: youtubeId,
          title: media.title,
          artist: media.artist,
          duration: media.duration,
          max_results: maxResults,
        });
        results.push({
          media_item_id: media.id,
          youtube_id: youtubeId,
          title: media.title,
          status: media.youtube_playability_status,
          candidate_count: result.count || 0,
          playable_count: (result.candidates || []).filter((candidate: any) => candidate.playabilityStatus === 'playable').length,
        });
      } catch (candidateError) {
        results.push({
          media_item_id: media.id,
          youtube_id: youtubeId,
          title: media.title,
          status: media.youtube_playability_status,
          error: candidateError instanceof Error ? candidateError.message : String(candidateError),
        });
      }
    }

    const summary = results.reduce((acc, item: any) => {
      acc.processed += 1;
      acc.candidates += Number(item.candidate_count || 0);
      acc.playable += Number(item.playable_count || 0);
      if (item.error) acc.errors += 1;
      return acc;
    }, { processed: 0, candidates: 0, playable: 0, errors: 0 });

    return new Response(JSON.stringify({
      audit,
      selected_count: mediaItems?.length || 0,
      summary,
      results,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('youtube-remediation-worker error:', error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
