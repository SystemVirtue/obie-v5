// Obie Kiosk - Public Search & Request Interface
// Server-driven credit system and priority queue

import { useEffect, useRef, useState } from 'react';
import {
  subscribeToKioskSession,
  subscribeToPlayerSettings,
  subscribeToQueue,
  subscribeToPlayerStatus,
  subscribeToTable,
  callKioskHandler,
  getTotalCredits,
  updateAllCredits,
  supabase,
  type KioskSession,
  type PlayerSettings,
  type QueueItem,
  type PlayerStatus,
} from '@shared/supabase-client';
import { Coins } from 'lucide-react';
import { SearchInterface } from './components/SearchInterface';
import { SearchResult } from '../../shared/types';
import { BackgroundPlaylist, DEFAULT_BACKGROUND_ASSETS } from './components/BackgroundPlaylist';

const PLAYER_ID = '00000000-0000-0000-0000-000000000001'; // Default player

function App() {
  const [session, setSession] = useState<KioskSession | null>(null);
  const [settings, setSettings] = useState<PlayerSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(true);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [includeKaraoke, setIncludeKaraoke] = useState(false);

  // Coin acceptor connection state
  // const [coinAcceptorConnected, setCoinAcceptorConnected] = useState(false);
  // const [coinAcceptorDeviceId, setCoinAcceptorDeviceId] = useState<string | null>(null);
  
  // Serial connection refs
  const serialPortRef = useRef<any>(null);
  const serialReaderRef = useRef<any>(null);
  const connectionCheckIntervalRef = useRef<number | null>(null);

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

    // Subscribe to session updates (for credits) and to any kiosk_sessions changes for this player
    // Replace polling with realtime subscription: when any kiosk_sessions row for the player
    // changes, re-fetch the aggregated total credits and update local session state.
    useEffect(() => {
      if (!session) return;

      const sub = subscribeToKioskSession(session.session_id, (s) => {
        setSession(s);
      });

      const tableSub = subscribeToTable('kiosk_sessions', { column: 'player_id', value: PLAYER_ID }, async () => {
        try {
          const total = await getTotalCredits(PLAYER_ID);
          setSession(prev => prev ? { ...prev, credits: total } : prev);
        } catch (err) {
          console.error('Failed to fetch total credits after realtime event:', err);
        }
      });

      return () => {
        sub.unsubscribe();
        tableSub.unsubscribe();
      };
    }, [session?.session_id]);

    // Subscribe to player settings
    useEffect(() => {
      const sub = subscribeToPlayerSettings(PLAYER_ID, setSettings);
      return () => sub.unsubscribe();
    }, []);

    // Coin acceptor connection management
    useEffect(() => {
      if (!settings?.kiosk_coin_acceptor_enabled) {
        // Disconnect if currently connected
        disconnectCoinAcceptor();
        return;
      }

      // Attempt to connect to coin acceptor
      connectToCoinAcceptor();
    }, [settings?.kiosk_coin_acceptor_enabled]);

    // Subscribe to player status (now playing)
    useEffect(() => {
      const sub = subscribeToPlayerStatus(PLAYER_ID, (s) => setPlayerStatus(s));
      return () => sub.unsubscribe();
    }, []);

    // Subscribe to queue for marquee / upcoming list
    useEffect(() => {
      const sub = subscribeToQueue(PLAYER_ID, (items) => {
        // Filter out currently playing item
        const currentMediaId = playerStatus?.current_media_id || playerStatus?.current_media?.id || null;
        const upcomingItems = items.filter(item => item.media_item_id !== currentMediaId);
        
        // Separate priority and normal items
        const priorityItems = upcomingItems.filter(item => item.type === 'priority');
        const normalItems = upcomingItems.filter(item => item.type === 'normal');
        
        // Limit normal items to max 4 for marquee display
        const limitedNormalItems = normalItems.slice(0, 4);
        
        // Combine for display: all priority + up to 4 normal
        const displayItems = [...priorityItems, ...limitedNormalItems];
        
        setQueue(displayItems);
      });
      return () => sub.unsubscribe();
    }, [playerStatus?.current_media_id, playerStatus?.current_media?.id]);

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
        setShowSearchResults(true);
        setShowKeyboard(false);
      } catch (error) {
        console.error('Search failed:', error);
        setSearchResults([]);
        setShowSearchResults(false);
      } finally {
        setIsSearching(false);
      }
    };

    const handleSelectResult = (item: any) => {
      console.log('handleSelectResult called with:', item);
      setSelectedResult(item);
      setShowConfirm(true);
      console.log('showConfirm set to true, selectedResult set');
    };

    const handleConfirmAdd = async () => {
      if (!selectedResult || !session) return;

      try {
        // Call kiosk-handler request with URL, letting the handler scrape & enqueue atomically
        try {
          const res = await callKioskHandler({ session_id: session.session_id, action: 'request', url: selectedResult.url, player_id: PLAYER_ID });
          if (res?.error) {
            console.error('Server failed to enqueue request:', res.error);
          }
        } catch (err) {
          console.error('Failed to enqueue request via kiosk handler:', err);
        }

        // Close modal and reset
        setShowConfirm(false);
        setShowSearchResults(false);
        setShowKeyboard(true);
        setShowSearchModal(false);
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
    
    // Coin acceptor connection functions
    const connectToCoinAcceptor = async () => {
      try {
        // Check if Web Serial API is supported
        if (!('serial' in navigator)) {
          console.error('Web Serial API not supported');
          return;
        }

        // Request a port
        const port = await (navigator as any).serial.requestPort();
        serialPortRef.current = port;

        // Open the port
        await port.open({ baudRate: 9600 });

      console.log('Coin acceptor connected');
      // setCoinAcceptorConnected(true);
      // setCoinAcceptorDeviceId('usbserial-1420'); // Set the expected device ID      // Update database with connection status
      await (supabase as any)
        .from('player_settings')
        .update({
          kiosk_coin_acceptor_connected: true,
          kiosk_coin_acceptor_device_id: 'usbserial-1420'
        })
        .eq('id', 1);        // Start reading from the port
        const reader = port.readable?.getReader();
        if (reader) {
          serialReaderRef.current = reader;
          readCoinAcceptorData(reader);
        }

        // Start connection monitoring
        startConnectionMonitoring();

      } catch (error) {
      console.error('Failed to connect to coin acceptor:', error);
      // setCoinAcceptorConnected(false);
      // setCoinAcceptorDeviceId(null);
      }
    };

    const disconnectCoinAcceptor = async () => {
      try {
        if (serialReaderRef.current) {
          await serialReaderRef.current.cancel();
          serialReaderRef.current.releaseLock();
          serialReaderRef.current = null;
        }

        if (serialPortRef.current) {
          await serialPortRef.current.close();
          serialPortRef.current = null;
        }

      console.log('Coin acceptor disconnected');
      // setCoinAcceptorConnected(false);
      // setCoinAcceptorDeviceId(null);      // Update database with disconnection status
      await (supabase as any)
        .from('player_settings')
        .update({
          kiosk_coin_acceptor_connected: false,
          kiosk_coin_acceptor_device_id: null
        })
        .eq('id', 1);        // Stop connection monitoring
        stopConnectionMonitoring();

      } catch (error) {
        console.error('Failed to disconnect coin acceptor:', error);
      }
    };

    const readCoinAcceptorData = async (reader: any) => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          // Process coin detection data
          // Assuming the coin acceptor sends data when coins are inserted
          const data = new TextDecoder().decode(value);
          console.log('Coin acceptor data:', data);

          // For now, assume any data means a coin was inserted
          // In a real implementation, you'd parse the specific protocol
          if (data.trim()) {
            // Add credit when coin is detected
            await updateAllCredits(PLAYER_ID, 'add', 1);
            console.log('Credit added for coin insertion');
          }
        }
      } catch (error) {
        console.error('Error reading coin acceptor data:', error);
      }
    };

    const startConnectionMonitoring = () => {
      // Check connection every 60 seconds
      connectionCheckIntervalRef.current = window.setInterval(async () => {
        try {
          if (serialPortRef.current) {
            // Try to read from the port to check if it's still connected
            const reader = serialPortRef.current.readable?.getReader();
            if (reader) {
              try {
                await reader.read();
                reader.releaseLock();
              } catch (error) {
                // Connection lost
                console.log('Coin acceptor connection lost');
                await disconnectCoinAcceptor();
              }
            }
          }
        } catch (error) {
          console.error('Error checking coin acceptor connection:', error);
        }
      }, 60000); // 60 seconds
    };

    const stopConnectionMonitoring = () => {
      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
        connectionCheckIntervalRef.current = null;
      }
    };

    // Render UI (simplified, balanced JSX)
    return (
      <div className="min-h-screen bg-black text-white relative">
        {/* Background Playlist */}
        <BackgroundPlaylist
          assets={DEFAULT_BACKGROUND_ASSETS}
          fillScreen={true}
          fadeDuration={1}
        />

        <main className="mx-auto max-w-5xl p-6 relative z-10">
          {/* Credits Display - Top Right */}
          <div className="fixed top-4 right-4 z-20">
            <div className="bg-black/60 border-2 border-yellow-400 rounded-lg p-3 shadow-lg">
              <div className="flex items-center gap-2">
                <Coins className="text-yellow-300 h-6 w-6" />
                <div className="flex flex-col">
                  <p className="text-white text-sm font-bold">
                    {settings?.freeplay ? 'FREE PLAY' : 'CREDITS'}
                  </p>
                  {!settings?.freeplay && (
                    <p className="text-yellow-300 text-lg font-bold">
                      {session?.credits ?? 0}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Search Button - Lower Middle */}
          <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-20">
            <button
              onClick={() => setShowSearchModal(true)}
              className="w-80 h-16 text-xl font-bold bg-black/60 text-white shadow-lg border-4 border-yellow-400 rounded-lg transform hover:scale-105 transition-all duration-200"
              style={{ filter: "drop-shadow(-5px -5px 10px rgba(0,0,0,0.8))" }}
            >
              🎵 SEARCH FOR MUSIC 🎵
            </button>
          </div>

          {/* Search Modal */}
          <SearchInterface
            isOpen={showSearchModal}
            onClose={() => {
              setShowSearchModal(false);
              setShowKeyboard(true);
              setShowSearchResults(false);
              setSearchQuery('');
            }}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchResults={searchResults}
            isSearching={isSearching}
            showKeyboard={showKeyboard}
            showSearchResults={showSearchResults}
            onKeyboardInput={(key) => {
              if (key === 'CLEAR') {
                setSearchQuery('');
              } else if (key === 'SPACE') {
                setSearchQuery(prev => prev + ' ');
              } else if (key === 'BACKSPACE') {
                setSearchQuery(prev => prev.slice(0, -1));
              } else if (key === 'SEARCH') {
                performSearch(searchQuery);
              } else {
                setSearchQuery(prev => prev + key);
              }
            }}
            onVideoSelect={handleSelectResult}
            onBackToSearch={() => {
              setShowSearchResults(false);
              setShowKeyboard(true);
            }}
            mode={settings?.freeplay ? "FREEPLAY" : "PAID"}
            credits={session?.credits ?? 0}
            onInsufficientCredits={() => {
              // Handle insufficient credits - could show a message
              console.log('Insufficient credits');
            }}
            includeKaraoke={includeKaraoke}
            onIncludeKaraokeChange={setIncludeKaraoke}
            bypassCreditCheck={settings?.freeplay}
          />

          {/* Bottom marquee of upcoming songs */}
          <div className="fixed bottom-0 left-0 right-0 bg-black/90 border-t border-yellow-400/50 py-3 backdrop-blur-sm">
            <div className="mx-auto max-w-full overflow-hidden">
              <div className="marquee">
                <div className="marquee-track flex items-center whitespace-nowrap gap-8 text-yellow-400 font-semibold text-sm drop-shadow-lg">
                  {queue.length > 0 ? (
                    queue.map((q, index) => (
                      <div key={q.id} className="px-6 flex items-center gap-2">
                        {q.type === 'priority' && <span className="text-red-400 drop-shadow-lg">★</span>}
                        <span>{(q.media_item as any)?.title || 'Untitled'} - <span className="text-gray-300 drop-shadow-lg">{(q.media_item as any)?.artist?.replace(/\s*-\s*Topic$/i, '') || 'Unknown'}</span></span>
                        {q.type === 'priority' && index === queue.filter(item => item.type === 'priority').length - 1 && queue.some(item => item.type === 'normal') && <span className="text-gray-400 mx-4 drop-shadow-lg">•</span>}
                      </div>
                    ))
                  ) : (
                    <div className="px-6 drop-shadow-lg">Coming Up: No items</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Confirmation Dialog */}
          {(() => {
            console.log('Dialog render check - showConfirm:', showConfirm, 'selectedResult:', selectedResult);
            return showConfirm && selectedResult && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
                <div className="bg-yellow-50 text-black rounded-lg p-6 w-[520px]">
                  <div className="text-lg font-bold mb-2">Add song to Playlist?</div>
                  <div className="text-sm text-gray-700 mb-4">Confirm adding this song to your playlist for playback.</div>
                  <div className="flex gap-4 items-center">
                    <img src={selectedResult.thumbnail} className="w-20 h-20 object-cover rounded" />
                    <div>
                      <div className="font-semibold">{selectedResult.title}</div>
                      <div className="text-sm text-gray-700">{selectedResult.artist?.replace(/\s*-\s*Topic$/i, '')}</div>
                      <div className="text-sm text-gray-700 mt-2">Cost: 1 Credit</div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 mt-6">
                    <button onClick={() => setShowConfirm(false)} className="px-4 py-2 bg-red-100 rounded">No</button>
                    <button onClick={handleConfirmAdd} className="px-4 py-2 bg-green-600 text-white rounded">Yes</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Insert coin dev button (moved to avoid conflict with search button) */}
          {!settings?.freeplay && settings?.kiosk_show_virtual_coin_button && (
            <div className="fixed bottom-4 right-4 z-20">
              <button
                onClick={handleCoinInsert}
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold px-6 py-3 rounded-full shadow-lg transition-all flex items-center gap-3 drop-shadow-lg border-2 border-yellow-400"
              >
                <Coins size={18} />
                <span>Insert Coin</span>
              </button>
            </div>
          )}

        </main>
      </div>
    );
}

export default App;
