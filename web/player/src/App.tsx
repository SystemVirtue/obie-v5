// Obie Player - Thin Client for Media Playback
// Uses YouTube IFrame Player API for reliable event handling

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  supabase,
  subscribeToPlayerStatus,
  callPlayerControl,
  callQueueManager,
  initializePlayerPlaylist,
  type PlayerStatus,
  type MediaItem,
} from '@shared/supabase-client';

const PLAYER_ID = '00000000-0000-0000-0000-000000000001';

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
  const [playerReady, setPlayerReady] = useState(false); // Track if YouTube player is ready
  const [ytApiReady, setYtApiReady] = useState(false); // Track if YouTube API is loaded
  const playerRef = useRef<any>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);
  const currentMediaIdRef = useRef<string | null>(null);
  const fadeIntervalRef = useRef<number | null>(null);
  const isSkipLoadingRef = useRef(false); // Track if loading after skip

  // Fade out audio and opacity over 2 seconds
  const fadeOut = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (!playerRef.current || !playerDivRef.current) {
        resolve();
        return;
      }

      const startVolume = playerRef.current.getVolume();
      const startOpacity = 1;
      const duration = 2000; // 2 seconds
      const steps = 60; // 60 fps
      const stepDuration = duration / steps;
      let currentStep = 0;

      // Clear any existing fade
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }

      fadeIntervalRef.current = window.setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;
        const newVolume = startVolume * (1 - progress);
        const newOpacity = startOpacity * (1 - progress);

        if (playerRef.current) {
          playerRef.current.setVolume(Math.max(0, newVolume));
        }
        if (playerDivRef.current) {
          playerDivRef.current.style.opacity = String(Math.max(0, newOpacity));
        }

        if (currentStep >= steps) {
          if (fadeIntervalRef.current) {
            clearInterval(fadeIntervalRef.current);
            fadeIntervalRef.current = null;
          }
          resolve();
        }
      }, stepDuration);
    });
  }, []);

  // Fade in audio and opacity over 2 seconds
  const fadeIn = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (!playerRef.current || !playerDivRef.current) {
        resolve();
        return;
      }

      const targetVolume = 100; // Can be made configurable later
      const targetOpacity = 1;
      const duration = 2000; // 2 seconds
      const steps = 60; // 60 fps
      const stepDuration = duration / steps;
      let currentStep = 0;

      // Clear any existing fade
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }

      fadeIntervalRef.current = window.setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;
        const newVolume = targetVolume * progress;
        const newOpacity = targetOpacity * progress;

        if (playerRef.current) {
          playerRef.current.setVolume(Math.min(100, newVolume));
        }
        if (playerDivRef.current) {
          playerDivRef.current.style.opacity = String(Math.min(1, newOpacity));
        }

        if (currentStep >= steps) {
          if (fadeIntervalRef.current) {
            clearInterval(fadeIntervalRef.current);
            fadeIntervalRef.current = null;
          }
          resolve();
        }
      }, stepDuration);
    });
  }, []);

  // Extract YouTube video ID from URL
  const extractYouTubeId = (url: string): string | null => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match ? match[1] : null;
  };

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
  const reportEndedAndNext = useCallback(async (isSkip = false) => {
    console.log(isSkip ? '[Player] Video SKIPPED - triggering queue_next' : '[Player] Video ENDED - triggering queue_next');
    
    // Fade out if this is a skip
    if (isSkip) {
      await fadeOut();
      // Don't set skip loading flag - we'll fade back in immediately after loading
    }
    
    try {
      const result = await callPlayerControl({
        player_id: PLAYER_ID,
        state: 'idle',
        progress: 1,
        action: 'ended', // Always use 'ended' after fade completes to trigger queue_next
      });
      console.log('[Player] Queue_next full result:', JSON.stringify(result, null, 2));
      
      // Load the next video immediately from the result
      if (result?.next_item) {
        console.log('[Player] Next item data:', {
          media_item_id: result.next_item.media_item_id,
          title: result.next_item.title,
          url: result.next_item.url,
          duration: result.next_item.duration
        });
        
        const nextMedia: MediaItem = {
          id: result.next_item.media_item_id,
          title: result.next_item.title || 'Unknown',
          artist: 'Unknown',
          url: result.next_item.url,
          duration: result.next_item.duration || 0,
          source_id: '',
          source_type: 'youtube',
          thumbnail: null,
          fetched_at: new Date().toISOString(),
          metadata: {},
        };
        console.log('[Player] Loading next media from queue_next result:', nextMedia);
        
        // If this was a skip, mark it so we can fade in when video starts
        if (isSkip) {
          isSkipLoadingRef.current = true;
        }
        
        setCurrentMedia(nextMedia);
        
        // For normal end: restore opacity immediately
        if (!isSkip && playerDivRef.current) {
          playerDivRef.current.style.opacity = '1';
        }
      } else {
        console.log('[Player] No more items in queue - result:', result);
        setCurrentMedia(null);
      }
    } catch (error) {
      console.error('[Player] Failed to call queue_next:', error);
    }
  }, [fadeOut]);

  // YouTube Player event handlers
  const onPlayerReady = useCallback((_event: any) => {
    console.log('[Player] YouTube player ready - waiting for user to press play');
    setPlayerReady(true); // Mark player as ready to hide loading overlay
    // Don't report status here - let user click play first
    // Reporting 'idle' here causes the backend to think video ended and skip to next
  }, []);

  const onPlayerStateChange = useCallback((event: any) => {
    console.log('[Player] YouTube state change:', event.data);
    
    // YouTube Player States:
    // -1 = UNSTARTED
    // 0 = ENDED
    // 1 = PLAYING
    // 2 = PAUSED
    // 3 = BUFFERING
    // 5 = CUED
    
    if (event.data === 1) {
      // PLAYING
      console.log('[Player] Video PLAYING');
      reportStatus('playing');
      
      // If we're at volume 0 (after skip), fade in
      if (playerRef.current && playerRef.current.getVolume() === 0) {
        console.log('[Player] Auto-playing after skip - fading in...');
        fadeIn();
      }
    } else if (event.data === 2) {
      // PAUSED
      console.log('[Player] Video PAUSED');
      reportStatus('paused');
    } else if (event.data === 0) {
      // ENDED - trigger queue progression
      console.log('[Player] Video ENDED - calling queue_next');
      reportEndedAndNext();
    } else if (event.data === 3) {
      // BUFFERING
      console.log('[Player] Video BUFFERING');
      reportStatus('loading');
    }
  }, [reportStatus, reportEndedAndNext, fadeIn]);

  // Handle playback errors (unavailable videos, embedding disabled, etc.)
  const onPlayerError = useCallback(async (event: any) => {
    console.error('[Player] YouTube player error:', event.data);
    
    // Error codes:
    // 2 = Invalid parameter
    // 5 = HTML5 player error  
    // 100 = Video not found or private
    // 101 = Embedding not allowed by owner
    // 150 = Same as 101
    
    if (event.data === 101 || event.data === 150 || event.data === 100) {
      console.error('[Player] Video unavailable (embedding disabled or not found) - auto-skipping and removing from playlist');
      
      // Get current media ID before skipping
      const unavailableMediaId = currentMediaIdRef.current;
      
      // Remove from queue
      if (unavailableMediaId) {
        try {
          // Find queue item with this media_item_id
          const { data: queueItem, error: queueError } = await supabase
            .from('queue')
            .select('id')
            .eq('media_item_id', unavailableMediaId)
            .eq('player_id', PLAYER_ID)
            .maybeSingle();
          
          if (!queueError && queueItem) {
            // Remove from queue
            await callQueueManager({
              player_id: PLAYER_ID,
              action: 'remove',
              queue_id: (queueItem as { id: string }).id,
            });
          }
          
          // Delete from playlist_items if it exists
          await supabase
            .from('playlist_items')
            .delete()
            .eq('media_item_id', unavailableMediaId);
          
          console.log('[Player] Removed unavailable video from queue and playlists');
        } catch (error) {
          console.error('[Player] Failed to remove unavailable video:', error);
        }
      }
      
      // Skip to next video
      await reportEndedAndNext(false); // Don't fade, just skip immediately
    } else {
      console.error('[Player] Unhandled player error, skipping to next');
      await reportEndedAndNext(false);
    }
  }, [reportEndedAndNext]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (ytApiReady) return;

    console.log('[Player] Loading YouTube IFrame API...');

    // Load the IFrame Player API code asynchronously
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    // API will call this function when ready
    window.onYouTubeIframeAPIReady = () => {
      console.log('[Player] YouTube IFrame API ready');
      setYtApiReady(true);
    };
  }, [ytApiReady]);

  // Initialize player with default playlist
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

  // Subscribe to player_status updates from Supabase
  useEffect(() => {
    console.log('[Player] Subscribing to player status...');
    const prevStateRef = { current: status?.state };
    
    const subscription = subscribeToPlayerStatus(PLAYER_ID, async (newStatus) => {
      console.log('[Player] Status update:', newStatus);
      const prevState = prevStateRef.current;
      const newState = newStatus.state;
      
      // Handle state transitions with fades
      if (playerRef.current && prevState !== newState) {
        // SKIP: Admin set state to 'idle' while video was playing
        if (newState === 'idle' && (prevState === 'playing' || prevState === 'paused')) {
          console.log('[Player] Skip detected from Admin - triggering fade and skip');
          await reportEndedAndNext(true); // Skip with fade
          prevStateRef.current = newState;
          setStatus(newStatus);
          return; // Exit early, don't process other state changes
        }
        
        if (newState === 'paused' && prevState === 'playing') {
          // Fade out when pausing
          console.log('[Player] Pausing - fading out...');
          await fadeOut();
          playerRef.current.pauseVideo();
        } else if (newState === 'playing' && prevState === 'paused') {
          // Fade in when resuming
          console.log('[Player] Resuming - fading in...');
          playerRef.current.playVideo();
          await fadeIn();
        }
      }
      
      prevStateRef.current = newState;
      setStatus(newStatus);

      // Check if current_media changed
      const newMediaId = newStatus.current_media_id;
      const oldMediaId = currentMediaIdRef.current;

      if (newMediaId && newMediaId !== oldMediaId) {
        console.log('[Player] New media from status (CHANGED):', {
          old_id: oldMediaId,
          new_id: newMediaId,
          title: newStatus.current_media?.title,
          artist: newStatus.current_media?.artist
        });
        setCurrentMedia(newStatus.current_media || null);
      } else {
        console.log('[Player] Same media in status update, not updating state');
      }
    });

    return () => {
      console.log('[Player] Unsubscribing from player status');
      subscription.unsubscribe();
    };
  }, [fadeIn, fadeOut, reportEndedAndNext]);

  // Create or update YouTube player when media changes
  useEffect(() => {
    if (!currentMedia || !ytApiReady || !playerDivRef.current) return;

    // Check if this is actually a new media item
    if (currentMediaIdRef.current === currentMedia.id) {
      console.log('[Player] Same media, skipping player update');
      return;
    }

    console.log('[Player] Loading NEW media:', {
      id: currentMedia.id,
      title: currentMedia.title,
      artist: currentMedia.artist,
      url: currentMedia.url
    });

    const youtubeId = extractYouTubeId(currentMedia.url);
    if (!youtubeId) {
      console.error('[Player] Could not extract YouTube ID from:', currentMedia.url);
      return;
    }

    // If player already exists, just load the new video
    if (playerRef.current && playerRef.current.loadVideoById) {
      console.log('[Player] Loading new video in existing player:', youtubeId);
      currentMediaIdRef.current = currentMedia.id;
      
      // Check if this is loading after a skip
      const isAfterSkip = isSkipLoadingRef.current;
      
      if (isAfterSkip) {
        // After skip: start with volume 0 and opacity 0, then immediately fade in
        console.log('[Player] Loading after skip - will fade in on play');
        if (playerDivRef.current) {
          playerDivRef.current.style.opacity = '0';
        }
        playerRef.current.setVolume(0);
        isSkipLoadingRef.current = false; // Reset flag
        
        // Load and explicitly play video (will trigger fade-in when playing state is detected)
        playerRef.current.loadVideoById(youtubeId);
        // Ensure playback starts
        setTimeout(() => {
          if (playerRef.current && playerRef.current.playVideo) {
            console.log('[Player] Explicitly calling playVideo() after skip load');
            playerRef.current.playVideo();
          }
        }, 500);
      } else {
        // Normal load: restore volume and opacity
        if (playerDivRef.current) {
          playerDivRef.current.style.opacity = '1';
        }
        playerRef.current.setVolume(100);
        
        // loadVideoById and explicitly play
        playerRef.current.loadVideoById(youtubeId);
        // Ensure playback starts
        setTimeout(() => {
          if (playerRef.current && playerRef.current.playVideo) {
            console.log('[Player] Explicitly calling playVideo() after normal load');
            playerRef.current.playVideo();
          }
        }, 500);
      }
      return;
    }

    // First time setup - create new player
    currentMediaIdRef.current = currentMedia.id;
    setPlayerReady(false);

    console.log('[Player] Creating YouTube player for video:', youtubeId);
    playerRef.current = new window.YT.Player(playerDivRef.current, {
      videoId: youtubeId,
      playerVars: {
        autoplay: 0,        // Don't autoplay on first load (browser policy)
        controls: 1,        // Show controls
        modestbranding: 1,  // Hide YouTube logo
        rel: 0,             // Don't show related videos
        iv_load_policy: 3,  // Hide annotations
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  }, [currentMedia, ytApiReady, onPlayerReady, onPlayerStateChange, onPlayerError]);

  // Sync player state with server commands
  useEffect(() => {
    if (!status || !playerRef.current || !playerRef.current.playVideo) return;

    const player = playerRef.current;
    
    // Send commands to YouTube player based on server state
    if (status.state === 'playing') {
      player.playVideo();
    } else if (status.state === 'paused') {
      player.pauseVideo();
    }
  }, [status?.state]);

  return (
    <div className="relative w-screen h-screen bg-black">
      {/* YouTube Player Container */}
      <div 
        ref={playerDivRef}
        id="player"
        className="w-full h-full"
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
      {(status?.state === 'loading' && !playerReady) && (
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

export default App;
