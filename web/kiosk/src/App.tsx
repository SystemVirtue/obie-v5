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
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

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
    const sub = subscribeToQueue(PLAYER_ID, (items) => {
      // items are ordered: priority (type desc) then normal by position asc
      const priorityItems = items.filter(i => i.type === 'priority');
      const normalItems = items.filter(i => i.type === 'normal');

      // Determine current playing media id from playerStatus
      const currentMediaId = playerStatus?.current_media_id || playerStatus?.current_media?.id || null;

      // Find index of current media within the normalItems list
      let currentIndexInNormal = -1;
      if (currentMediaId) {
        currentIndexInNormal = normalItems.findIndex(n => n.media_item_id === currentMediaId);
      }

      // If not found, fall back to now_playing_index if available
      if (currentIndexInNormal === -1 && typeof playerStatus?.now_playing_index === 'number') {
        // now_playing_index refers to overall queue index; compute an approximate offset into normalItems
        // We'll use min(now_playing_index, normalItems.length - 1)
        const idx = playerStatus!.now_playing_index;
        currentIndexInNormal = Math.min(Math.max(0, idx - priorityItems.length), normalItems.length - 1);
      }

      const start = Math.max(0, currentIndexInNormal + 1);
      const upcomingNormalItems = normalItems.slice(start, start + 3);

      const marqueeItems = [...priorityItems, ...upcomingNormalItems];
      setQueue(marqueeItems);
    });
    return () => sub.unsubscribe();
  }, [playerStatus?.now_playing_index]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2) {
        // perform a lightweight search preview (do not auto-open results)
        // We'll only perform a search when user presses SEARCH on the keyboard
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Perform search using youtube-scraper Edge Function
  const performSearch = async (query: string) => {
    try {
      setIsSearching(true);
      setSearchResults([]);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const resp = await fetch(`${supabaseUrl}/functions/v1/youtube-scraper`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ query, type: 'search' }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(errText || `Search failed: ${resp.status}`);
      }

      const { videos } = await resp.json();
      setSearchResults(videos || []);
      setShowResults(true);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
      setShowResults(false);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectResult = (item: any) => {
    setSelectedResult(item);
    setShowConfirm(true);
  };

  const handleConfirmAdd = async () => {
    if (!selectedResult || !session) return;

    try {
      // Ensure media_item exists by asking playlist-manager to scrape the URL
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // Call playlist-manager.scrape to insert media item(s)
      const resp = await fetch(`${supabaseUrl}/functions/v1/playlist-manager`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ action: 'scrape', url: selectedResult.url, player_id: PLAYER_ID }),
      });

      let mediaItemId: string | null = null;
      if (resp.ok) {
        const body = await resp.json();
        // playlist-manager returns media items inserted - try to get first id
        if (Array.isArray(body) && body.length && body[0].id) {
          mediaItemId = body[0].id;
        } else if (body.media_items && body.media_items.length) {
          mediaItemId = body.media_items[0].id;
        }
      }

      if (!mediaItemId) {
        console.error('Failed to obtain media_item id for selected result');
        setShowConfirm(false);
        return;
      }

      // Add to queue as priority via queue-manager
      await fetch(`${supabaseUrl}/functions/v1/queue-manager`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ player_id: PLAYER_ID, action: 'add', media_item_id: mediaItemId, type: 'priority', requested_by: session.session_id }),
      });

      // Close modal and reset
      setShowConfirm(false);
      setShowResults(false);
      setShowSearch(false);
      setSearchQuery('');
    } catch (error) {
      console.error('Failed to add request:', error);
      setShowConfirm(false);
    }
  };

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
        {settings.freeplay ? (
          <div className="flex items-center gap-3 bg-green-400 text-black px-4 py-2 rounded-md font-bold">
            <div className="text-xs uppercase">Free Play</div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-yellow-400 text-black px-4 py-2 rounded-md font-bold">
            <div className="text-xs uppercase">Credits</div>
            <div className="text-2xl">{session.credits}</div>
          </div>
        )}
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
                {/* On-screen keyboard */}
                <div className="mt-6 bg-gray-900/60 p-6 rounded-lg">
                  <div className="grid grid-cols-10 gap-3 max-w-full">
                    {['1','2','3','4','5','6','7','8','9','0'].map(k => (
                      <button key={k} onClick={() => setSearchQuery(s => s + k)} className="px-3 py-3 bg-gray-800 rounded shadow">{k}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-10 gap-3 mt-3">
                    {['Q','W','E','R','T','Y','U','I','O','P'].map(k => (
                      <button key={k} onClick={() => setSearchQuery(s => s + k)} className="px-3 py-3 bg-gray-800 rounded shadow">{k}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-9 gap-3 mt-3 ml-12">
                    {['A','S','D','F','G','H','J','K','L'].map(k => (
                      <button key={k} onClick={() => setSearchQuery(s => s + k)} className="px-3 py-3 bg-gray-800 rounded shadow">{k}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-3 mt-3 ml-24">
                    {['Z','X','C','V','B','N','M'].map(k => (
                      <button key={k} onClick={() => setSearchQuery(s => s + k)} className="px-3 py-3 bg-gray-800 rounded shadow">{k}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-4 justify-center">
                    <button onClick={() => setSearchQuery(s => s + ' ')} className="px-6 py-3 bg-gray-700 rounded shadow">SPACE</button>
                    <button onClick={() => setSearchQuery('')} className="px-6 py-3 bg-red-600 rounded text-white">CLEAR</button>
                    <button onClick={() => performSearch(searchQuery)} disabled={isSearching} className="px-6 py-3 bg-green-600 rounded text-white">
                      {isSearching ? 'SEARCHING...' : 'SEARCH'}
                    </button>
                  </div>
                </div>
                {/* Search Results Modal */}
                {showResults && (
                  <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
                    <div className="bg-[#071025] w-[900px] max-w-full p-6 rounded-lg shadow-xl">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-xl font-semibold text-yellow-400">Search Results</div>
                        <button onClick={() => { setShowResults(false); setSearchResults([]); }} className="text-white bg-red-600 px-3 py-1 rounded">X</button>
                      </div>
                      <div className="grid grid-cols-4 gap-4">
                        {searchResults.length > 0 ? searchResults.map((v) => (
                          <div key={v.id} onClick={() => handleSelectResult(v)} className="bg-gray-800 rounded overflow-hidden cursor-pointer hover:scale-105 transform transition">
                            <img src={v.thumbnail} alt={v.title} className="w-full h-32 object-cover" />
                            <div className="p-3">
                              <div className="font-semibold text-sm text-white truncate">{v.title}</div>
                              <div className="text-xs text-gray-300">{v.artist}</div>
                              <div className="text-xs text-gray-400 mt-2">{Math.floor((v.duration || 0) / 60)}:{String((v.duration || 0) % 60).padStart(2,'0')}</div>
                            </div>
                          </div>
                        )) : (
                          <div className="col-span-4 text-center text-gray-400">No results</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom marquee of upcoming songs */}
      <div className="fixed bottom-0 left-0 right-0 bg-black/80 border-t border-yellow-400/30 py-3">
        <div className="mx-auto max-w-full overflow-hidden">
          <div className="marquee">
            <div className="marquee-track flex items-center whitespace-nowrap gap-8 text-yellow-400 font-semibold text-sm">
              {queue.length > 0 ? (
                queue.map((q, index) => (
                  <div key={q.id} className="px-6 flex items-center gap-2">
                    {q.type === 'priority' && <span className="text-red-400">★</span>}
                    <span>{(q.media_item as any)?.title || 'Untitled'}</span>
                    {q.type === 'priority' && index === queue.filter(item => item.type === 'priority').length - 1 && queue.some(item => item.type === 'normal') && <span className="text-gray-400 mx-4">•</span>}
                  </div>
                ))
              ) : (
                <div className="px-6">Coming Up: No items</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirm && selectedResult && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60">
          <div className="bg-yellow-50 text-black rounded-lg p-6 w-[520px]">
            <div className="text-lg font-bold mb-2">Add song to Playlist?</div>
            <div className="text-sm text-gray-700 mb-4">Confirm adding this song to your playlist for playback.</div>
            <div className="flex gap-4 items-center">
              <img src={selectedResult.thumbnail} className="w-20 h-20 object-cover rounded" />
              <div>
                <div className="font-semibold">{selectedResult.title}</div>
                <div className="text-sm text-gray-700">{selectedResult.artist}</div>
                <div className="text-sm text-gray-700 mt-2">Cost: 1 Credit</div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 bg-red-100 rounded">No</button>
              <button onClick={handleConfirmAdd} className="px-4 py-2 bg-green-600 text-white rounded">Yes</button>
            </div>
          </div>
        </div>
      )}

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
