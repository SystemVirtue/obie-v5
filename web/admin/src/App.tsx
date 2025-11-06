// Obie Admin Console - Server-First Architecture
// All state lives in Supabase, this is just a UI renderer

import { useEffect, useState } from 'react';
import {
  supabase,
  subscribeToQueue,
  subscribeToPlayerStatus,
  subscribeToPlayerSettings,
  subscribeToSystemLogs,
  callQueueManager,
  callPlayerControl,
  getPlaylists,
  type QueueItem,
  type PlayerStatus,
  type PlayerSettings,
  type SystemLog,
  type Playlist,
  callPlaylistManager,
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
  Settings,
  Activity,
  GripVertical,
} from 'lucide-react';

const PLAYER_ID = '00000000-0000-0000-0000-000000000001'; // Default player

function App() {
  const [activeTab, setActiveTab] = useState<'queue' | 'playlists' | 'settings' | 'logs'>('queue');

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <h1 className="text-2xl font-bold">Obie Admin Console</h1>
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
            <Settings size={20} />
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
          {activeTab === 'settings' && <SettingsView />}
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
  const [_settings, _setSettings] = useState<PlayerSettings | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const queueSub = subscribeToQueue(PLAYER_ID, setQueue);
    const statusSub = subscribeToPlayerStatus(PLAYER_ID, setStatus);
    const settingsSub = subscribeToPlayerSettings(PLAYER_ID, _setSettings);

    return () => {
      queueSub.unsubscribe();
      statusSub.unsubscribe();
      settingsSub.unsubscribe();
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
      const queueIds = reordered.map((item) => item.id);
      console.log('[handleDragEnd] Calling queue-manager with', queueIds.length, 'IDs');
      
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
      console.log('[handleRemove] Removing queue item:', queueId);
      
      // Optimistic update: remove from local state immediately
      setQueue(queue.filter(item => item.id !== queueId));
      
      await callQueueManager({
        player_id: PLAYER_ID,
        action: 'remove',
        queue_id: queueId,
      });
      
      console.log('[handleRemove] Successfully removed item');
    } catch (error) {
      console.error('[handleRemove] Failed to remove item:', error);
      // Revert on error - refetch will happen via subscription
    }
  };

  const handleShuffle = async () => {
    try {
      console.log('[handleShuffle] Starting shuffle...');
      
      // Get normal queue items excluding currently playing
      const normalQueueItems = queue.filter(item => 
        item.type === 'normal' && item.media_item_id !== status?.current_media_id
      );
      
      console.log('[handleShuffle] Shuffling', normalQueueItems.length, 'items');
      
      // Shuffle the array using Fisher-Yates algorithm
      const shuffled = [...normalQueueItems];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      
      // Optimistic update: merge back with priority queue and currently playing
      const priorityItems = queue.filter((item) => item.type === 'priority');
      const currentlyPlaying = queue.filter((item) => item.media_item_id === status?.current_media_id);
      const newQueue = [...currentlyPlaying, ...priorityItems, ...shuffled];
      
      console.log('[handleShuffle] Setting optimistic queue, new length:', newQueue.length);
      setQueue(newQueue);
      
      const queueIds = shuffled.map((item) => item.id);
      console.log('[handleShuffle] Calling queue-manager with', queueIds.length, 'IDs');
      
      const result = await callQueueManager({
        player_id: PLAYER_ID,
        action: 'reorder',
        queue_ids: queueIds,
        type: 'normal',
      });
      
      console.log('[handleShuffle] Shuffle successful:', result);
    } catch (error) {
      console.error('[handleShuffle] Failed to shuffle queue:', error);
      // Revert on error
      setQueue(queue);
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
            className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition"
          >
            <Shuffle size={20} />
            Shuffle Playlist
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
          <h2 className="text-xl font-bold mb-4 text-yellow-400">Priority Queue ({priorityQueue.length})</h2>
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
  const [_selectedPlaylist, _setSelectedPlaylist] = useState<string | null>(null);

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      const data = await getPlaylists(PLAYER_ID);
      setPlaylists(data);
    } catch (error) {
      console.error('Failed to load playlists:', error);
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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Playlists</h2>
        <button
          onClick={handleCreatePlaylist}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
        >
          <Plus size={20} />
          New Playlist
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className="bg-gray-800 rounded-lg p-6 cursor-pointer hover:bg-gray-700 transition"
            onClick={() => _setSelectedPlaylist(playlist.id)}
          >
            <h3 className="text-xl font-bold mb-2">{playlist.name}</h3>
            {playlist.description && (
              <p className="text-sm text-gray-400">{playlist.description}</p>
            )}
            {playlist.is_active && (
              <span className="inline-block mt-2 px-2 py-1 bg-green-600 text-xs rounded">Active</span>
            )}
          </div>
        ))}
      </div>

      {playlists.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          No playlists yet. Create one to get started!
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SETTINGS VIEW
// =============================================================================

function SettingsView() {
  const [settings, setSettings] = useState<PlayerSettings | null>(null);

  useEffect(() => {
    const sub = subscribeToPlayerSettings(PLAYER_ID, setSettings);
    return () => sub.unsubscribe();
  }, []);

  const handleUpdate = async (field: keyof PlayerSettings, value: any) => {
    try {
      // @ts-expect-error - Dynamic field update requires type assertion
      await supabase
        .from('player_settings')
        .update({ [field]: value })
        .eq('player_id', PLAYER_ID);
    } catch (error) {
      console.error('Failed to update settings:', error);
    }
  };

  if (!settings) return <div>Loading settings...</div>;

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Player Settings</h2>

      <div className="bg-gray-800 rounded-lg p-6 space-y-6">
        {/* Playback Settings */}
        <div>
          <h3 className="text-lg font-semibold mb-4">Playback</h3>
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <span>Loop</span>
              <input
                type="checkbox"
                checked={settings.loop}
                onChange={(e) => handleUpdate('loop', e.target.checked)}
                className="w-5 h-5"
              />
            </label>
            <label className="flex items-center justify-between">
              <span>Shuffle</span>
              <input
                type="checkbox"
                checked={settings.shuffle}
                onChange={(e) => handleUpdate('shuffle', e.target.checked)}
                className="w-5 h-5"
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-2">Volume: {settings.volume}%</span>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.volume}
                onChange={(e) => handleUpdate('volume', parseInt(e.target.value))}
                className="w-full"
              />
            </label>
          </div>
        </div>

        {/* Kiosk Settings */}
        <div className="border-t border-gray-700 pt-6">
          <h3 className="text-lg font-semibold mb-4">Kiosk</h3>
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <span>Free Play Mode</span>
              <input
                type="checkbox"
                checked={settings.freeplay}
                onChange={(e) => handleUpdate('freeplay', e.target.checked)}
                className="w-5 h-5"
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-2">Credits per Song</span>
              <input
                type="number"
                min="1"
                value={settings.coin_per_song}
                onChange={(e) => handleUpdate('coin_per_song', parseInt(e.target.value))}
                className="bg-gray-700 px-4 py-2 rounded"
              />
            </label>
            <label className="flex items-center justify-between">
              <span>Search Enabled</span>
              <input
                type="checkbox"
                checked={settings.search_enabled}
                onChange={(e) => handleUpdate('search_enabled', e.target.checked)}
                className="w-5 h-5"
              />
            </label>
          </div>
        </div>

        {/* Queue Limits */}
        <div className="border-t border-gray-700 pt-6">
          <h3 className="text-lg font-semibold mb-4">Queue Limits</h3>
          <div className="space-y-4">
            <label className="flex flex-col">
              <span className="mb-2">Max Queue Size</span>
              <input
                type="number"
                min="1"
                value={settings.max_queue_size}
                onChange={(e) => handleUpdate('max_queue_size', parseInt(e.target.value))}
                className="bg-gray-700 px-4 py-2 rounded"
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-2">Priority Queue Limit</span>
              <input
                type="number"
                min="1"
                value={settings.priority_queue_limit}
                onChange={(e) => handleUpdate('priority_queue_limit', parseInt(e.target.value))}
                className="bg-gray-700 px-4 py-2 rounded"
              />
            </label>
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
  const [severity, setSeverity] = useState<string>('all');

  useEffect(() => {
    loadLogs();
    const sub = subscribeToSystemLogs(PLAYER_ID, (log) => {
      setLogs((prev) => [log, ...prev].slice(0, 100)); // Keep last 100
    });
    return () => sub.unsubscribe();
  }, [severity]);

  const loadLogs = async () => {
    try {
      const { data } = await supabase
        .from('system_logs')
        .select('*')
        .eq('player_id', PLAYER_ID)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (data) setLogs(data);
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
  };

  const filteredLogs = severity === 'all' ? logs : logs.filter((log) => log.severity === severity);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">System Logs</h2>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="bg-gray-800 px-4 py-2 rounded"
        >
          <option value="all">All</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3 text-left">Severity</th>
                <th className="px-4 py-3 text-left">Event</th>
                <th className="px-4 py-3 text-left">Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id} className="border-t border-gray-700">
                  <td className="px-4 py-3 text-sm">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        log.severity === 'error'
                          ? 'bg-red-600'
                          : log.severity === 'warn'
                          ? 'bg-yellow-600'
                          : log.severity === 'info'
                          ? 'bg-blue-600'
                          : 'bg-gray-600'
                      }`}
                    >
                      {log.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">{log.event}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {JSON.stringify(log.payload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredLogs.length === 0 && (
          <div className="text-center text-gray-400 py-8">No logs to display</div>
        )}
      </div>
    </div>
  );
}

export default App;
