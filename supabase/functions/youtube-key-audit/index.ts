import { corsHeaders } from '../_shared/cors.ts';

type AuditResult = {
  slot: string;
  configured: boolean;
  status: 'valid' | 'invalid' | 'quota_exhausted' | 'restricted' | 'api_disabled' | 'request_failed' | 'duplicate' | 'empty';
  http_status?: number;
  reason?: string;
  message?: string;
  duplicate_of?: string;
};

const TEST_VIDEO_ID = 'dQw4w9WgXcQ';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function checkKey(slot: string, key: string): Promise<AuditResult> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=id&id=${TEST_VIDEO_ID}&key=${encodeURIComponent(key)}`;

  try {
    const response = await fetch(url);
    const json = await response.json().catch(() => ({}));

    if (response.ok) {
      return {
        slot,
        configured: true,
        status: 'valid',
        http_status: response.status,
      };
    }

    const firstError = Array.isArray(json?.error?.errors) ? json.error.errors[0] : null;
    const reason = firstError?.reason || undefined;
    const message = firstError?.message || json?.error?.message || undefined;

    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'dailyLimitExceededUnreg') {
      return { slot, configured: true, status: 'quota_exhausted', http_status: response.status, reason, message };
    }

    if (reason === 'keyInvalid') {
      return { slot, configured: true, status: 'invalid', http_status: response.status, reason, message };
    }

    if (reason === 'ipRefererBlocked' || reason === 'forbidden' || reason === 'accessNotConfigured' || reason === 'youtubeSignupRequired') {
      const status: AuditResult['status'] =
        reason === 'accessNotConfigured' ? 'api_disabled' :
        reason === 'ipRefererBlocked' || reason === 'forbidden' ? 'restricted' :
        'request_failed';
      return { slot, configured: true, status, http_status: response.status, reason, message };
    }

    return {
      slot,
      configured: true,
      status: 'request_failed',
      http_status: response.status,
      reason,
      message,
    };
  } catch (error) {
    return {
      slot,
      configured: true,
      status: 'request_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const slots = [
    'YOUTUBE_API_KEY',
    'YOUTUBE_API_KEYS',
    ...Array.from({ length: 9 }, (_, i) => `YOUTUBE_API_KEY_${i + 1}`),
  ];

  const results: AuditResult[] = [];
  const seenHashes = new Map<string, string>();

  for (const slot of slots) {
    const raw = Deno.env.get(slot);

    if (!raw) {
      results.push({ slot, configured: false, status: 'empty' });
      continue;
    }

    const values = slot === 'YOUTUBE_API_KEYS'
      ? raw.split(',').map((v) => v.trim()).filter(Boolean)
      : [raw.trim()];

    if (values.length === 0) {
      results.push({ slot, configured: false, status: 'empty' });
      continue;
    }

    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      const derivedSlot = slot === 'YOUTUBE_API_KEYS' ? `${slot}[${index + 1}]` : slot;
      const hash = await sha256Hex(value);
      const existing = seenHashes.get(hash);

      if (existing) {
        results.push({
          slot: derivedSlot,
          configured: true,
          status: 'duplicate',
          duplicate_of: existing,
        });
        continue;
      }

      seenHashes.set(hash, derivedSlot);
      results.push(await checkKey(derivedSlot, value));
    }
  }

  return new Response(JSON.stringify({
    audited_at: new Date().toISOString(),
    test_video_id: TEST_VIDEO_ID,
    results,
  }, null, 2), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
});
