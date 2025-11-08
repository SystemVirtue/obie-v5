// Obie Kiosk - Public Search & Request Interface
// Server-driven credit system and priority queue

import { useEffect, useState } from 'react';
import {
  subscribeToKioskSession,
  subscribeToPlayerSettings,
  subscribeToQueue,
  subscribeToPlayerStatus,
  callKioskHandler,
  type KioskSession,
  type PlayerSettings,
  type QueueItem,
  type PlayerStatus,
} from '@shared/supabase-client';
import { Search, Coins } from 'lucide-react';

const PLAYER_ID = '00000000-0000-0000-0000-000000000001'; // Default player

function App() {
  const [session, setSession] = useState<KioskSession | null>(null);
  const [settings, setSettings] = useState<PlayerSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      try {
        const { session: newSession } = await callKioskHandler({
          player_id: PLAYER_ID,
          action: 'init',
        });
        setSession(newSession);
      } catch (error) {
        console.error('Failed to initialize session:', error);
      }
    };

    initSession();
  }, []);

  // Subscribe to session updates (for credits)
  useEffect(() => {
    if (!session) return;

    const sub = subscribeToKioskSession(session.session_id, setSession);
    return () => sub.unsubscribe();
  }, [session?.session_id]);

  // Subscribe to player settings
  useEffect(() => {
    const sub = subscribeToPlayerSettings(PLAYER_ID, setSettings);
    return () => sub.unsubscribe();
  }, []);

  // Subscribe to player status (now playing)
  useEffect(() => {
    const sub = subscribeToPlayerStatus(PLAYER_ID, (s) => setPlayerStatus(s));
    return () => sub.unsubscribe();
  }, []);

  // Subscribe to queue for marquee / upcoming list
  useEffect(() => {
    const sub = subscribeToQueue(PLAYER_ID, (items) => setQueue(items));
    return () => sub.unsubscribe();
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2) {
        // TODO: Implement search
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Simulate coin insertion (for testing - replace with WebSerial API)
  const handleCoinInsert = async () => {
    if (!session) return;

    try {
      const { credits } = await callKioskHandler({
        session_id: session.session_id,
        action: 'credit',
        amount: 1,
      });
      setSession({ ...session, credits });
    } catch (error) {
      console.error('Failed to add credit:', error);
    }
  };

  if (!session || !settings) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mb-4"></div>
          <div className="text-2xl text-yellow-400">Initializing...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Top-left Now Playing pill */}
      <div className="absolute top-6 left-6">
        <div className="px-4 py-2 rounded-md border-2 border-yellow-400 text-sm font-semibold text-yellow-400 bg-black/40">
          Now Playing: {playerStatus?.current_media?.title ? `${playerStatus.current_media.title}${playerStatus.current_media.artist ? ' - ' + playerStatus.current_media.artist : ''}` : 'Nothing playing'}
        </div>
      </div>

      {/* Top-right credits pill */}
      <div className="absolute top-6 right-6">
        <div className="flex items-center gap-3 bg-yellow-400 text-black px-4 py-2 rounded-md font-bold">
          <div className="text-xs uppercase">Credits</div>
          <div className="text-2xl">{session.credits}</div>
        </div>
      </div>

      {/* Center big search button */}
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <button
            onClick={() => { setShowSearch(true); const el = document.getElementById('kiosk-search-input'); if (el) (el as HTMLInputElement).focus(); }}
            className="inline-flex items-center gap-4 border-2 border-yellow-400 text-yellow-400 px-10 py-6 rounded-lg text-2xl font-bold hover:bg-yellow-400/10 transition"
          >
            <span className="text-2xl">♫</span>
            Search for Music
            <span className="text-2xl">♫</span>
          </button>

          {/* Reveal search bar when requested */}
          {showSearch && (
            <div className="mt-8 px-6">
              <div className="relative w-[720px] mx-auto">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="kiosk-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for songs, artists, or albums..."
                  className="w-full bg-transparent text-white text-xl pl-12 pr-6 py-4 rounded-md border border-yellow-400/30 focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom marquee of upcoming songs */}
      <div className="absolute bottom-6 left-0 right-0">
        <div className="mx-auto max-w-full overflow-hidden">
          <div className="marquee">
            <div className="marquee-track flex items-center whitespace-nowrap gap-8 text-yellow-400 font-semibold text-sm">
              {queue.length > 0 ? (
                queue.map((q) => (
                  <div key={q.id} className="px-6">{(q.media_item as any)?.title || 'Untitled'}</div>
                ))
              ) : (
                <div className="px-6">Coming Up: No items</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Insert coin dev button (kept) */}
      {!settings.freeplay && (
        <div className="fixed bottom-24 right-8">
          <button
            onClick={handleCoinInsert}
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold px-6 py-3 rounded-full shadow-lg transition-all flex items-center gap-3"
          >
            <Coins size={18} />
            <span>Insert Coin</span>
          </button>
        </div>
      )}

      {/* Watermark small */}
      <div className="fixed bottom-2 left-4 text-xs text-gray-500">
        Powered by Obie Jukebox v2
      </div>
    </div>
  );
}

export default App;
