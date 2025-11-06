// Shared Supabase Client and Types
// Used by all three frontend apps

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface Player {
  id: string;
  name: string;
  status: 'offline' | 'online' | 'error';
  last_heartbeat: string;
  active_playlist_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Playlist {
  id: string;
  player_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  position: number;
  media_item_id: string;
  added_at: string;
}

export interface MediaItem {
  id: string;
  source_id: string;
  source_type: string;
  title: string;
  artist: string | null;
  url: string;
  duration: number | null;
  thumbnail: string | null;
  fetched_at: string;
  metadata: Record<string, any>;
}

export interface QueueItem {
  id: string;
  player_id: string;
  type: 'normal' | 'priority';
  media_item_id: string;
  position: number;
  requested_by: string | null;
  requested_at: string;
  played_at: string | null;
  expires_at: string;
  media_item?: MediaItem; // Joined data
}

export interface PlayerStatus {
  player_id: string;
  state: 'idle' | 'playing' | 'paused' | 'error' | 'loading';
  progress: number;
  current_media_id: string | null;
  now_playing_index: number;
  queue_head_position: number;
  last_updated: string;
  current_media?: MediaItem; // Joined data
}

export interface PlayerSettings {
  player_id: string;
  loop: boolean;
  shuffle: boolean;
  volume: number;
  freeplay: boolean;
  coin_per_song: number;
  branding: {
    name: string;
    logo: string;
    theme: string;
  };
  search_enabled: boolean;
  max_queue_size: number;
  priority_queue_limit: number;
}

export interface KioskSession {
  session_id: string;
  player_id: string;
  credits: number;
  last_active: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

export interface SystemLog {
  id: number;
  player_id: string | null;
  event: string;
  severity: 'debug' | 'info' | 'warn' | 'error';
  payload: Record<string, any>;
  timestamp: string;
}

export interface Database {
  public: {
    Tables: {
      players: { Row: Player };
      playlists: { Row: Playlist };
      playlist_items: { Row: PlaylistItem };
      media_items: { Row: MediaItem };
      queue: { Row: QueueItem };
      player_status: { Row: PlayerStatus };
      player_settings: { Row: PlayerSettings };
      kiosk_sessions: { Row: KioskSession };
      system_logs: { Row: SystemLog };
    };
  };
}

// =============================================================================
// CLIENT INITIALIZATION
// =============================================================================

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase: SupabaseClient<Database> = createClient(supabaseUrl, supabaseAnonKey);

// =============================================================================
// REALTIME HELPERS
// =============================================================================

export interface RealtimeSubscription<T> {
  channel: RealtimeChannel;
  unsubscribe: () => void;
}

/**
 * Subscribe to real-time changes on a table
 */
export function subscribeToTable<T = any>(
  table: string,
  filter: { column?: string; value?: any } | null,
  callback: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: T; old: T }) => void
): RealtimeSubscription<T> {
  const channelName = filter?.column && filter?.value
    ? `${table}:${filter.column}=eq.${filter.value}`
    : `${table}:*`;

  const channel = supabase.channel(channelName);

  const subscription = channel
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        ...(filter?.column && filter?.value ? { filter: `${filter.column}=eq.${filter.value}` } : {})
      },
      (payload: any) => {
        callback({
          eventType: payload.eventType,
          new: payload.new as T,
          old: payload.old as T
        });
      }
    )
    .subscribe();

  return {
    channel,
    unsubscribe: () => {
      supabase.removeChannel(channel);
    }
  };
}

/**
 * Subscribe to player status updates
 */
export function subscribeToPlayerStatus(
  playerId: string,
  callback: (status: PlayerStatus) => void
): RealtimeSubscription<PlayerStatus> {
  // Fetch initial status with media_item join
  supabase
    .from('player_status')
    .select('*, current_media:media_items(*)')
    .eq('player_id', playerId)
    .single()
    .then(({ data }) => {
      if (data) callback(data as any);
    });

  return subscribeToTable<PlayerStatus>(
    'player_status',
    { column: 'player_id', value: playerId },
    (payload) => {
      if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
        // Fetch with media_item join
        supabase
          .from('player_status')
          .select('*, current_media:media_items(*)')
          .eq('player_id', playerId)
          .single()
          .then(({ data }) => {
            if (data) callback(data as any);
          });
      }
    }
  );
}

/**
 * Subscribe to queue updates
 */
export function subscribeToQueue(
  playerId: string,
  callback: (items: QueueItem[]) => void
): RealtimeSubscription<QueueItem> {
  let refetchTimeout: ReturnType<typeof setTimeout> | null = null;
  
  const fetchQueue = () => {
    console.log('[subscribeToQueue] Fetching queue from database...');
    supabase
      .from('queue')
      .select('*, media_item:media_items(*)')
      .eq('player_id', playerId)
      .is('played_at', null)
      .order('type', { ascending: false })
      .order('position', { ascending: true })
      .then(({ data }) => {
        if (data) {
          console.log('[subscribeToQueue] Fetched', data.length, 'items');
          callback(data as QueueItem[]);
        }
      });
  };
  
  // Fetch initial queue
  fetchQueue();

  // Subscribe to changes
  return subscribeToTable<QueueItem>(
    'queue',
    { column: 'player_id', value: playerId },
    () => {
      // Debounce refetch to allow database updates to complete
      console.log('[subscribeToQueue] Change detected, scheduling refetch in 800ms...');
      if (refetchTimeout) clearTimeout(refetchTimeout);
      refetchTimeout = setTimeout(() => {
        fetchQueue();
      }, 800); // Increased to 800ms to ensure all position updates complete
    }
  );
}

/**
 * Subscribe to player settings
 */
export function subscribeToPlayerSettings(
  playerId: string,
  callback: (settings: PlayerSettings) => void
): RealtimeSubscription<PlayerSettings> {
  // Fetch initial settings
  supabase
    .from('player_settings')
    .select('*')
    .eq('player_id', playerId)
    .single()
    .then(({ data }) => {
      if (data) callback(data);
    });

  return subscribeToTable<PlayerSettings>(
    'player_settings',
    { column: 'player_id', value: playerId },
    (payload) => {
      if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
        callback(payload.new);
      }
    }
  );
}

/**
 * Subscribe to kiosk session
 */
export function subscribeToKioskSession(
  sessionId: string,
  callback: (session: KioskSession) => void
): RealtimeSubscription<KioskSession> {
  // Fetch initial session
  supabase
    .from('kiosk_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .single()
    .then(({ data }) => {
      if (data) callback(data);
    });

  return subscribeToTable<KioskSession>(
    'kiosk_sessions',
    { column: 'session_id', value: sessionId },
    (payload) => {
      if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
        callback(payload.new);
      }
    }
  );
}

/**
 * Subscribe to system logs
 */
export function subscribeToSystemLogs(
  playerId: string,
  callback: (log: SystemLog) => void
): RealtimeSubscription<SystemLog> {
  return subscribeToTable<SystemLog>(
    'system_logs',
    { column: 'player_id', value: playerId },
    (payload) => {
      if (payload.eventType === 'INSERT') {
        callback(payload.new);
      }
    }
  );
}

// =============================================================================
// API HELPERS
// =============================================================================

/**
 * Call queue manager edge function
 * For large reorder operations (>50 items), calls RPC directly to avoid request size limits
 */
export async function callQueueManager(params: {
  player_id: string;
  action: 'add' | 'remove' | 'reorder' | 'next' | 'skip' | 'clear';
  media_item_id?: string;
  queue_id?: string;
  queue_ids?: string[];
  type?: 'normal' | 'priority';
  requested_by?: string;
}) {
  // For reorder with many items, call RPC directly to avoid Edge Function request size limits
  if (params.action === 'reorder' && params.queue_ids && params.queue_ids.length > 50) {
    console.log('[callQueueManager] Large reorder detected, calling RPC directly');
    const { error } = await supabase.rpc('queue_reorder', {
      p_player_id: params.player_id,
      p_queue_ids: params.queue_ids,
      p_type: params.type || 'normal'
    });
    if (error) throw error;
    return { success: true };
  }

  // Otherwise use Edge Function
  const { data, error } = await supabase.functions.invoke('queue-manager', {
    body: params
  });

  if (error) throw error;
  return data;
}

/**
 * Call player control edge function
 */
export async function callPlayerControl(params: {
  player_id: string;
  state?: 'idle' | 'playing' | 'paused' | 'error' | 'loading';
  progress?: number;
  action?: 'heartbeat' | 'update' | 'ended' | 'skip';
}) {
  const { data, error } = await supabase.functions.invoke('player-control', {
    body: params
  });

  if (error) throw error;
  return data;
}

/**
 * Call kiosk handler edge function
 */
export async function callKioskHandler(params: {
  session_id?: string;
  player_id?: string;
  action: 'init' | 'search' | 'credit' | 'request';
  query?: string;
  media_item_id?: string;
  amount?: number;
}) {
  const { data, error } = await supabase.functions.invoke('kiosk-handler', {
    body: params
  });

  if (error) throw error;
  return data;
}

/**
 * Call playlist-manager Edge Function
 */
export async function callPlaylistManager(params: {
  action: 'create' | 'update' | 'delete' | 'add_item' | 'remove_item' | 'reorder' | 'scrape';
  player_id?: string;
  playlist_id?: string;
  name?: string;
  description?: string;
  media_item_id?: string;
  item_ids?: string[];
  url?: string;
}) {
  const { data, error } = await supabase.functions.invoke('playlist-manager', {
    body: params
  });

  if (error) throw error;
  return data;
}

/**
 * Initialize player with default playlist and start auto-play
 */
export async function initializePlayerPlaylist(playerId: string) {
  const { data, error } = await supabase.rpc('initialize_player_playlist', {
    p_player_id: playerId
  });

  if (error) throw error;
  return data?.[0] || null;
}

/**
 * Load a specific playlist into the player queue
 */
export async function loadPlaylist(playerId: string, playlistId: string, startIndex: number = 0) {
  const { data, error } = await supabase.rpc('load_playlist', {
    p_player_id: playerId,
    p_playlist_id: playlistId,
    p_start_index: startIndex
  });

  if (error) throw error;
  return data?.[0] || null;
}

/**
 * Get default playlist for a player
 */
export async function getDefaultPlaylist(playerId: string) {
  const { data, error } = await supabase.rpc('get_default_playlist', {
    p_player_id: playerId
  });

  if (error) throw error;
  return data?.[0] || null;
}

// =============================================================================
// DIRECT DATABASE QUERIES (for read-heavy operations)
// =============================================================================

/**
 * Get player by ID
 */
export async function getPlayer(playerId: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all playlists for a player
 */
export async function getPlaylists(playerId: string): Promise<Playlist[]> {
  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get playlist items with media details
 */
export async function getPlaylistItems(playlistId: string): Promise<(PlaylistItem & { media_item: MediaItem })[]> {
  const { data, error } = await supabase
    .from('playlist_items')
    .select('*, media_item:media_items(*)')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true });

  if (error) throw error;
  return data as any || [];
}

/**
 * Get queue items with media details
 */
export async function getQueue(playerId: string): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from('queue')
    .select('*, media_item:media_items(*)')
    .eq('player_id', playerId)
    .is('played_at', null)
    .order('type', { ascending: false })
    .order('position', { ascending: true });

  if (error) throw error;
  return data as any || [];
}

/**
 * Get system logs
 */
export async function getSystemLogs(
  playerId: string,
  options?: { severity?: string; limit?: number }
): Promise<SystemLog[]> {
  let query = supabase
    .from('system_logs')
    .select('*')
    .eq('player_id', playerId)
    .order('timestamp', { ascending: false });

  if (options?.severity) {
    query = query.eq('severity', options.severity);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}
