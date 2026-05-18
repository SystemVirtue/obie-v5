import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BATCH_SIZE = 50;

function extractYouTubeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/([A-Za-z0-9_-]{11})$/) || String(value).match(/[?&]v=([A-Za-z0-9_-]{11})/) || String(value).match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return match?.[1] || null;
}

function summarize(videos: any[]): Record<string, number> {
  return videos.reduce((acc, video) => {
    const status = video.playabilityStatus || (video.embeddable === false ? 'embed_blocked' : 'unknown');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
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
    const limit = Math.max(1, Math.min(Number(body.limit || 100), 500));
    const staleHours = Math.max(1, Number(body.stale_hours || 168));
    const checkedBy = String(body.checked_by || 'youtube_playability_audit');
    let mediaItems: any[] = [];

    if (Array.isArray(body.media_item_ids) && body.media_item_ids.length > 0) {
      const { data, error } = await supabase
        .from('media_items')
        .select('id, source_id, source_type, title, artist, duration, youtube_playability_status, youtube_playability_checked_at')
        .in('id', body.media_item_ids)
        .eq('source_type', 'youtube')
        .limit(limit);
      if (error) throw error;
      mediaItems = data || [];
    } else if (body.playlist_id) {
      const { data, error } = await supabase
        .from('playlist_items')
        .select('media_item:media_items(id, source_id, source_type, title, artist, duration, youtube_playability_status, youtube_playability_checked_at)')
        .eq('playlist_id', body.playlist_id)
        .limit(limit);
      if (error) throw error;
      mediaItems = (data || []).map((row: any) => row.media_item).filter((item: any) => item?.source_type === 'youtube');
    } else {
      const staleBefore = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('media_items')
        .select('id, source_id, source_type, title, artist, duration, youtube_playability_status, youtube_playability_checked_at')
        .eq('source_type', 'youtube')
        .or(`youtube_playability_checked_at.is.null,youtube_playability_checked_at.lt.${staleBefore}`)
        .order('youtube_playability_checked_at', { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw error;
      mediaItems = data || [];
    }

    const idToMedia = new Map<string, any>();
    for (const media of mediaItems) {
      const youtubeId = extractYouTubeId(media.source_id);
      if (youtubeId) idToMedia.set(youtubeId, media);
    }

    const youtubeIds = Array.from(idToMedia.keys());
    const checkedVideos: any[] = [];

    for (let i = 0; i < youtubeIds.length; i += BATCH_SIZE) {
      const batchIds = youtubeIds.slice(i, i + BATCH_SIZE);
      const scraperResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/youtube-scraper`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ type: 'check', video_ids: batchIds }),
      });

      if (!scraperResp.ok) {
        throw new Error(`youtube-scraper check failed: ${scraperResp.status} ${await scraperResp.text()}`);
      }

      const payload = await scraperResp.json();
      const videos = payload.videos || [];
      checkedVideos.push(...videos);

      for (const video of videos) {
        const media = idToMedia.get(video.id);
        if (!media) continue;

        await supabase.rpc('record_youtube_playability', {
          p_media_item_id: media.id,
          p_youtube_id: video.id,
          p_status: video.playabilityStatus || (video.embeddable === false ? 'embed_blocked' : 'unknown'),
          p_reason: video.playabilityReason || null,
          p_checked_by: checkedBy,
          p_embeddable: typeof video.embeddable === 'boolean' ? video.embeddable : null,
          p_oembed_ok: typeof video.oembedOk === 'boolean' ? video.oembedOk : null,
          p_error_code: null,
          p_details: {
            title: video.title || null,
            artist: video.artist || null,
            url: video.url || null,
          },
        });
      }
    }

    return new Response(JSON.stringify({
      checked_count: checkedVideos.length,
      candidate_count: mediaItems.length,
      summary: summarize(checkedVideos),
      videos: checkedVideos,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('youtube-playability-audit error:', error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
