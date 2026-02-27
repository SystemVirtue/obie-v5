// Obie Player - Thin Client for Media Playback
// Uses YouTube IFrame Player API for reliable event handling

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  supabase,
  subscribeToPlayerStatus,
  subscribeToPlayerSettings,
  callPlayerControl,
  callQueueManager,
  callPlaylistManager,
  initializePlayerPlaylist,
  type PlayerStatus,
  type MediaItem,
  type PlayerSettings,
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
  const [settings, setSettings] = useState<PlayerSettings | null>(null);
  const [isSlavePlayer, setIsSlavePlayer] = useState(false); // Track if this is a slave player
  const [playerReady, setPlayerReady] = useState(false); // Track if YouTube player is ready
  const [ytApiReady, setYtApiReady] = useState(false); // Track if YouTube API is loaded
  const playerRef = useRef<any>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);
  const currentMediaIdRef = useRef<string | null>(null);
  const fadeIntervalRef = useRef<number | null>(null);
  const isSkipLoadingRef = useRef(false); // Track if loading after skip
  const recentlyLoadedRef = useRef(false); // Track if video was recently loaded and should auto-play
  // Karaoke / lyrics refs
  const lyricsDataRef = useRef<Array<{ startTimeMs?: number; endTimeMs?: number; words: string }> | null>(null);
  const lyricsRafRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Fade out audio and opacity over 2 seconds
  const fadeOut = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (!playerRef.current || !playerDivRef.current) {
        resolve();
        return;
      }

      const startVolume = ((): number => {
        if (!playerRef.current) return 100;
        if (typeof playerRef.current.getVolume === 'function') return playerRef.current.getVolume();
        // HTMLMediaElement uses 0..1 volume
        if (typeof (playerRef.current as any).volume === 'number') return (playerRef.current as any).volume * 100;
        return 100;
      })();
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
          if (typeof playerRef.current.setVolume === 'function') {
            playerRef.current.setVolume(Math.max(0, newVolume));
          } else if (typeof (playerRef.current as any).volume === 'number') {
            (playerRef.current as any).volume = Math.max(0, Math.min(1, Math.max(0, newVolume) / 100));
          }
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
          if (typeof playerRef.current.setVolume === 'function') {
            playerRef.current.setVolume(Math.min(100, newVolume));
          } else if (typeof (playerRef.current as any).volume === 'number') {
            (playerRef.current as any).volume = Math.min(1, Math.max(0, Math.min(100, newVolume) / 100));
          }
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

  // Report playback events to server (disabled for slave players)
  const reportStatus = useCallback(async (state: PlayerStatus['state'], progress?: number) => {
    // Slave players do not send status updates to server
    if (isSlavePlayer) {
      console.log('[Slave Player] Skipping status report:', { state, progress });
      return;
    }

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
  }, [isSlavePlayer]);

  // Report video ended and trigger queue_next (disabled for slave players)
  const reportEndedAndNext = useCallback(async (isSkip = false) => {
    // Slave players do not trigger queue operations
    if (isSlavePlayer) {
      console.log('[Slave Player] Skipping ended/next report');
      return;
    }

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
        
        // Mark that video was recently loaded and should auto-play if it pauses unexpectedly
        recentlyLoadedRef.current = true;
        // Clear the flag after 5 seconds
        setTimeout(() => {
          recentlyLoadedRef.current = false;
        }, 5000);
        
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
      if (playerRef.current) {
        const currentVol = ((): number => {
          if (typeof playerRef.current.getVolume === 'function') return playerRef.current.getVolume();
          if (typeof (playerRef.current as any).volume === 'number') return (playerRef.current as any).volume * 100;
          return 100;
        })();
        if (currentVol === 0) {
          console.log('[Player] Auto-playing after skip - fading in...');
          fadeIn();
        }
      }
    } else if (event.data === 2) {
      // PAUSED
      console.log('[Player] Video PAUSED');
      reportStatus('paused');
      
      // If video was recently loaded and paused unexpectedly, attempt to auto-play
      if (recentlyLoadedRef.current && playerRef.current && typeof playerRef.current.playVideo === 'function') {
        console.log('[Player] Video paused unexpectedly after load, attempting auto-play...');
        try {
          playerRef.current.playVideo();
          // Clear the flag since we're attempting to play
          recentlyLoadedRef.current = false;
        } catch (error) {
          console.error('[Player] Error auto-playing video:', error);
        }
      }
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
          // Find queue item with this media_item_id (disabled for slave players)
          if (!isSlavePlayer) {
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
          }
          
          // Remove from all playlists via server function — no direct DB access from client
          if (!isSlavePlayer) {
            await callPlaylistManager({
              action: 'remove_media_globally',
              player_id: PLAYER_ID,
              media_item_id: unavailableMediaId,
            });
            console.log('[Player] Removed unavailable video from queue and playlists');
          }
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
        
        const result = await initializePlayerPlaylist(PLAYER_ID) as any;
        
        if (result?.success) {
          console.log('[Player] Playlist loaded:', {
            playlist_name: result.playlist_name,
            loaded_count: result.loaded_count
          });
        } else {
          console.warn('[Player] No playlist available');
        }

        // Register this player instance as a potential priority player
        const sessionId = crypto.randomUUID();
        
        // Check if this player was previously priority
        const storedPlayerId = localStorage.getItem('obie_priority_player_id');
        
        console.log('[Player] Registering session:', sessionId, 'stored_player_id:', storedPlayerId);
        
        const sessionResult = await callPlayerControl({
          player_id: PLAYER_ID,
          action: 'register_session',
          session_id: sessionId,
          stored_player_id: storedPlayerId || undefined,
        });

        // Store whether this player is a slave (not priority)
        setIsSlavePlayer(!sessionResult.is_priority);
        
        // If this player became priority, store its ID in localStorage
        if (sessionResult.is_priority) {
          localStorage.setItem('obie_priority_player_id', PLAYER_ID);
          console.log('[Player] Priority player ID stored in localStorage');
        } else if (storedPlayerId === PLAYER_ID) {
          // This player was previously priority but is no longer - clear localStorage
          localStorage.removeItem('obie_priority_player_id');
          console.log('[Player] Priority player ID removed from localStorage');
        }
        
        console.log('[Player] Session registered successfully, is_slave:', !sessionResult.is_priority, 'restored:', sessionResult.restored || false);
      } catch (error) {
        console.error('[Player] Failed to initialize:', error);
      }
    };

    initPlayer();
  }, []);

  // NOTE: Shuffle-on-load is handled entirely by the load_playlist RPC (migration 0028).
  // When a playlist is loaded, load_playlist reads player_settings.shuffle and, if enabled,
  // calls queue_shuffle which pins position 0 (Now Playing) and randomises positions 1+.
  // A client-side effect here would fire on settings-change rather than on playlist-load,
  // causing unexpected re-shuffles and potentially moving the currently playing item.

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
        
        // Mark that video was recently loaded and should auto-play if it pauses unexpectedly
        recentlyLoadedRef.current = true;
        // Clear the flag after 5 seconds
        setTimeout(() => {
          recentlyLoadedRef.current = false;
        }, 5000);
      } else {
        console.log('[Player] Same media in status update, not updating state');
      }
    });

    return () => {
      console.log('[Player] Unsubscribing from player status');
      subscription.unsubscribe();
    };
  }, [fadeIn, fadeOut, reportEndedAndNext]);

  // Subscribe to player settings (to watch karaoke_mode)
  useEffect(() => {
    const settingsSub = subscribeToPlayerSettings(PLAYER_ID, setSettings);
    return () => settingsSub.unsubscribe();
  }, []);

  // Fetch lyrics for a video/title using lrclib API (best-effort)
  async function fetchLyricsForMedia(title: string | undefined, artist?: string) {
    try {
      const track = encodeURIComponent(title || '');
      const artistName = encodeURIComponent(artist || '');
      const url = `https://lrclib.net/api/get?artist_name=${artistName}&track_name=${track}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();

      // data may contain syncedLyrics (array) or plainLyrics (string)
      if (Array.isArray(data?.syncedLyrics) && data.syncedLyrics.length > 0) {
        // normalize entries to have startTimeMs, endTimeMs, words
        return data.syncedLyrics.map((s: any) => ({ startTimeMs: s.startTimeMs, endTimeMs: s.endTimeMs, words: s.words }));
      }
      if (data?.plainLyrics) {
        return [{ words: data.plainLyrics }];
      }
    } catch (err) {
      console.warn('[Karaoke] fetchLyrics failed', err);
    }
    return null;
  }

  // Sync lyrics to player time
  const syncLyrics = useCallback(() => {
    try {
      if (!overlayRef.current || !playerRef.current || !lyricsDataRef.current) {
        lyricsRafRef.current = requestAnimationFrame(syncLyrics);
        return;
      }

      const player = playerRef.current;
      const timeMs = (player.getCurrentTime ? player.getCurrentTime() : 0) * 1000;
      const data = lyricsDataRef.current;

      // If it's unsynced (single entry with plain text), just display whole
      if (data.length === 1 && !data[0].startTimeMs) {
        overlayRef.current.innerHTML = `<div class="lyric-line">${escapeHtml(data[0].words)}</div>`;
      } else {
        const found = data.find((l) => (timeMs >= (l.startTimeMs || 0) && timeMs < (l.endTimeMs || Infinity)));
        if (found) {
          overlayRef.current.innerHTML = `<div class="lyric-line">${escapeHtml(found.words)}</div>`;
        }
      }

    } catch (err) {
      console.warn('[Karaoke] sync error', err);
    }
    lyricsRafRef.current = requestAnimationFrame(syncLyrics);
  }, []);

  function stopLyricsSync() {
    if (lyricsRafRef.current) {
      cancelAnimationFrame(lyricsRafRef.current);
      lyricsRafRef.current = null;
    }
    if (overlayRef.current) {
      overlayRef.current.style.display = 'none';
      overlayRef.current.innerHTML = '';
    }
    lyricsDataRef.current = null;
  }

  // Escape HTML content to avoid XSS when inserting lyrics
  function escapeHtml(s: string) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

  // Start lyrics when karaoke mode enabled and media available
  useEffect(() => {
    const karaokeOn = !!settings?.karaoke_mode;
    if (!karaokeOn) {
      stopLyricsSync();
      return;
    }

    // Ensure overlay element exists
    if (!overlayRef.current) {
      const el = document.createElement('div');
      el.id = 'lyrics-overlay';
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.right = '0';
      el.style.bottom = '8%';
      el.style.textAlign = 'center';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '60';
      el.style.display = 'none';
      el.className = 'text-white text-2xl drop-shadow-lg';
      // basic lyric-line style
      const style = document.createElement('style');
      style.innerHTML = `.lyric-line{background:rgba(0,0,0,0.5);display:inline-block;padding:8px 16px;border-radius:8px;}`;
      document.head.appendChild(style);
      overlayRef.current = el;
      // append into the root player container
      const container = document.querySelector('#root') || document.body;
      container.appendChild(el);
    }

    if (!currentMedia) return; // wait until media available

    // If we already have lyrics for this media id, reuse
    if (lyricsDataRef.current && currentMediaIdRef.current === currentMedia.id) {
      if (overlayRef.current) overlayRef.current.style.display = 'block';
      if (!lyricsRafRef.current) lyricsRafRef.current = requestAnimationFrame(syncLyrics);
      return;
    }

    // Fetch lyrics and start syncing
    (async () => {
      try {
        if (!currentMedia) return;
  const lyrics = await fetchLyricsForMedia(currentMedia.title, currentMedia.artist as any);
        if (!lyrics) {
          console.warn('[Karaoke] No lyrics found for', currentMedia.title);
          return;
        }
        lyricsDataRef.current = lyrics;
        currentMediaIdRef.current = currentMedia.id;
        if (overlayRef.current) overlayRef.current.style.display = 'block';
        if (!lyricsRafRef.current) lyricsRafRef.current = requestAnimationFrame(syncLyrics);
      } catch (err) {
        console.warn('[Karaoke] Failed to start lyrics', err);
      }
    })();

    return () => {
      // leave overlay shown if karaoke still on for other media; stop when karaoke disabled
    };
  }, [settings?.karaoke_mode, currentMedia, syncLyrics]);

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
        controls: 0,        // Hide controls to prevent accidental clicks
        disablekb: 1,       // Disable keyboard controls
        modestbranding: 1,  // Hide YouTube logo
        rel: 0,             // Don't show related videos
        iv_load_policy: 3,  // Hide annotations
        vq: 'auto',         // Set quality to auto (let YouTube choose best quality)
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

      {/* Click Prevention Overlay - Allows play when paused, blocks pause when playing */}
      <div
        className="absolute inset-0 w-full h-full cursor-default"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          // Allow clicking to PLAY when video is paused
          if (status?.state === 'paused' && playerRef.current && typeof playerRef.current.playVideo === 'function') {
            console.log('[Player] User clicked to PLAY paused video');
            try {
              playerRef.current.playVideo();
            } catch (error) {
              console.error('[Player] Error playing video:', error);
            }
            return false;
          }

          // Block all other clicks (including pause when playing)
          console.log('[Player] Click blocked - can only play when paused');
          return false;
        }}
        style={{ pointerEvents: 'auto' }}
      />

      {/* Obie Logo Overlay */}
      <img
        src="/Obie_neon_no_BG.png"
        alt="Obie Logo"
        className="absolute bottom-[40px] left-[20px] w-[8vw] h-auto pointer-events-none z-10"
        style={{ maxWidth: '160px', minWidth: '60px' }}
      />

      {/* Status Overlay (for debugging) - HIDDEN */}
      {/* 
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
      */}

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

      {/* Slave Player Debug Overlay */}
      {isSlavePlayer && (
        <div className="absolute bottom-0 left-0 right-0 flex justify-center items-end pb-4 pointer-events-none">
          <div className="text-5xl font-bold text-white opacity-50" style={{ fontFamily: 'Arial, sans-serif' }}>
            SLAVE
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
