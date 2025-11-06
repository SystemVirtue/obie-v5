// Obie Player - Thin Client for Media Playback
// Only reports status, all logic runs on server

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  subscribeToPlayerStatus,
  callPlayerControl,
  initializePlayerPlaylist,
  type PlayerStatus,
  type MediaItem,
} from '@shared/supabase-client';

const PLAYER_ID = '00000000-0000-0000-0000-000000000001'; // Default player

// YouTube Player API types
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

function App() {
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [currentMedia, setCurrentMedia] = useState<MediaItem | null>(null);
  const [initStatus, setInitStatus] = useState<string>('initializing');
  const playerRef = useRef<any>(null); // YouTube Player instance
  const playerDivRef = useRef<HTMLDivElement>(null); // DOM element for player
  const hasInitialized = useRef(false);
  const currentMediaIdRef = useRef<string | null>(null);
  const ytApiReadyRef = useRef(false);

  // Initialize player with default playlist on mount
  useEffect(() => {
    const initPlayer = async () => {
      if (hasInitialized.current) return;
      hasInitialized.current = true;

      try {
        console.log('[Player] Initializing player with default playlist...');
        setInitStatus('loading_playlist');
        
        const result = await initializePlayerPlaylist(PLAYER_ID) as any;
        
        if (result?.success) {
          console.log('[Player] Playlist loaded:', {
            playlist_name: result.playlist_name,
            loaded_count: result.loaded_count
          });
          setInitStatus('ready');
        } else {
          console.warn('[Player] No playlist available');
          setInitStatus('no_playlist');
        }
      } catch (error) {
        console.error('[Player] Failed to initialize playlist:', error);
        setInitStatus('error');
      }
    };

    initPlayer();
  }, []);

  // Subscribe to player status from server
  useEffect(() => {
    const sub = subscribeToPlayerStatus(PLAYER_ID, (newStatus) => {
      console.log('[Player] Status update:', {
        state: newStatus.state,
        current_media_id: newStatus.current_media_id,
        progress: newStatus.progress,
        now_playing_index: newStatus.now_playing_index
      });
      
      setStatus(newStatus);
      
      // Update current media only if it actually changed
      if (newStatus.current_media) {
        const newMediaId = (newStatus.current_media as any).id;
        if (newMediaId !== currentMediaIdRef.current) {
          console.log('[Player] New media from status (CHANGED):', {
            old_id: currentMediaIdRef.current,
            new_id: newMediaId,
            title: (newStatus.current_media as any).title,
            artist: (newStatus.current_media as any).artist
          });
          setCurrentMedia(newStatus.current_media as any);
        } else {
          console.log('[Player] Same media in status update, not updating state');
        }
      }
    });

    return () => sub.unsubscribe();
  }, []);

  // Start heartbeat to keep player online
  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        await callPlayerControl({
          player_id: PLAYER_ID,
          action: 'heartbeat',
        });
      } catch (error) {
        console.error('Heartbeat failed:', error);
      }
    };

    // Send initial heartbeat
    sendHeartbeat();

    // Start interval
    heartbeatRef.current = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, []);

  // Handle iframe load - switch to new media
  useEffect(() => {
    if (!currentMedia || !iframeRef.current) return;

    // Check if this is actually a new media item (prevent reload loop)
    if (currentMediaIdRef.current === currentMedia.id) {
      console.log('[Player] Same media, skipping reload');
      return;
    }

    console.log('[Player] Loading NEW media:', {
      id: currentMedia.id,
      title: currentMedia.title,
      artist: currentMedia.artist,
      url: currentMedia.url
    });

    // Update the current media ID ref
    currentMediaIdRef.current = currentMedia.id;

    // Clear any pending auto-report timeout
    if (autoReportTimeoutRef.current) {
      clearTimeout(autoReportTimeoutRef.current);
    }

    // Update iframe src with YouTube embed URL
    const youtubeId = extractYouTubeId(currentMedia.url);
    if (youtubeId) {
      // Add parameters for YouTube iframe API:
      // - enablejsapi=1: Enable JavaScript API for events
      // - playsinline=1: Play inline on mobile
      // Note: No autoplay - user must click play button (browser policy)
      const embedUrl = `https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&playsinline=1`;
      console.log('[Player] Setting iframe src:', embedUrl);
      iframeRef.current.src = embedUrl;
      
      // After iframe loads, subscribe to YouTube events
      const handleIframeLoad = () => {
        console.log('[Player] Iframe loaded, subscribing to YouTube events');
        if (iframeRef.current) {
          // Subscribe to YouTube state change events
          iframeRef.current.contentWindow?.postMessage(
            '{"event":"listening","id":1}',
            '*'
          );
        }
      };
      
      iframeRef.current.addEventListener('load', handleIframeLoad, { once: true });
    }

    // Cleanup timeout on unmount
    return () => {
      if (autoReportTimeoutRef.current) {
        clearTimeout(autoReportTimeoutRef.current);
      }
    };
  }, [currentMedia]);

  // Report playback events to server
  const reportStatus = useCallback(async (state: PlayerStatus['state'], progress?: number) => {
    console.log('[Player] Reporting status:', { state, progress });
    try {
      await callPlayerControl({
        player_id: PLAYER_ID,
        state,
        progress,
        action: 'update',
      });
    } catch (error) {
      console.error('[Player] Failed to report status:', error);
    }
  }, []);

  // Report video ended and trigger queue_next
  const reportEndedAndNext = useCallback(async () => {
    console.log('[Player] Video ended - triggering queue_next');
    try {
      const result = await callPlayerControl({
        player_id: PLAYER_ID,
        state: 'idle',
        progress: 1,
        action: 'ended', // This triggers queue_next in the backend
      });
      console.log('[Player] Queue_next result:', result);
    } catch (error) {
      console.error('[Player] Failed to call queue_next:', error);
    }
  }, []);

  // Listen to YouTube iframe API messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // YouTube iframe API sends postMessage events
      if (event.origin !== 'https://www.youtube.com') return;

      try {
        const data = JSON.parse(event.data);
        
        // Only log important events, not every infoDelivery
        if (data.event !== 'infoDelivery' && data.event !== 'apiInfoDelivery') {
          console.log('[Player] YouTube iframe message:', data);
        }
        
        switch (data.event) {
          case 'onStateChange':
            console.log('[Player] YouTube state change:', data.info);
            if (data.info === 1) {
              // Playing
              console.log('[Player] Video is playing, reporting to server');
              reportStatus('playing');
            } else if (data.info === 2) {
              // Paused
              console.log('[Player] Video paused, reporting to server');
              reportStatus('paused');
            } else if (data.info === 0) {
              // Ended - THIS is critical for queue progression
              console.log('[Player] Video ENDED, calling queue_next via server');
              reportEndedAndNext();
            }
            break;

          case 'infoDelivery':
            // Handle progress updates from infoDelivery (throttled)
            if (data.info?.currentTime && data.info?.duration) {
              const progress = data.info.currentTime / data.info.duration;
              // Only report progress every 5 seconds to reduce server calls
              const currentTime = Math.floor(data.info.currentTime);
              if (currentTime % 5 === 0) {
                reportStatus('playing', progress);
              }
            }
            break;
        }
      } catch (e) {
        // Ignore parse errors from non-JSON messages
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [reportStatus, reportEndedAndNext]);

  // Sync player state with server commands
  useEffect(() => {
    if (!status || !iframeRef.current) return;

    const iframe = iframeRef.current;
    
    // Send commands to YouTube iframe
    if (status.state === 'playing') {
      iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
    } else if (status.state === 'paused') {
      iframe.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    }
  }, [status?.state]);

  return (
    <div className="relative w-screen h-screen bg-black">
      {/* Fullscreen Video Player */}
      <iframe
        ref={iframeRef}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="YouTube Player"
      />

      {/* Status Overlay (for debugging) */}
      <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white p-4 rounded-lg text-sm font-mono max-w-md" style={{ zIndex: 20 }}>
        <div className="mb-2">
          <span className="text-gray-400">Init:</span>{' '}
          <span className={`font-bold ${initStatus === 'ready' ? 'text-green-400' : initStatus === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
            {initStatus}
          </span>
        </div>
        <div className="mb-2">
          <span className="text-gray-400">Status:</span>{' '}
          <span className={`font-bold ${status?.state === 'playing' ? 'text-green-400' : 'text-yellow-400'}`}>
            {status?.state || 'initializing'}
          </span>
        </div>
        {currentMedia && (
          <>
            <div className="mb-1 text-gray-300 truncate">{currentMedia.title}</div>
            <div className="text-gray-500 text-xs truncate">{currentMedia.artist}</div>
          </>
        )}
        <div className="mt-2 text-xs text-gray-500">
          Progress: {Math.round((status?.progress || 0) * 100)}%
        </div>
        {status && (
          <div className="mt-1 text-xs text-gray-600">
            Index: {status.now_playing_index} | Media: {status.current_media_id?.slice(0, 8)}...
          </div>
        )}
      </div>

      {/* Idle State */}
      {status?.state === 'idle' && !currentMedia && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
          <div className="text-center">
            <div className="text-6xl font-bold text-white mb-4">Obie Jukebox</div>
            <div className="text-xl text-gray-400">Waiting for next song...</div>
            <div className="mt-8">
              <div className="inline-block w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {status?.state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-90">
          <div className="text-center">
            <div className="inline-block w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <div className="text-2xl text-white">Loading...</div>
          </div>
        </div>
      )}

      {/* Error State */}
      {status?.state === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900 bg-opacity-50">
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-4">⚠️ Playback Error</div>
            <div className="text-lg text-gray-200">Check logs for details</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to extract YouTube video ID from URL
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export default App;
