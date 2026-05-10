import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../..');

function read(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

test.describe('queue engine regression guardrails', () => {
  test('migration keeps now-playing out of the future queue and resets playback source', () => {
    const sql = read('supabase/migrations/20260511043000_queue_engine_hardening.sql');

    expect(sql).toContain('queue_next_removed_stale_current_row');
    expect(sql).toContain('v_next_queue_item.media_item_id = p_expected_media_id');
    expect(sql).toContain("source = 'youtube'");
    expect(sql).toContain('local_url = NULL');
    expect(sql).toContain('playback_started_at = NULL');
    expect(sql).toContain('v_current_playlist_position');
    expect(sql).toContain('pi.media_item_id IS DISTINCT FROM v_current_media_id');
    expect(sql).toContain('FROM public.queue_next(p_player_id, NULL) qn');
  });

  test('queue_next still skips known-unplayable YouTube media before playback', () => {
    const sql = read('supabase/migrations/20260511043000_queue_engine_hardening.sql');

    expect(sql).toContain('queue_next_skipped_unplayable');
    expect(sql).toContain("'embed_blocked', 'restricted', 'unavailable', 'invalid'");
    expect(sql).toContain('youtube_playability_status');
  });

  test('player commands use effective playback URL and avoid stale iframe commands', () => {
    const app = read('web/player/src/App.tsx');

    expect(app).toContain('newStatus.local_url ||');
    expect(app).toContain('status.local_url || status.current_media?.url || null');
    expect(app).toContain('Resume ignored because iframe media does not match player_status');
    expect(app).toContain('Pause ignored because iframe media does not match player_status');
    expect(app).toContain('Ignoring BUFFERING after confirmed playback start');
  });

  test('shared subscriptions recover after queue fetch errors', () => {
    const shared = read('web/shared/supabase-client.ts');

    expect(shared).toMatch(/if \(error\) \{\s*console\.error\('\[subscribeToQueue\].*?finishFetch\(\);\s*return;/s);
  });

  test('player-control validates endpoint session ownership', () => {
    const fn = read('supabase/functions/player-control/index.ts');

    expect(fn).toContain('endpoint.session_id && endpoint.session_id !== sessionId');
    expect(fn).toContain('isMasterEndpoint(supabase, player_id, endpoint_id, session_id)');
  });

  test('Supabase Storage video fallback is explicit opt-in to protect egress', () => {
    const localService = read('scripts/download-service.mjs');
    const edgeFunction = read('supabase/functions/download-video/index.ts');

    expect(localService).toContain('ALLOW_SUPABASE_STORAGE_VIDEO_FALLBACK');
    expect(edgeFunction).toContain('ALLOW_SUPABASE_STORAGE_VIDEO_FALLBACK');
    expect(localService).toContain('protect project egress');
    expect(edgeFunction).toContain('protect project egress');
  });
});
