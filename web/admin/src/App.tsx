// Obie Admin Console - Server-First Architecture
// All state lives in Supabase, this is just a UI renderer

import { useEffect, useState } from 'react';
import {
  supabase,
  subscribeToQueue,
  subscribeToPlayerStatus,
  subscribeToPlayerSettings,
  callQueueManager,
  callPlayerControl,
  getPlaylists,
  getPlaylistItems,
  type QueueItem,
  type PlayerStatus,
  type SystemLog,
  type Playlist,
  type PlaylistItem,
  type PlayerSettings,
  callPlaylistManager,
  signIn,
  signOut,
  getCurrentUser,
  subscribeToAuth,
  type AuthUser,
} from '@shared/supabase-client';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Play,
  Pause,
  SkipForward,
  Shuffle,
  Trash2,
  Plus,
  List,
  Activity,
  GripVertical,
} from 'lucide-react';
import { Settings as SettingsIcon } from 'lucide-react';

const PLAYER_ID = '00000000-0000-0000-0000-000000000001'; // Default player

// =============================================================================
// LOGIN FORM
// =============================================================================

function LoginForm({ onSignIn }: { onSignIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await signIn(email, password);
      if (result.user) {
        onSignIn({
          id: result.user.id,
          email: result.user.email || '',
          role: result.user.user_metadata?.role || result.user.app_metadata?.role,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-8">Obie Admin</h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-700 px-4 py-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-700 px-4 py-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
              required
            />
          </div>
          {error && (
            <div className="text-red-400 text-sm">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-3 rounded font-medium transition"
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN APP
// =============================================================================

function App() {
  const [activeTab, setActiveTab] = useState<'queue' | 'playlists' | 'settings' | 'logs'>('queue');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check initial auth state
    getCurrentUser().then(setUser).finally(() => setLoading(false));

    // Subscribe to auth changes
    const authSub = subscribeToAuth(setUser);
    return () => authSub.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <div className="text-2xl text-white">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm onSignIn={setUser} />;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Obie Admin Console</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user.email}</span>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <nav className="w-64 bg-gray-800 border-r border-gray-700 min-h-[calc(100vh-73px)] p-4">
          <button
            onClick={() => setActiveTab('queue')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition ${
              activeTab === 'queue' ? 'bg-blue-600' : 'hover:bg-gray-700'
            }`}
          >
            <List size={20} />
            <span>Queue</span>
          </button>
          <button
            onClick={() => setActiveTab('playlists')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition ${
              activeTab === 'playlists' ? 'bg-blue-600' : 'hover:bg-gray-700'
            }`}
          >
            <Play size={20} />
            <span>Playlists</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition ${
              activeTab === 'settings' ? 'bg-blue-600' : 'hover:bg-gray-700'
            }`}
          >
            <SettingsIcon size={20} />
            <span>Settings</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition ${
              activeTab === 'logs' ? 'bg-blue-600' : 'hover:bg-gray-700'
            }`}
          >
            <Activity size={20} />
            <span>Logs</span>
          </button>
        </nav>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {activeTab === 'queue' && <QueueView />}
          {activeTab === 'playlists' && <PlaylistsView />}
          {activeTab === 'settings' && <Settings />}
          {activeTab === 'logs' && <LogsView />}
        </main>
      </div>
    </div>
  );
}

// =============================================================================
// QUEUE VIEW
// =============================================================================

function QueueView() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const queueSub = subscribeToQueue(PLAYER_ID, setQueue);
    const statusSub = subscribeToPlayerStatus(PLAYER_ID, setStatus);

    return () => {
      queueSub.unsubscribe();
      statusSub.unsubscribe();
    };
  }, []);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    console.log('[handleDragEnd] Drag ended:', { activeId: active.id, overId: over.id });

    // Work with normal queue items only (excluding currently playing)
    const normalQueueItems = queue.filter((item) => 
      item.type === 'normal' && item.media_item_id !== status?.current_media_id
    );

    const oldIndex = normalQueueItems.findIndex((item) => item.id === active.id);
    const newIndex = normalQueueItems.findIndex((item) => item.id === over.id);

    console.log('[handleDragEnd] Reordering:', { oldIndex, newIndex, totalItems: normalQueueItems.length });

    const reordered = arrayMove(normalQueueItems, oldIndex, newIndex);
    
    // Optimistic update: merge back with priority queue and currently playing
    const priorityItems = queue.filter((item) => item.type === 'priority');
    const currentlyPlaying = queue.filter((item) => item.media_item_id === status?.current_media_id);
    const newQueue = [...currentlyPlaying, ...priorityItems, ...reordered];
    
    console.log('[handleDragEnd] Setting optimistic queue, new length:', newQueue.length);
    setQueue(newQueue);

    try {
      // Dedupe client-side to avoid sending duplicate IDs which can confuse
      // the server-side ord calculations and trigger unique constraint errors.
      const queueIdsAll = reordered.map((item) => item.id);
      const queueIds = Array.from(new Set(queueIdsAll));
      console.log('[handleDragEnd] Calling queue-manager with', queueIds.length, 'unique IDs (raw', queueIdsAll.length, ')');

      const result = await callQueueManager({
        player_id: PLAYER_ID,
        action: 'reorder',
        queue_ids: queueIds,
        type: 'normal',
      });

      console.log('[handleDragEnd] Reorder successful:', result);
    } catch (error) {
      console.error('[handleDragEnd] Failed to reorder queue:', error);
      // Revert on error
      setQueue(queue);
    }
  };

  const handleRemove = async (queueId: string) => {
    try {
      await callQueueManager({
        player_id: PLAYER_ID,
        action: 'remove',
        queue_id: queueId,
      });
    } catch (error) {
      console.error('Failed to remove item:', error);
    }
  };

  const handleShuffle = async () => {
    // Disable the shuffle button while in-flight and retry on transient failures
    const originalQueue = queue.slice();
    setIsShuffling(true);
    try {
      console.log('[handleShuffle] Starting shuffle...');

      // Helper to compute shuffled ids from a list of queue items
      const buildShuffledIds = (items: QueueItem[]) => {
        const shuffled = [...items];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.map((it) => it.id);
      };

      // Get normal queue items excluding currently playing (current view snapshot)
      const normalQueueItems = queue.filter((item) =>
        item.type === 'normal' && item.media_item_id !== status?.current_media_id
      );

      console.log('[handleShuffle] Shuffling', normalQueueItems.length, 'items');

      // Optimistic update: merge back with priority queue and currently playing
      const shuffledIds = buildShuffledIds(normalQueueItems);
      const shuffled = shuffledIds.map((id) => normalQueueItems.find((x) => x.id === id)!) as QueueItem[];
      const priorityItems = queue.filter((item) => item.type === 'priority');
      const currentlyPlaying = queue.filter((item) => item.media_item_id === status?.current_media_id);
      const newQueue = [...currentlyPlaying, ...priorityItems, ...shuffled];

      console.log('[handleShuffle] Setting optimistic queue, new length:', newQueue.length);
      setQueue(newQueue);

      // Retry loop with exponential backoff. On duplicate-key (23505) we refetch
      // the latest queue from the DB and re-generate a shuffled order before retrying.
      const maxAttempts = 5;
      let attempt = 0;
      let lastError: any = null;

      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          const result = await callQueueManager({
            player_id: PLAYER_ID,
            action: 'reorder',
            queue_ids: shuffledIds,
            type: 'normal',
          });
          console.log('[handleShuffle] Shuffle successful (attempt', attempt, '):', result);
          lastError = null;
          break;
        } catch (err: any) {
          console.error('[handleShuffle] Shuffle attempt', attempt, 'failed:', err);
          lastError = err;

          const msg = String(err?.message || err);
          const isDuplicateKey = msg.includes('23505') || /duplicate key/i.test(msg);

          if (isDuplicateKey) {
            // If duplicate-key, refetch latest queue and recompute shuffle
            console.warn('[handleShuffle] Detected duplicate-key (23505). Refetching latest queue and retrying.');
            try {
              const { data: latest, error: fetchErr } = await supabase
                .from('queue')
                .select('*')
                .eq('player_id', PLAYER_ID)
                .is('played_at', null)
                .order('type', { ascending: false })
                .order('position', { ascending: true });

              if (fetchErr) throw fetchErr;
              const latestNormal = (latest || []).filter((item: any) =>
                item.type === 'normal' && item.media_item_id !== status?.current_media_id
              );

              if (latestNormal.length === 0) {
                console.warn('[handleShuffle] Latest normal queue empty, aborting retries.');
                break;
              }

              // Rebuild shuffledIds from latest set and update optimistic UI
              const newShuffledIds = buildShuffledIds(latestNormal as QueueItem[]);
              const newShuffled = newShuffledIds.map((id) => latestNormal.find((x: any) => x.id === id)!) as QueueItem[];
              const newQueueView = [...currentlyPlaying, ...priorityItems, ...newShuffled];
              setQueue(newQueueView);

              // Replace the shuffledIds for the next attempt
              // (we don't modify the outer-scope 'shuffledIds' const, so use a local)
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              // reassign variable by shadowing
              // @ts-ignore
              shuffledIds.length = 0; // clear
              // @ts-ignore
              Array.prototype.push.apply(shuffledIds, newShuffledIds);

              // Wait exponential backoff before retry
              const backoff = 200 * Math.pow(2, attempt - 1);
              await new Promise((res) => setTimeout(res, backoff));
              continue;
            } catch (refetchErr) {
              console.error('[handleShuffle] Failed to refetch/rebuild queue for retry:', refetchErr);
              // fallthrough to backoff and retry the original attempt
            }
          }

          // Non-duplicate-key errors or refetch failure: backoff and retry
          const backoff = 200 * Math.pow(2, attempt - 1);
          await new Promise((res) => setTimeout(res, backoff));
        }
      }

      if (lastError) {
        // All attempts failed - revert optimistic update
        console.error('[handleShuffle] All attempts failed, reverting optimistic queue. Last error:', lastError);
        setQueue(originalQueue);
      }
    } finally {
      setIsShuffling(false);
    }
  };

  const handleSkip = async () => {
    try {
      // Update player state to trigger skip in player
      await callPlayerControl({
        player_id: PLAYER_ID,
        state: 'idle', // Signal to player to skip
        action: 'skip',
      });
    } catch (error) {
      console.error('Failed to skip:', error);
    }
  };

  const handlePlayPause = async () => {
    try {
      const newState = status?.state === 'playing' ? 'paused' : 'playing';
      await callPlayerControl({
        player_id: PLAYER_ID,
        state: newState,
        action: 'update',
      });
    } catch (error) {
      console.error('Failed to play/pause:', error);
    }
  };

  const priorityQueue = queue.filter((item) => 
    item.type === 'priority' && item.media_item_id !== status?.current_media_id
  );
  const normalQueue = queue.filter((item) => 
    item.type === 'normal' && item.media_item_id !== status?.current_media_id
  );

  return (
    <div>
      {/* Player Controls */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Player Controls</h2>
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={handlePlayPause}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            {status?.state === 'playing' ? <Pause size={20} /> : <Play size={20} />}
            {status?.state === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={handleSkip}
            className="flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
          >
            <SkipForward size={20} />
            Skip
          </button>
          <button
            onClick={handleShuffle}
            disabled={isShuffling}
            className={`flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition ${isShuffling ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Shuffle size={20} />
            {isShuffling ? 'Shuffling...' : 'Shuffle Playlist'}
          </button>
        </div>

        {/* Now Playing */}
        {status?.current_media && (
          <div className="bg-gray-700 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Now Playing</div>
            <div className="font-semibold">{(status.current_media as any).title || 'Unknown Title'}</div>
            <div className="text-sm text-gray-400">{(status.current_media as any).artist || 'Unknown Artist'}</div>
            <div className="mt-2 bg-gray-600 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${status.progress * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Priority Queue */}
      {priorityQueue.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4 text-yellow-400">Priority Queue / Requests ({priorityQueue.length})</h2>
          <div className="space-y-2">
            {priorityQueue.map((item) => (
              <div key={item.id} className="bg-gray-700 rounded-lg p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-semibold">{(item.media_item as any)?.title || 'Unknown'}</div>
                  <div className="text-sm text-gray-400">
                    Requested by {item.requested_by || 'Unknown'}
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(item.id)}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Normal Queue (Drag & Drop) */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Queue ({normalQueue.length})</h2>
        <div style={{ maxHeight: 400, overflowY: 'auto', border: '2px solid #444', borderRadius: 8, background: '#222', padding: 8 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={normalQueue.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {normalQueue.map((item) => (
                  <SortableQueueItem key={item.id} item={item} onRemove={handleRemove} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {normalQueue.length === 0 && (
            <div className="text-center text-gray-400 py-8">Queue is empty</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortableQueueItem({ item, onRemove }: { item: QueueItem; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-gray-700 rounded-lg p-4 flex items-center gap-4"
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical size={20} className="text-gray-400" />
      </button>
      <div className="flex-1">
        <div className="font-semibold">{(item.media_item as any)?.title || 'Unknown'}</div>
        <div className="text-sm text-gray-400">{(item.media_item as any)?.artist || 'Unknown Artist'}</div>
      </div>
      <div className="text-sm text-gray-400">
        {Math.floor(((item.media_item as any)?.duration || 0) / 60)}:
        {String(((item.media_item as any)?.duration || 0) % 60).padStart(2, '0')}
      </div>
      <button
        onClick={() => onRemove(item.id)}
        className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded transition"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

// =============================================================================
// PLAYLISTS VIEW
// =============================================================================

function PlaylistsView() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistCounts, setPlaylistCounts] = useState<Record<string, number>>({});
  // Removed unused selectedPlaylist state
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [expandedPlaylist, setExpandedPlaylist] = useState<string | null>(null);

  useEffect(() => {
  loadPlaylists();
  }, []);

  useEffect(() => {
    if (expandedPlaylist) {
      loadPlaylistItems(expandedPlaylist);
    }
  }, [expandedPlaylist]);

  // Removed unused confirmOpen
  // Removed unused confirmTarget and setConfirmTarget

  const loadPlaylists = async () => {
    try {
      const data: any = await getPlaylists(PLAYER_ID);
      setPlaylists(data || []);
      // Find active playlist
      const active = (data || []).find((p: any) => p.is_active);
      setActivePlaylist(active || null);
      // If the view provided item_count, populate the map
      const map: Record<string, number> = {};
      (data || []).forEach((p: any) => {
        if (p.item_count !== undefined) map[p.id] = p.item_count;
      });
      setPlaylistCounts(map);
    } catch (error) {
      console.error('Failed to load playlists:', error);
    }
  };

  const handleView = (playlistId: string) => {
  setExpandedPlaylist(expandedPlaylist === playlistId ? null : playlistId);
  };

  const handleLoad = async (e: React.MouseEvent, playlistId: string) => {
    e.stopPropagation();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    try {
      // 1. Set active playlist and reset current_index to -1 (Now Playing position)
      await callPlaylistManager({
        action: 'set_active',
        player_id: PLAYER_ID,
        playlist_id: playlist.id,
        current_index: -1,
      });

      // 2. Clear the current queue
      await callPlaylistManager({
        action: 'clear_queue',
        player_id: PLAYER_ID,
      });

      // 3. Import the selected playlist into the queue
      await callPlaylistManager({
        action: 'import_queue',
        player_id: PLAYER_ID,
        playlist_id: playlist.id,
      });

      await loadPlaylists();
    } catch (err) {
      console.error('Failed to set active playlist:', err);
    }
  };

  // Removed unused confirmLoad and setConfirmOpen

  const loadPlaylistItems = async (playlistId: string) => {
    try {
      const data = await getPlaylistItems(playlistId);
      setPlaylistItems(data);
    } catch (error) {
      console.error('Failed to load playlist items:', error);
    }
  };

  const handleCreatePlaylist = async () => {
    const name = prompt('Playlist name:');
    if (!name) return;

    try {
      await callPlaylistManager({
        action: 'create',
        player_id: PLAYER_ID,
        name,
      });
      await loadPlaylists();
    } catch (error) {
      console.error('Failed to create playlist:', error);
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    const confirm = window.confirm('Delete this playlist? This action cannot be undone.');
    if (!confirm) return;

    try {
      await callPlaylistManager({
        action: 'delete',
        player_id: PLAYER_ID,
        playlist_id: playlistId,
      });
      await loadPlaylists();
    } catch (error) {
      console.error('Failed to delete playlist:', error);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Playlists</h2>
        <button
          onClick={handleCreatePlaylist}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded transition"
        >
          <Plus size={16} className="inline-block mr-2" />
          New Playlist
        </button>
      </div>

      {/* Active Playlist Label */}
      {activePlaylist && (
        <div className="mb-4 p-3 bg-gray-900 rounded text-gray-200 font-semibold">
          Currently Active Playlist: <span className="text-blue-400">{activePlaylist.name}</span>
        </div>
      )}

      {/* Playlist List (excluding active) */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6">
        {playlists.filter(p => !activePlaylist || p.id !== activePlaylist.id).length === 0 ? (
          <div className="text-center text-gray-400 py-8">No playlists found</div>
        ) : (
          <div className="space-y-2">
            {playlists.filter(p => !activePlaylist || p.id !== activePlaylist.id).map((playlist) => (
              <div
                key={playlist.id}
                className="bg-gray-700 rounded-lg p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="font-semibold">{playlist.name}</div>
                    <div className="text-sm text-gray-400">
                      {playlistCounts[playlist.id] || 0} {playlistCounts[playlist.id] === 1 ? 'item' : 'items'}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={() => handleView(playlist.id)}
                      className={`px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded transition text-white`}
                      title={expandedPlaylist === playlist.id ? 'Hide' : 'View'}
                    >
                      {expandedPlaylist === playlist.id ? 'Hide' : 'View'}
                    </button>
                    <button
                      onClick={(e) => handleLoad(e, playlist.id)}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded transition"
                      title="Load Playlist"
                    >
                      <Play size={16} />
                    </button>
                    <button
                      onClick={() => handleDeletePlaylist(playlist.id)}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded transition"
                      title="Delete Playlist"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {/* Expandable playlist items */}
                {expandedPlaylist === playlist.id && (
                  <div className="mt-3 max-h-60 overflow-y-auto bg-gray-800 rounded p-3">
                    {playlistItems.length === 0 ? (
                      <div className="text-center text-gray-400 py-4">No items in this playlist</div>
                    ) : (
                      <div className="space-y-2">
                        {playlistItems.map((item) => (
                          <div key={item.id} className="bg-gray-700 rounded-lg p-3 flex items-center gap-4">
                            <div className="flex-1">
                              <div className="font-semibold">
                                {((item as any).media_item?.title || 'Unknown Title')}
                                {((item as any).media_item?.artist ? ' | ' + (item as any).media_item.artist : '')}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// SETTINGS VIEW
// =============================================================================

function Settings() {
  const [settings, setSettings] = useState<PlayerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [creditsError, setCreditsError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const sub = subscribeToPlayerSettings(PLAYER_ID, (s) => {
      setSettings(s);
      setLoading(false);
    });
    // Fetch credits on mount
    fetchCredits();
    return () => sub.unsubscribe();
    // eslint-disable-next-line
  }, []);

  const fetchCredits = async () => {
    setCreditsLoading(true);
    setCreditsError(null);
    try {
      // Dynamically import to avoid circular dep if any
      const { getTotalCredits } = await import('@shared/supabase-client');
      const total = await getTotalCredits(PLAYER_ID);
      setCredits(total);
    } catch (err: any) {
      setCreditsError(err.message || 'Failed to fetch credits');
    } finally {
      setCreditsLoading(false);
    }
  };

  const handleChange = (field: keyof PlayerSettings, value: any) => {
    setSettings((prev) => prev ? { ...prev, [field]: value } : prev);
  };

  // Admin credit controls
  const handleAddCredits = async (amount: number) => {
    setCreditsLoading(true);
    setCreditsError(null);
    try {
      const { updateAllCredits } = await import('@shared/supabase-client');
      await updateAllCredits(PLAYER_ID, 'add', amount);
      await fetchCredits();
    } catch (err: any) {
      setCreditsError(err.message || 'Failed to add credits');
    } finally {
      setCreditsLoading(false);
    }
  };

  const handleClearCredits = async () => {
    setCreditsLoading(true);
    setCreditsError(null);
    try {
      const { updateAllCredits } = await import('@shared/supabase-client');
      await updateAllCredits(PLAYER_ID, 'clear');
      await fetchCredits();
    } catch (err: any) {
      setCreditsError(err.message || 'Failed to clear credits');
    } finally {
      setCreditsLoading(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setLoading(true);
    if (!settings) return;
    const { error } = await supabase
      .from('player_settings')
      // @ts-ignore
      .update([{
        shuffle: settings.shuffle,
        loop: settings.loop,
        volume: settings.volume,
        freeplay: settings.freeplay,
        karaoke_mode: settings.karaoke_mode,
      }])
      .eq('player_id', PLAYER_ID);
    setLoading(false);
    if (error) setError(error.message);
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 bg-gray-800 rounded-lg text-gray-400">Loading settings...</div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-3xl mx-auto p-6 bg-gray-800 rounded-lg text-red-400">Unable to load settings.</div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 bg-gray-800 rounded-lg">
      <h2 className="text-2xl font-bold mb-4">Player Settings</h2>
      {error && <div className="text-red-400 mb-2">{error}</div>}
      <div className="space-y-6">
        {/* Player settings */}
        <div className="flex items-center gap-4">
          <label className="font-semibold w-32">Shuffle</label>
          <input
            type="checkbox"
            checked={!!settings.shuffle}
            onChange={e => handleChange('shuffle', e.target.checked)}
            className="w-5 h-5"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="font-semibold w-32">Repeat (Loop)</label>
          <input
            type="checkbox"
            checked={!!settings.loop}
            onChange={e => handleChange('loop', e.target.checked)}
            className="w-5 h-5"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="font-semibold w-32">Volume</label>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.volume ?? 50}
            onChange={e => handleChange('volume', Number(e.target.value))}
            className="w-64"
          />
          <span className="ml-2">{settings.volume ?? 50}</span>
        </div>
        <div className="flex items-center gap-4">
          <label className="font-semibold w-32">Freeplay</label>
          <input
            type="checkbox"
            checked={!!settings.freeplay}
            onChange={e => handleChange('freeplay', e.target.checked)}
            className="w-5 h-5"
          />
        </div>
        {'karaoke_mode' in settings && (
          <div className="flex items-center gap-4">
            <label className="font-semibold w-32">Karaoke Mode</label>
            <input
              type="checkbox"
              checked={!!settings.karaoke_mode}
              onChange={e => handleChange('karaoke_mode', e.target.checked)}
              className="w-5 h-5"
            />
          </div>
        )}
        <button
          onClick={handleSave}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-semibold transition"
          disabled={loading}
        >
          Save Settings
        </button>

        {/* Admin Credits Controls */}
        <div className="mt-10 p-6 bg-gray-900 rounded-lg">
          <h3 className="text-xl font-bold mb-4">Kiosk Credits</h3>
          {creditsError && <div className="text-red-400 mb-2">{creditsError}</div>}
          <div className="flex items-center gap-6 mb-4">
            <div className="text-lg font-semibold">
              Balance: {creditsLoading ? <span className="text-gray-400">Loading...</span> : <span className="text-green-400">{credits ?? 0}</span>}
            </div>
            <button
              onClick={() => handleAddCredits(1)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded transition text-white font-semibold"
              disabled={creditsLoading}
            >
              +1
            </button>
            <button
              onClick={() => handleAddCredits(3)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded transition text-white font-semibold"
              disabled={creditsLoading}
            >
              +3
            </button>
            <button
              onClick={handleClearCredits}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded transition text-white font-semibold"
              disabled={creditsLoading}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// LOGS VIEW
// =============================================================================

function LogsView() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) {
        console.error('Error fetching logs:', error);
      } else {
        setLogs(data);
      }

      setLoading(false);
    };

    fetchLogs();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <div className="text-2xl text-white">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 bg-gray-800 rounded-lg">
      <h2 className="text-2xl font-bold mb-4">System Logs</h2>
      <div className="space-y-4">
        {logs.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No logs found</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="bg-gray-700 rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-2">
                {new Date(log.timestamp).toLocaleString()}
              </div>
              <div className="font-semibold">{log.id}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
