import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const DEFAULT_STATUSES = ['embed_blocked', 'restricted', 'unavailable', 'invalid', 'check_failed'];
const AUTO_REPLACEMENT_MIN_SCORE = 82;

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

async function findCloudflareFallback(supabase: any, youtubeId: string | null): Promise<any | null> {
  if (!youtubeId) return null;
  const { data, error } = await supabase
    .from('r2_files')
    .select('id, public_url, object_key')
    .eq('youtube_id', youtubeId)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[youtube-remediation-worker] R2 lookup failed:', error.message || error);
    return null;
  }
  return data || null;
}

async function upsertPlaybackOverride(supabase: any, mediaItemId: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('media_playback_overrides')
    .upsert({
      media_item_id: mediaItemId,
      ...values,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'media_item_id' });
  if (error) throw error;
}

async function markExcluded(supabase: any, media: any, reason: string, details: Record<string, unknown>): Promise<void> {
  await supabase
    .from('media_items')
    .update({
      excluded_from_playback: true,
      excluded_reason: reason,
      excluded_at: new Date().toISOString(),
    })
    .eq('id', media.id);

  await upsertPlaybackOverride(supabase, media.id, {
    override_type: 'excluded',
    confidence: 100,
    reason,
    details,
  });

  await supabase
    .from('queue')
    .delete()
    .eq('media_item_id', media.id)
    .is('played_at', null);
}

async function createReplacementMedia(supabase: any, candidate: any): Promise<string | null> {
  const { data: mediaId, error } = await supabase.rpc('create_or_get_media_item', {
    p_source_id: `youtube:${candidate.id}`,
    p_source_type: 'youtube',
    p_title: candidate.title,
    p_artist: candidate.artist || null,
    p_url: candidate.url,
    p_duration: candidate.duration || null,
    p_thumbnail: candidate.thumbnail || null,
    p_metadata: {
      youtube_playability_status: candidate.playabilityStatus || 'playable',
      youtube_playability_reason: candidate.playabilityReason || null,
      youtube_embeddable: typeof candidate.embeddable === 'boolean' ? candidate.embeddable : null,
      youtube_oembed_ok: typeof candidate.oembedOk === 'boolean' ? candidate.oembedOk : null,
      replacement_candidate: true,
    },
  });
  if (error) throw error;

  await supabase.rpc('record_youtube_playability', {
    p_media_item_id: mediaId,
    p_youtube_id: candidate.id,
    p_status: candidate.playabilityStatus || 'playable',
    p_reason: candidate.playabilityReason || 'youtube_replacement_candidate',
    p_checked_by: 'youtube_remediation_worker',
    p_embeddable: typeof candidate.embeddable === 'boolean' ? candidate.embeddable : null,
    p_oembed_ok: typeof candidate.oembedOk === 'boolean' ? candidate.oembedOk : null,
    p_error_code: null,
    p_details: candidate,
  });

  return mediaId || null;
}

async function resolveMedia(supabase: any, media: any, maxResults: number) {
  const youtubeId = extractYouTubeId(media.source_id);
  const r2 = await findCloudflareFallback(supabase, youtubeId);
  if (r2?.public_url) {
    await upsertPlaybackOverride(supabase, media.id, {
      override_type: 'cloudflare',
      playback_url: r2.public_url,
      r2_file_id: r2.id,
      confidence: 100,
      reason: `youtube_${media.youtube_playability_status}_r2_fallback`,
      details: { youtube_id: youtubeId, object_key: r2.object_key },
    });
    await supabase
      .from('media_items')
      .update({
        excluded_from_playback: false,
        excluded_reason: null,
        excluded_at: null,
      })
      .eq('id', media.id);
    return { action: 'r2_override', youtube_id: youtubeId, r2_file_id: r2.id };
  }

  const result = await callFunction('youtube-alternative-finder', {
    media_item_id: media.id,
    youtube_id: youtubeId,
    title: media.title,
    artist: media.artist,
    duration: media.duration,
    max_results: maxResults,
  });

  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const best = candidates.find((candidate: any) =>
    candidate?.playabilityStatus === 'playable' &&
    Number(candidate?.alternativeScore || 0) >= AUTO_REPLACEMENT_MIN_SCORE
  );

  if (best) {
    const replacementMediaId = await createReplacementMedia(supabase, best);
    if (replacementMediaId) {
      await supabase
        .from('media_items')
        .update({
          replacement_media_item_id: replacementMediaId,
          excluded_from_playback: false,
          excluded_reason: null,
          excluded_at: null,
        })
        .eq('id', media.id);

      await upsertPlaybackOverride(supabase, media.id, {
        override_type: 'replacement',
        replacement_media_item_id: replacementMediaId,
        confidence: best.alternativeScore || 0,
        reason: `youtube_${media.youtube_playability_status}_auto_replacement`,
        details: {
          youtube_id: youtubeId,
          replacement_youtube_id: best.id,
          title: best.title,
        },
      });

      return {
        action: 'replacement',
        youtube_id: youtubeId,
        replacement_media_item_id: replacementMediaId,
        replacement_youtube_id: best.id,
        score: best.alternativeScore || 0,
      };
    }
  }

  await markExcluded(supabase, media, `youtube_${media.youtube_playability_status}_no_route`, {
    youtube_id: youtubeId,
    playability_status: media.youtube_playability_status,
    playability_reason: media.youtube_playability_reason,
  });

  return { action: 'excluded', youtube_id: youtubeId };
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
        const resolution = await resolveMedia(supabase, media, maxResults);
        results.push({
          ...resolution,
          media_item_id: media.id,
          youtube_id: resolution.youtube_id || youtubeId,
          title: media.title,
          status: media.youtube_playability_status,
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
      if (item.action === 'r2_override') acc.r2 += 1;
      if (item.action === 'replacement') acc.replacements += 1;
      if (item.action === 'excluded') acc.excluded += 1;
      if (item.error) acc.errors += 1;
      return acc;
    }, { processed: 0, r2: 0, replacements: 0, excluded: 0, errors: 0 });

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
