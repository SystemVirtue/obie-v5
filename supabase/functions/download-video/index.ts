// Download Video Edge Function
// yt-dlp fallback for YouTube videos that cannot be embedded (errors 101 / 150).
//
// ⚠️  DEPLOYMENT NOTE: This function uses Deno.Command to shell out to yt-dlp.
//    Hosted Supabase Edge Functions run in a sandboxed Deno environment where
//    Deno.Command is not available.  Deploy this to a self-hosted Supabase
//    instance or a custom Docker image that has yt-dlp in PATH.
//
// Expected request body (POST):
//   { videoId: string, player_id?: string }
//
// On success, player_status is updated with:
//   { source: 'local', local_url: <publicUrl>, state: 'playing' }
// The Player app's realtime subscription fires and switches to the <video> element.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const DEFAULT_PLAYER_ID = '00000000-0000-0000-0000-000000000001';

// Validate an 11-character YouTube video ID
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let tmpFile: string | null = null;

  try {
    // ── Env vars ──────────────────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json() as { videoId?: string; player_id?: string };
    const { videoId, player_id = DEFAULT_PLAYER_ID } = body;

    if (!videoId || !YOUTUBE_ID_RE.test(videoId)) {
      return new Response(
        JSON.stringify({ error: 'videoId is required and must be a valid 11-character YouTube ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Signal "loading" to the Player immediately ────────────────────────────
    await supabase
      .from('player_status')
      .update({ state: 'loading', last_updated: new Date().toISOString() })
      .eq('player_id', player_id);

    console.log(`[download-video] Starting yt-dlp download for videoId=${videoId}`);

    // ── Run yt-dlp ────────────────────────────────────────────────────────────
    tmpFile = `/tmp/${videoId}-${Date.now()}.mp4`;
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const ytdlpProc = new Deno.Command('yt-dlp', {
      args: [
        '--format',               'bestvideo[height<=480]+bestaudio/best',
        '--merge-output-format',  'mp4',
        '--output',               tmpFile,
        '--no-playlist',
        '--no-warnings',
        '--quiet',
        ytUrl,
      ],
      stdout: 'piped',
      stderr: 'piped',
    });

    const { code, stderr } = await ytdlpProc.output();

    if (code !== 0) {
      const errText = new TextDecoder().decode(stderr);
      throw new Error(`yt-dlp exited with code ${code}: ${errText.slice(0, 400)}`);
    }

    console.log(`[download-video] yt-dlp finished, uploading to Supabase Storage...`);

    // ── Upload to Storage ─────────────────────────────────────────────────────
    const fileData    = await Deno.readFile(tmpFile);
    const storageName = `${videoId}-${Date.now()}.mp4`;

    const { error: uploadError } = await supabase.storage
      .from('downloads')
      .upload(storageName, fileData, { contentType: 'video/mp4', upsert: true });

    // Clean up temp file right after reading — regardless of upload result
    await Deno.remove(tmpFile).catch((e) =>
      console.warn('[download-video] Failed to remove temp file:', e),
    );
    tmpFile = null;

    if (uploadError) throw uploadError;

    // ── Get public URL ────────────────────────────────────────────────────────
    const { data: { publicUrl } } = supabase.storage
      .from('downloads')
      .getPublicUrl(storageName);

    console.log(`[download-video] Stored at: ${publicUrl}`);

    // ── Update player_status: switch to local source ──────────────────────────
    // current_media_id is left unchanged — it already points to the correct
    // media_items row (set by queue_next when the song was loaded).
    const { error: updateError } = await supabase
      .from('player_status')
      .update({
        source:       'local',
        local_url:    publicUrl,
        state:        'playing',
        last_updated: new Date().toISOString(),
      })
      .eq('player_id', player_id);

    if (updateError) throw updateError;

    console.log(`[download-video] player_status updated — realtime will trigger Player switch`);

    return new Response(
      JSON.stringify({ success: true, publicUrl }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[download-video] Error:', msg);

    // Best-effort cleanup of temp file on error
    if (tmpFile) {
      await Deno.remove(tmpFile).catch(() => { /* ignore */ });
    }

    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
