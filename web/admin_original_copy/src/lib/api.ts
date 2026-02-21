// API Helper Functions for Admin Console
// Wrapper functions for Supabase Edge Functions

import { supabase } from './supabaseClient';

// =============================================================================
// QUEUE MANAGEMENT
// =============================================================================

/**
 * Add song to queue
 */
export async function addToQueue(playerId: string, mediaItemId: string, type: 'normal' | 'priority' = 'normal', requestedBy?: string) {
  const { data, error } = await supabase.functions.invoke('queue-manager', {
    body: {
      player_id: playerId,
      action: 'add',
      media_item_id: mediaItemId,
      type,
      requested_by: requestedBy
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Remove item from queue
 */
export async function removeFromQueue(playerId: string, queueItemId: string) {
  const { data, error } = await supabase.functions.invoke('queue-manager', {
    body: {
      player_id: playerId,
      action: 'remove',
      queue_id: queueItemId
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Clear entire queue
 */
export async function clearQueue(playerId: string) {
  const { data, error } = await supabase.functions.invoke('queue-manager', {
    body: {
      player_id: playerId,
      action: 'clear'
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Play song now (move to front of queue)
 */
export async function playNow(playerId: string, queueItemId: string) {
  const { data, error } = await supabase.functions.invoke('queue-manager', {
    body: {
      player_id: playerId,
      action: 'play_now',
      queue_id: queueItemId
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Move song to top of queue
 */
export async function moveToTop(playerId: string, queueItemId: string) {
  const { data, error } = await supabase.functions.invoke('queue-manager', {
    body: {
      player_id: playerId,
      action: 'move_to_top',
      queue_id: queueItemId
    }
  });

  if (error) throw error;
  return data;
}

// =============================================================================
// PLAYER CONTROL
// =============================================================================

/**
 * Play/pause player
 */
export async function togglePlayPause(playerId: string, isPlaying: boolean) {
  const { data, error } = await supabase.functions.invoke('player-control', {
    body: {
      player_id: playerId,
      action: isPlaying ? 'pause' : 'play'
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Skip to next song
 */
export async function skipToNext(playerId: string) {
  const { data, error } = await supabase.functions.invoke('player-control', {
    body: {
      player_id: playerId,
      action: 'next'
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Go to previous song
 */
export async function goToPrevious(playerId: string) {
  const { data, error } = await supabase.functions.invoke('player-control', {
    body: {
      player_id: playerId,
      action: 'previous'
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Update volume
 */
export async function updateVolume(playerId: string, volume: number) {
  const { data, error } = await supabase.functions.invoke('player-control', {
    body: {
      player_id: playerId,
      action: 'volume',
      volume
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Seek to position
 */
export async function seekToPosition(playerId: string, position: number) {
  const { data, error } = await supabase.functions.invoke('player-control', {
    body: {
      player_id: playerId,
      action: 'seek',
      position
    }
  });

  if (error) throw error;
  return data;
}

// =============================================================================
// PLAYLIST MANAGEMENT
// =============================================================================

/**
 * Create new playlist
 */
export async function createPlaylist(playerId: string, name: string, description?: string) {
  const { data, error } = await supabase.functions.invoke('playlist-manager', {
    body: {
      player_id: playerId,
      action: 'create',
      name,
      description
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Delete playlist
 */
export async function deletePlaylist(playerId: string, playlistId: string) {
  const { data, error } = await supabase.functions.invoke('playlist-manager', {
    body: {
      player_id: playerId,
      action: 'delete',
      playlist_id: playlistId
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Import playlist from URL
 */
export async function importPlaylist(playerId: string, url: string) {
  const { data, error } = await supabase.functions.invoke('playlist-manager', {
    body: {
      player_id: playerId,
      action: 'import',
      url
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Add song to queue from playlist
 */
export async function addFromPlaylist(playerId: string, mediaItemId: string) {
  return addToQueue(playerId, mediaItemId, 'normal');
}

// =============================================================================
// SETTINGS MANAGEMENT
// =============================================================================

/**
 * Update player settings
 */
export async function updatePlayerSettings(playerId: string, settings: Record<string, any>) {
  const { data, error } = await supabase
    .from('player_settings')
    .upsert({
      player_id: playerId,
      ...settings,
      updated_at: new Date().toISOString()
    } as any);

  if (error) throw error;
  return data;
}

// =============================================================================
// LOGS MANAGEMENT
// =============================================================================

/**
 * Add system log entry
 */
export async function addSystemLog(playerId: string, level: 'info' | 'warning' | 'error', message: string, context?: Record<string, any>) {
  const { data, error } = await supabase
    .from('system_logs')
    .insert({
      player_id: playerId,
      level,
      message,
      context: context || {},
      timestamp: new Date().toISOString()
    } as any);

  if (error) throw error;
  return data;
}

/**
 * Clear system logs
 */
export async function clearSystemLogs(playerId: string) {
  const { data, error } = await supabase
    .from('system_logs')
    .delete()
    .eq('player_id', playerId);

  if (error) throw error;
  return data;
}

// =============================================================================
// SEARCH
// =============================================================================

/**
 * Search media items
 */
export async function searchMedia(query: string, limit: number = 20) {
  const { data, error } = await supabase
    .from('media_items')
    .select('*')
    .or(`title.ilike.%${query}%,artist.ilike.%${query}%`)
    .limit(limit)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// =============================================================================
// GENERIC CALL FUNCTIONS (for compatibility with App.tsx)
// =============================================================================

/**
 * Generic queue manager call
 */
export async function callQueueManager(action: string, params: any) {
  const { player_id, ...rest } = params;

  switch (action) {
    case 'addToQueue':
      return addToQueue(player_id, rest.song_id || rest.media_item_id);
    case 'removeFromQueue':
      return removeFromQueue(player_id, rest.queue_id);
    case 'clearQueue':
      return clearQueue(player_id);
    case 'playNow':
      return playNow(player_id, rest.queue_id);
    case 'moveToTop':
      return moveToTop(player_id, rest.queue_id);
    default:
      throw new Error(`Unknown queue action: ${action}`);
  }
}

/**
 * Generic player control call
 */
export async function callPlayerControl(action: string, params: any) {
  const { player_id, ...rest } = params;

  switch (action) {
    case 'togglePlayPause':
      // Placeholder: assume toggle by sending play, but ideally fetch current status
      return togglePlayPause(player_id, false); // This may not be accurate
    case 'skipToNext':
      return skipToNext(player_id);
    case 'skipToPrevious':
      return goToPrevious(player_id);
    case 'updateVolume':
      return updateVolume(player_id, rest.volume);
    case 'seekToPosition':
      return seekToPosition(player_id, rest.position);
    default:
      throw new Error(`Unknown player action: ${action}`);
  }
}

/**
 * Generic playlist manager call
 */
export async function callPlaylistManager(action: string, params: any) {
  const { player_id, ...rest } = params;

  switch (action) {
    case 'createPlaylist':
      return createPlaylist(player_id, rest.name, rest.description);
    case 'deletePlaylist':
      return deletePlaylist(player_id, rest.playlist_id);
    case 'importPlaylist':
      return importPlaylist(player_id, rest.playlist || rest.url);
    case 'addFromPlaylist':
      return addFromPlaylist(player_id, rest.media_item_id);
    default:
      throw new Error(`Unknown playlist action: ${action}`);
  }
}
