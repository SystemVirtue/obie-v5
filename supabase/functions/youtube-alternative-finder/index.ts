import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function extractYouTubeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/([A-Za-z0-9_-]{11})$/) || String(value).match(/[?&]v=([A-Za-z0-9_-]{11})/) || String(value).match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return match?.[1] || null;
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
    let sourceMedia = null;

    if (body.media_item_id) {
      const { data, error } = await supabase
        .from('media_items')
        .select('*')
        .eq('id', body.media_item_id)
        .maybeSingle();
      if (error) throw error;
      sourceMedia = data;
    }

    const sourceYoutubeId = String(body.youtube_id || extractYouTubeId(sourceMedia?.source_id) || '').trim();
    const title = String(body.title || sourceMedia?.title || '').trim();
    const artist = String(body.artist || sourceMedia?.artist || '').trim();
    const duration = Number(body.duration || sourceMedia?.duration || 0);

    if (!sourceYoutubeId && !title) {
      return new Response(JSON.stringify({ error: 'media_item_id, youtube_id, or title is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const scraperResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-scraper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        type: 'alternatives',
        query: body.query,
        title,
        artist,
        duration,
        youtube_id: sourceYoutubeId,
        max_results: body.max_results || 5,
      }),
    });

    if (!scraperResp.ok) {
      throw new Error(`youtube-scraper alternatives failed: ${scraperResp.status} ${await scraperResp.text()}`);
    }

    const payload = await scraperResp.json();
    const candidates = payload.videos || [];

    for (const candidate of candidates) {
      if (!sourceYoutubeId || !candidate?.id) continue;
      await supabase
        .from('youtube_alternative_candidates')
        .upsert({
          source_media_item_id: sourceMedia?.id || null,
          source_youtube_id: sourceYoutubeId,
          candidate_youtube_id: candidate.id,
          candidate_title: candidate.title || 'Unknown title',
          candidate_artist: candidate.artist || null,
          candidate_url: candidate.url,
          candidate_duration: candidate.duration || null,
          candidate_thumbnail: candidate.thumbnail || null,
          score: candidate.alternativeScore || 0,
          playability_status: candidate.playabilityStatus || 'unknown',
          playability_reason: candidate.playabilityReason || null,
          details: candidate,
        }, {
          onConflict: 'source_youtube_id,candidate_youtube_id',
        });
    }

    return new Response(JSON.stringify({
      source: {
        media_item_id: sourceMedia?.id || null,
        youtube_id: sourceYoutubeId || null,
        title,
        artist,
        duration,
      },
      candidates,
      count: candidates.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('youtube-alternative-finder error:', error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
