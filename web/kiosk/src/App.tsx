// Obie Kiosk - Public Search & Request Interface
// Server-driven credit system and priority queue

import { useEffect, useState, useCallback } from 'react';
import {
  subscribeToKioskSession,
  subscribeToPlayerSettings,
  callKioskHandler,
  type KioskSession,
  type PlayerSettings,
  type MediaItem,
} from '@shared/supabase-client';
import { Search, Coins, Music, Clock } from 'lucide-react';

const PLAYER_ID = '00000000-0000-0000-0000-000000000001'; // Default player

function App() {
  const [session, setSession] = useState<KioskSession | null>(null);
  const [settings, setSettings] = useState<PlayerSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);

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

  // Handle search
  const handleSearch = useCallback(async (query: string) => {
    if (!session || query.trim().length === 0) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const { results } = await callKioskHandler({
        session_id: session.session_id,
        action: 'search',
        query,
      });
      setSearchResults(results || []);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [session]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2) {
        handleSearch(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  // Handle song request
  const handleRequest = async (mediaItem: MediaItem) => {
    if (!session || !settings) return;

    // Check credits
    if (!settings.freeplay && session.credits < settings.coin_per_song) {
      setRequestStatus('⚠️ Insufficient credits! Insert coins.');
      setTimeout(() => setRequestStatus(null), 3000);
      return;
    }

    try {
      const { success, credits } = await callKioskHandler({
        session_id: session.session_id,
        action: 'request',
        media_item_id: mediaItem.id,
      });

      if (success) {
        setSession({ ...session, credits });
        setRequestStatus('✓ Song added to queue!');
        setTimeout(() => setRequestStatus(null), 3000);
        setSearchQuery('');
        setSearchResults([]);
      }
    } catch (error: any) {
      console.error('Request failed:', error);
      setRequestStatus(`❌ ${error.message || 'Request failed'}`);
      setTimeout(() => setRequestStatus(null), 3000);
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
      <div className="min-h-screen bg-gradient-to-br from-purple-900 to-blue-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div>
          <div className="text-2xl text-white">Initializing...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Header */}
      <header className="bg-black bg-opacity-50 backdrop-blur-sm px-8 py-6 border-b border-white border-opacity-20">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-white mb-1">
              {settings.branding.name || 'Obie Jukebox'}
            </h1>
            <p className="text-gray-300">Search and request your favorite songs</p>
          </div>

          {/* Credits Display */}
          <div className="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl px-8 py-4 border border-white border-opacity-20">
            <div className="flex items-center gap-3">
              <Coins size={32} className="text-yellow-400" />
              <div>
                <div className="text-sm text-gray-300">Credits</div>
                <div className="text-4xl font-bold text-white">{session.credits}</div>
              </div>
            </div>
            {!settings.freeplay && (
              <div className="text-xs text-gray-400 mt-2">
                {settings.coin_per_song} credit{settings.coin_per_song > 1 ? 's' : ''} per song
              </div>
            )}
            {settings.freeplay && (
              <div className="text-xs text-green-400 mt-2 font-semibold">FREE PLAY MODE</div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-8 py-8">
        {/* Search Bar */}
        <div className="mb-8">
          <div className="relative">
            <Search className="absolute left-6 top-1/2 transform -translate-y-1/2 text-gray-400" size={24} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for songs, artists, or albums..."
              className="w-full bg-white bg-opacity-10 backdrop-blur-lg text-white text-2xl pl-16 pr-6 py-6 rounded-2xl border border-white border-opacity-20 focus:outline-none focus:border-opacity-40 placeholder-gray-400"
              autoFocus
            />
          </div>
        </div>

        {/* Status Message */}
        {requestStatus && (
          <div className="mb-6 bg-white bg-opacity-20 backdrop-blur-lg rounded-xl px-6 py-4 text-center text-white text-xl font-semibold border border-white border-opacity-20">
            {requestStatus}
          </div>
        )}

        {/* Search Results */}
        {isSearching ? (
          <div className="text-center py-12">
            <div className="inline-block w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div>
            <div className="text-xl text-white">Searching...</div>
          </div>
        ) : searchResults.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {searchResults.map((item) => (
              <button
                key={item.id}
                onClick={() => handleRequest(item)}
                className="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 border border-white border-opacity-20 hover:bg-opacity-20 hover:border-opacity-40 transition-all transform hover:scale-105 text-left"
              >
                {item.thumbnail && (
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="w-full h-48 object-cover rounded-lg mb-4"
                  />
                )}
                <div className="flex items-start gap-3 mb-3">
                  <Music size={20} className="text-purple-400 mt-1 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-white mb-1 truncate">{item.title}</h3>
                    {item.artist && (
                      <p className="text-sm text-gray-300 truncate">{item.artist}</p>
                    )}
                  </div>
                </div>
                {item.duration && (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Clock size={16} />
                    <span>
                      {Math.floor(item.duration / 60)}:{String(item.duration % 60).padStart(2, '0')}
                    </span>
                  </div>
                )}
                <div className="mt-4 bg-purple-600 text-white rounded-lg py-2 text-center font-semibold">
                  Request Song
                </div>
              </button>
            ))}
          </div>
        ) : searchQuery.length >= 2 ? (
          <div className="text-center py-12">
            <Music size={64} className="mx-auto text-gray-500 mb-4" />
            <div className="text-xl text-gray-300">No results found</div>
            <div className="text-sm text-gray-500 mt-2">Try a different search term</div>
          </div>
        ) : (
          <div className="text-center py-12">
            <Search size={64} className="mx-auto text-gray-500 mb-4" />
            <div className="text-2xl text-white mb-2">Start searching...</div>
            <div className="text-gray-400">Type at least 2 characters to search</div>
          </div>
        )}
      </main>

      {/* Footer - Coin Insert (Dev Only) */}
      {!settings.freeplay && (
        <div className="fixed bottom-8 right-8">
          <button
            onClick={handleCoinInsert}
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold px-8 py-4 rounded-full shadow-2xl transform hover:scale-110 transition-all flex items-center gap-3"
          >
            <Coins size={24} />
            <span>Insert Coin (Dev)</span>
          </button>
        </div>
      )}

      {/* Watermark */}
      <div className="fixed bottom-4 left-4 text-xs text-gray-500">
        Powered by Obie Jukebox v2 | Session: {session.session_id.slice(0, 8)}
      </div>
    </div>
  );
}

export default App;
