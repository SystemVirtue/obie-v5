/**
 * diagnose-realtime.mjs
 *
 * Tests cross-client Supabase Realtime delivery for queue changes.
 *
 * Simulates:
 *   Client A (production admin) → shuffles queue via queue_reorder
 *   Client B (localhost admin)  → should receive Realtime UPDATE events
 *
 * Run:  node scripts/diagnose-realtime.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://fcabzrkcsfjimpxxnvco.supabase.co';
const ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjYWJ6cmtjc2ZqaW1weHhudmNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNjM3ODcsImV4cCI6MjA4ODYzOTc4N30.Tu7qohJWyHMxieJ-LJZkjMA9HKfrysTXOV4lkSxEJ4c';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjYWJ6cmtjc2ZqaW1weHhudmNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzA2Mzc4NywiZXhwIjoyMDg4NjM5Nzg3fQ.fn0P-FvWbUkJMe6Ji-5EFwqwqDeJHWk9vu-JWF-SQvY';
const EMAIL         = 'admin@djamms.app';
const PASSWORD      = 'JungleFly69!';
const PLAYER_ID     = '00000000-0000-0000-0000-000000000001';
const EDGE_BASE     = `${SUPABASE_URL}/functions/v1`;
const TIMEOUT_MS    = 5000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(label, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${label}`, ...args);
}

async function fetchQueue(client, label) {
  const { data, error } = await client
    .from('queue')
    .select('id, position, type, media_item_id')
    .eq('player_id', PLAYER_ID)
    .is('played_at', null)
    .order('type', { ascending: false })
    .order('position', { ascending: true });
  if (error) { log(label, '❌ fetchQueue error:', error.message); return []; }
  return data;
}

async function callEdge(token, fn, body) {
  const r = await fetch(`${EDGE_BASE}/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error ?? JSON.stringify(json));
  return json;
}

function formatQueue(items) {
  return items.map(i => `[${i.position}] ${i.id.slice(0, 8)}`).join('  ');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Supabase Realtime Cross-Client Diagnostic');
  console.log('  Testing: does a queue change on Client A reach Client B?');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Step 1: Create two independent clients (simulating two browser tabs) ──
  log('SETUP', 'Creating two independent Supabase clients…');
  const clientA = createClient(SUPABASE_URL, ANON_KEY); // "production admin"
  const clientB = createClient(SUPABASE_URL, ANON_KEY); // "localhost admin"

  // ── Step 2: Sign both in ──────────────────────────────────────────────────
  log('AUTH', 'Signing in Client A (production admin)…');
  const { data: authA, error: errA } = await clientA.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (errA) { log('AUTH', '❌ Client A sign-in failed:', errA.message); process.exit(1); }
  log('AUTH', '✅ Client A signed in. Role:', authA.user?.role ?? authA.session?.access_token ? 'authenticated' : 'unknown');

  log('AUTH', 'Signing in Client B (localhost admin)…');
  const { data: authB, error: errB } = await clientB.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (errB) { log('AUTH', '❌ Client B sign-in failed:', errB.message); process.exit(1); }
  log('AUTH', '✅ Client B signed in.');

  // ── Step 3: Fetch baseline queue ─────────────────────────────────────────
  const baseline = await fetchQueue(clientA, 'BASELINE');
  const normalItems = baseline.filter(i => i.type === 'normal');
  log('QUEUE', `Baseline: ${baseline.length} items (${normalItems.length} normal)`);
  if (normalItems.length < 2) {
    log('QUEUE', '⚠️  Need ≥2 normal queue items to shuffle. Aborting.');
    process.exit(1);
  }
  log('QUEUE', 'Before:', formatQueue(normalItems));

  // ── Step 4: Client B subscribes to queue Realtime changes ─────────────────
  log('REALTIME', 'Client B: setting up subscribeToQueue (matching localhost app logic)…');

  const results = {
    eventsReceived: 0,
    firstEventMs: null,
    lastEventMs: null,
    callbackFiredMs: null,
    queueAfterRefetch: null,
    subscriptionStatus: 'pending',
  };
  const startTime = Date.now();

  let refetchTimeout = null;

  function fetchQueueB() {
    results.callbackFiredMs = Date.now() - startTime;
    log('CLIENT-B', `⏰ fetchQueue triggered at +${results.callbackFiredMs}ms`);
    fetchQueue(clientB, 'CLIENT-B').then(data => {
      results.queueAfterRefetch = data;
      log('CLIENT-B', '✅ Re-fetch done. Normal items:', formatQueue(data.filter(i => i.type === 'normal')));
    });
  }

  // Mirror exactly what subscribeToQueue does in the app
  const channelName = `queue:player_id=eq.${PLAYER_ID}`;
  const channelB = clientB.channel(channelName);

  const subscribePromise = new Promise((resolve) => {
    channelB
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue',
          filter: `player_id=eq.${PLAYER_ID}`,
        },
        (payload) => {
          results.eventsReceived++;
          const elapsed = Date.now() - startTime;
          if (results.firstEventMs === null) results.firstEventMs = elapsed;
          results.lastEventMs = elapsed;
          log('CLIENT-B', `📨 Event #${results.eventsReceived} at +${elapsed}ms  type=${payload.eventType}  new.position=${payload.new?.position ?? 'N/A'}`);

          // Exactly mirrors subscribeToQueue debounce
          if (refetchTimeout) clearTimeout(refetchTimeout);
          refetchTimeout = setTimeout(() => {
            fetchQueueB();
            resolve();
          }, 800);
        }
      )
      .subscribe((status) => {
        results.subscriptionStatus = status;
        log('CLIENT-B', `🔌 Subscription status: ${status}`);
      });
  });

  // Give subscription time to fully establish
  log('REALTIME', 'Waiting 2s for subscription to establish…');
  await new Promise(r => setTimeout(r, 2000));
  log('REALTIME', `Subscription state: ${results.subscriptionStatus}`);

  // ── Step 5: Check subscription health via direct Realtime probe ──────────
  log('PROBE', 'Sending a test broadcast to verify channel is alive…');
  const probeReceived = await new Promise((resolve) => {
    let received = false;
    const probeChannel = clientA.channel('probe-test');
    probeChannel.subscribe();
    const probeB = clientB.channel('probe-test');
    probeB.on('broadcast', { event: 'ping' }, () => {
      received = true;
      resolve(true);
    }).subscribe(() => {
      probeChannel.send({ type: 'broadcast', event: 'ping', payload: {} });
    });
    setTimeout(() => resolve(false), 3000);
  });
  log('PROBE', probeReceived
    ? '✅ Broadcast probe: Client B received the broadcast (channel is alive)'
    : '❌ Broadcast probe: Client B did NOT receive broadcast (channel may be dead)');

  // ── Step 6: Client A triggers queue_reorder (production-style shuffle) ────
  log('SHUFFLE', 'Client A: calling queue_reorder (production shuffle approach)…');
  const shuffledIds = [...normalItems].sort(() => Math.random() - 0.5).map(i => i.id);
  const tokenA = authA.session.access_token;

  let shuffleError = null;
  try {
    const result = await callEdge(tokenA, 'queue-manager', {
      player_id: PLAYER_ID,
      action: 'reorder',
      queue_ids: shuffledIds,
      type: 'normal',
    });
    log('SHUFFLE', '✅ queue_reorder succeeded:', JSON.stringify(result));
  } catch (e) {
    shuffleError = e.message;
    log('SHUFFLE', '❌ queue_reorder failed:', e.message);
  }

  // ── Step 7: Also test server-side queue_shuffle ───────────────────────────
  log('SHUFFLE', 'Client A: also calling queue_shuffle (local-branch approach)…');
  try {
    const result2 = await callEdge(tokenA, 'queue-manager', {
      player_id: PLAYER_ID,
      action: 'shuffle',
      type: 'normal',
    });
    log('SHUFFLE', '✅ queue_shuffle succeeded:', JSON.stringify(result2));
  } catch (e) {
    log('SHUFFLE', '❌ queue_shuffle failed:', e.message);
  }

  // ── Step 8: Wait for Realtime callback or timeout ─────────────────────────
  log('WAIT', `Waiting up to ${TIMEOUT_MS}ms for Client B Realtime callback…`);
  const raceResult = await Promise.race([
    subscribePromise,
    new Promise(r => setTimeout(() => r('TIMEOUT'), TIMEOUT_MS)),
  ]);

  // Extra 1s to let fetchQueueB complete
  await new Promise(r => setTimeout(r, 1200));

  // ── Step 9: Direct re-fetch to compare ────────────────────────────────────
  const afterDirect = await fetchQueue(clientA, 'AFTER-DIRECT');
  const afterNormal = afterDirect.filter(i => i.type === 'normal');
  log('VERIFY', 'DB queue after shuffle:', formatQueue(afterNormal));
  const orderChanged = normalItems.map(i => i.id).join(',') !== afterNormal.map(i => i.id).join(',');
  log('VERIFY', orderChanged ? '✅ DB order DID change' : '⚠️  DB order did NOT change (same order as before)');

  // ── Step 10: Report ───────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  DIAGNOSIS REPORT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Subscription established:   ${results.subscriptionStatus === 'SUBSCRIBED' ? '✅ YES' : `❌ NO (status=${results.subscriptionStatus})`}`);
  console.log(`  Broadcast probe passed:     ${probeReceived ? '✅ YES' : '❌ NO'}`);
  console.log(`  DB order changed by shuffle:${orderChanged ? '✅ YES' : '⚠️  NO'}`);
  console.log(`  Realtime events received:   ${results.eventsReceived > 0 ? `✅ YES (${results.eventsReceived} events)` : '❌ NONE'}`);
  if (results.firstEventMs !== null) {
    console.log(`  First event arrived at:     +${results.firstEventMs}ms`);
    console.log(`  Last event arrived at:      +${results.lastEventMs}ms`);
  }
  console.log(`  Debounced re-fetch fired:   ${results.callbackFiredMs !== null ? `✅ YES at +${results.callbackFiredMs}ms` : '❌ NO'}`);
  console.log(`  Re-fetch returned new order:${results.queueAfterRefetch ? (
    results.queueAfterRefetch.filter(i=>i.type==='normal').map(i=>i.id).join(',') !==
    normalItems.map(i=>i.id).join(',') ? '✅ YES' : '⚠️  SAME order as before'
  ) : '❌ NOT CALLED'}`);
  console.log(`  Race outcome:               ${raceResult === 'TIMEOUT' ? '❌ TIMEOUT — no Realtime callback within ' + TIMEOUT_MS + 'ms' : '✅ RESOLVED'}`);

  if (results.eventsReceived === 0) {
    console.log('\n  ── ROOT CAUSE CANDIDATES ──────────────────────────────────────');
    console.log('  1. RLS is blocking events (auth.role != authenticated for Client B subscription)');
    console.log('  2. queue table not in supabase_realtime publication (check Supabase Dashboard)');
    console.log('  3. REPLICA IDENTITY not set — UPDATE events may be silently dropped');
    console.log('     Fix: ALTER TABLE queue REPLICA IDENTITY FULL;');
    console.log('  4. Realtime subscription filter mismatch (player_id column value)');
    console.log('  5. Supabase Realtime service outage or misconfiguration');
  } else if (results.callbackFiredMs === null) {
    console.log('\n  ── ROOT CAUSE: Debounce timeout never fired ────────────────────');
    console.log('  Events arrived but 800ms timer was never allowed to expire');
    console.log('  Likely: component unmounted before timeout completed');
  } else if (results.queueAfterRefetch && orderChanged) {
    console.log('\n  ── ROOT CAUSE: Realtime is working ─────────────────────────────');
    console.log('  Events received, re-fetch returned updated data.');
    console.log('  Issue is likely in React rendering (stale state, memo, key prop)');
    console.log('  or the subscription is torn down by React StrictMode before firing.');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');

  // Cleanup
  await clientB.removeChannel(channelB);
  await clientA.auth.signOut();
  await clientB.auth.signOut();
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
