const SUPABASE_URL = process.env.SUPABASE_URL || "https://syccqoextpxifmumvxqw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SOURCE_PLAYER_ID = "00000000-0000-0000-0000-000000000001";
const TARGET_PLAYER_ID = "232886d3-af07-4e0d-95e8-654d2636b420";

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function fetchSingle(path) {
  const rows = await rest(path);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`Expected single row for ${path}, got ${Array.isArray(rows) ? rows.length : typeof rows}`);
  }
  return rows[0];
}

async function backupTarget() {
  const player = await fetchSingle(`/players?id=eq.${TARGET_PLAYER_ID}&select=*`);
  const settings = await fetchSingle(`/player_settings?player_id=eq.${TARGET_PLAYER_ID}&select=*`);
  const status = await fetchSingle(`/player_status?player_id=eq.${TARGET_PLAYER_ID}&select=*`);
  const playlists = await rest(`/playlists?player_id=eq.${TARGET_PLAYER_ID}&select=*&order=created_at.asc`);
  const playlistIds = playlists.map((p) => p.id);
  const playlistItems =
    playlistIds.length === 0
      ? []
      : await rest(
          `/playlist_items?playlist_id=in.(${playlistIds.join(",")})&select=*&order=playlist_id.asc,position.asc`
        );
  const queue = await rest(`/queue?player_id=eq.${TARGET_PLAYER_ID}&select=*&order=type.asc,position.asc`);
  return {
    backed_up_at: new Date().toISOString(),
    target_player_id: TARGET_PLAYER_ID,
    player,
    settings,
    status,
    playlists,
    playlist_items: playlistItems,
    queue,
  };
}

async function clone() {
  const sourcePlayer = await fetchSingle(`/players?id=eq.${SOURCE_PLAYER_ID}&select=*`);
  const sourceSettings = await fetchSingle(`/player_settings?player_id=eq.${SOURCE_PLAYER_ID}&select=*`);
  const sourceStatus = await fetchSingle(`/player_status?player_id=eq.${SOURCE_PLAYER_ID}&select=*`);
  const sourcePlaylists = await rest(`/playlists?player_id=eq.${SOURCE_PLAYER_ID}&select=*&order=created_at.asc`);
  const sourcePlaylistIds = sourcePlaylists.map((p) => p.id);
  const sourcePlaylistItems = await rest(
    `/playlist_items?playlist_id=in.(${sourcePlaylistIds.join(",")})&select=*&order=playlist_id.asc,position.asc`
  );
  const sourceQueue = await rest(`/queue?player_id=eq.${SOURCE_PLAYER_ID}&select=*&order=type.asc,position.asc`);

  const targetPlaylists = await rest(`/playlists?player_id=eq.${TARGET_PLAYER_ID}&select=id`);
  const targetPlaylistIds = targetPlaylists.map((p) => p.id);
  if (targetPlaylistIds.length > 0) {
    await rest(`/playlist_items?playlist_id=in.(${targetPlaylistIds.join(",")})`, { method: "DELETE" });
    await rest(`/playlists?id=in.(${targetPlaylistIds.join(",")})`, { method: "DELETE" });
  }

  await rest(`/queue?player_id=eq.${TARGET_PLAYER_ID}`, { method: "DELETE" });

  const clonedSettings = { ...sourceSettings };
  delete clonedSettings.player_id;
  await rest(`/player_settings?player_id=eq.${TARGET_PLAYER_ID}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(clonedSettings),
  });

  const clonedStatus = {
    state: sourceStatus.state,
    progress: sourceStatus.progress,
    current_media_id: sourceStatus.current_media_id,
    now_playing_index: sourceStatus.now_playing_index,
    queue_head_position: sourceStatus.queue_head_position,
    last_updated: sourceStatus.last_updated,
    source: sourceStatus.source,
    local_url: sourceStatus.local_url,
  };
  await rest(`/player_status?player_id=eq.${TARGET_PLAYER_ID}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(clonedStatus),
  });

  const playlistIdMap = new Map();
  for (const source of sourcePlaylists) {
    const insertPayload = {
      player_id: TARGET_PLAYER_ID,
      name: source.name,
      description: source.description,
      is_active: source.is_active,
      created_at: source.created_at,
      updated_at: source.updated_at,
    };
    const created = await rest(`/playlists`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(insertPayload),
    });
    playlistIdMap.set(source.id, created[0].id);
  }

  const sourceActivePlaylistId = sourcePlayer.active_playlist_id;
  const mappedActivePlaylistId = sourceActivePlaylistId ? playlistIdMap.get(sourceActivePlaylistId) : null;

  if (sourcePlaylistItems.length > 0) {
    const insertItems = sourcePlaylistItems.map((item) => ({
      playlist_id: playlistIdMap.get(item.playlist_id),
      position: item.position,
      media_item_id: item.media_item_id,
      added_at: item.added_at,
    }));
    await rest(`/playlist_items`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(insertItems),
    });
  }

  if (sourceQueue.length > 0) {
    const insertQueue = sourceQueue.map((item) => ({
      player_id: TARGET_PLAYER_ID,
      type: item.type,
      media_item_id: item.media_item_id,
      position: item.position,
      requested_by: item.requested_by,
      requested_at: item.requested_at,
      played_at: item.played_at,
      expires_at: item.expires_at,
    }));
    await rest(`/queue`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(insertQueue),
    });
  }

  await rest(`/players?id=eq.${TARGET_PLAYER_ID}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      active_playlist_id: mappedActivePlaylistId,
      status: "online",
    }),
  });
}

async function main() {
  if (!SERVICE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  const mode = process.argv[2];
  if (mode === "backup") {
    const backup = await backupTarget();
    console.log(JSON.stringify(backup, null, 2));
    return;
  }
  if (mode === "clone") {
    await clone();
    console.log(JSON.stringify({ ok: true, source_player_id: SOURCE_PLAYER_ID, target_player_id: TARGET_PLAYER_ID }, null, 2));
    return;
  }
  throw new Error("Usage: node scripts/clone-player-data.mjs [backup|clone]");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
