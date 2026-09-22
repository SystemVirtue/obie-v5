// Obie Player - Thin Client for Media Playback
// Uses YouTube IFrame Player API for reliable event handling

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  supabase,
  subscribeToAdminBroadcasts,
  subscribeToPlayerStatus,
  subscribeToPlayerSettings,
  subscribeToPlayerEndpoint,
  callPlayerControl,
  callQueueManager,
  callPlaylistManager,
  initializePlayerPlaylist,
  type PlayerStatus,
  type MediaItem,
  type PlayerSettings,
  type PlayerEndpoint,
  type AdminBroadcast,
} from '@shared/supabase-client';

const PLAYER_ID = '00000000-0000-0000-0000-000000000001';
const YOUTUBE_EMBED_HOST = 'https://www.youtube-nocookie.com';

// ── YTM Desktop Companion ────────────────────────────────────────────────────
const YTM_BASE = 'http://localhost:9863';
const YTM_APP_ID = 'obie-jukebox';
const getYtmToken = () => localStorage.getItem('ytm_auth_token');
const saveYtmToken = (token: string) => localStorage.setItem('ytm_auth_token', token);
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

async function ytmFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getYtmToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = token; // YTM hashes the raw token — no "Bearer" prefix
  return fetch(`${YTM_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
  });
}

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
  const [identifyUntil, setIdentifyUntil] = useState<number | null>(null);
  const [currentEndpointId, setCurrentEndpointId] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [refreshPrompt, setRefreshPrompt] = useState<AdminBroadcast | null>(null);
  const [playerReady, setPlayerReady] = useState(false); // Track if YouTube player is ready
  const [ytApiReady, setYtApiReady] = useState(false); // Track if YouTube API is loaded
  const playerRef = useRef<any>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<PlayerStatus | null>(null);
  const hasInitialized = useRef(false);
  const currentMediaIdRef = useRef<string | null>(null);
  const endpointIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const playerSessionStartedAtRef = useRef(new Date().toISOString());
  const shouldAutoplayCurrentMediaRef = useRef(false);
  const consecutiveHeartbeatFailuresRef = useRef(0);
  const fadeIntervalRef = useRef<number | null>(null);
  const isSkipLoadingRef = useRef(false); // Track if loading after skip
  const recentlyLoadedRef = useRef(false); // Track if video was recently loaded and should auto-play
  const mediaLoadStartedAtRef = useRef(0); // Timestamp of the current YouTube media load/startup window
  const ignoreEndedUntilRef = useRef(0); // Ignore YouTube ENDED events until this timestamp for the current load
  const firstPlayAtRef = useRef(0); // Timestamp of the first confirmed PLAYING state for the current load
  const isEndingRef = useRef(false); // In-flight guard: prevents double queue_next from concurrent calls
  const isAdminSkipStoppingRef = useRef(false);
  const loadingTimeoutRef = useRef<number | null>(null); // Timeout to skip if status stays in 'loading' for 4+ seconds
  const videoHasPlayedRef = useRef(false); // true once current video reaches YouTube state PLAYING; reset on new media
  const unexpectedPauseTimeoutRef = useRef<number | null>(null); // Timeout to auto-advance if paused before video ever played
  const lastPlaybackFailureKeyRef = useRef<string | null>(null);
  const lastRecoveryKeyRef = useRef<string | null>(null);
  const lastSuppressedPauseKeyRef = useRef<string | null>(null);
  //const lastStaleLocalClearKeyRef = useRef<string | null>(null);
  const skipRestoreVolumeRef = useRef<number | null>(null);
  const skipRestorePendingRef = useRef(false);
  const skipFadePromiseRef = useRef<Promise<void> | null>(null);
  // ── Local video fallback (yt-dlp) ──────────────────────────────────────────
  const [localPlaybackUrl, setLocalPlaybackUrl] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localAudioContextRef = useRef<AudioContext | null>(null);
  const localAudioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const localAudioElementRef = useRef<HTMLVideoElement | null>(null);
  const localWaveformRef = useRef<Uint8Array | null>(null);
  const silenceStartedAtRef = useRef<number | null>(null);
  const silenceTriggeredForRef = useRef<string | null>(null);
  // Tracks the YouTube ID of the currently-loaded video (legacy reference, kept for potential future use)
  const currentYouTubeIdRef = useRef<string | null>(null);
  const localVideoLastReportRef = useRef<number>(0); // Throttle local video progress reports
  const localPlaybackUrlRef = useRef<string | null>(null); // Mirror of localPlaybackUrl for use inside callbacks
  // Karaoke / lyrics refs
  const lyricsDataRef = useRef<Array<{ startTimeMs?: number; endTimeMs?: number; words: string }> | null>(null);
  const lyricsMediaIdRef = useRef<string | null>(null);
  const lyricsRafRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // YTM Desktop state
  const [ytmConnected, setYtmConnected] = useState(false);
  const [ytmError, setYtmError] = useState<string | null>(null);
  const [ytmNowPlaying, setYtmNowPlaying] = useState<{ title: string; artist: string; thumbnail: string } | null>(null);
  const [ytmAuthStep, setYtmAuthStep] = useState<'idle' | 'requesting' | 'waiting' | 'authorized'>('idle');
  const [ytmAuthCode, setYtmAuthCode] = useState<string | null>(null);
  const [ytmToken, setYtmToken] = useState<string | null>(() => localStorage.getItem('ytm_auth_token'));
  const ytmSocketRef = useRef<any>(null);
  const ytmCurrentVideoIdRef = useRef<string | null>(null);
  const ytmPlayingReportedRef = useRef(false);       // guard: report 'playing' once per video
  const ytmTrackStateRef = useRef<number | null>(null); // previous YTM trackState for transition detection
  const ytmAdminPausedRef = useRef(false);           // true while a Supabase-admin pause is in flight
  const playerModeRef = useRef<'iframe' | 'ytm_desktop'>('iframe');
  const [ytmTestResult, setYtmTestResult] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [ytmTestMsg, setYtmTestMsg] = useState<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    playerSessionStartedAtRef.current = new Date().toISOString();
    const sub = subscribeToAdminBroadcasts((broadcast) => {
      if (broadcast.event_type !== 'refresh_prompt') return;
      setRefreshPrompt(broadcast);
    }, playerSessionStartedAtRef.current);

    return () => { sub.unsubscribe(); };
  }, []);

  const clampVolume = (volume: number) => Math.max(0, Math.min(100, volume));

  const getConfiguredVolume = useCallback(() => {
    return clampVolume(settings?.volume ?? 100);
  }, [settings?.volume]);

  const getActivePlaybackVolume = useCallback((): number => {
    if (localPlaybackUrlRef.current && localVideoRef.current) {
      return clampVolume(localVideoRef.current.volume * 100);
    }
    if (playerRef.current) {
      if (typeof playerRef.current.getVolume === 'function') return clampVolume(playerRef.current.getVolume());
      if (typeof (playerRef.current as any).volume === 'number') return clampVolume((playerRef.current as any).volume * 100);
    }
    return getConfiguredVolume();
  }, [getConfiguredVolume]);

  const setActivePlaybackVolume = useCallback((volume: number) => {
    const nextVolume = clampVolume(volume);

    if (localVideoRef.current) {
      localVideoRef.current.volume = nextVolume / 100;
    }
    if (playerRef.current) {
      if (typeof playerRef.current.setVolume === 'function') {
        playerRef.current.setVolume(nextVolume);
      } else if (typeof (playerRef.current as any).volume === 'number') {
        (playerRef.current as any).volume = nextVolume / 100;
      }
    }
    if (playerModeRef.current === 'ytm_desktop') {
      ytmFetch('/api/v1/command', {
        method: 'POST',
        body: JSON.stringify({ command: 'setVolume', data: Math.round(nextVolume) }),
      }).catch(() => {});
    }
  }, []);

  const setPlaybackOpacity = useCallback((opacity: number) => {
    const nextOpacity = Math.max(0, Math.min(1, opacity));
    if (playerDivRef.current) {
      playerDivRef.current.style.opacity = String(nextOpacity);
    }
    if (localVideoRef.current) {
      localVideoRef.current.style.opacity = String(nextOpacity);
    }
  }, []);

  const clearYouTubeMount = useCallback(() => {
    if (playerDivRef.current) {
      playerDivRef.current.replaceChildren();
    }
  }, []);

  const destroyYouTubePlayer = useCallback((reason: string) => {
    const player = playerRef.current;
    playerRef.current = null;

    if (player) {
      try {
        player.destroy?.();
      } catch (error) {
        console.warn('[Player] Failed to destroy YouTube player cleanly:', { reason, error });
      }
    }

    setPlayerReady(false);
    clearYouTubeMount();
  }, [clearYouTubeMount]);

  const createYouTubeMount = useCallback(() => {
    if (!playerDivRef.current) return null;
    clearYouTubeMount();
    const mount = document.createElement('div');
    mount.dataset.youtubeMount = 'true';
    playerDivRef.current.appendChild(mount);
    return mount;
  }, [clearYouTubeMount]);

  const setYouTubeIframePermissions = useCallback((target?: any) => {
    const iframe =
      target?.getIframe?.() ??
      playerRef.current?.getIframe?.() ??
      playerDivRef.current?.querySelector('iframe');

    if (!(iframe instanceof HTMLIFrameElement)) return;

    const allowedFeatures = new Set(
      (iframe.getAttribute('allow') || '')
        .split(';')
        .map(feature => feature.trim())
        .filter(Boolean)
    );

    [
      'accelerometer',
      'autoplay',
      'clipboard-write',
      'encrypted-media',
      'gyroscope',
      'picture-in-picture',
      'web-share',
      'compute-pressure',
    ].forEach(feature => allowedFeatures.add(feature));

    iframe.setAttribute('allow', Array.from(allowedFeatures).join('; '));
  }, []);

  // Fade out audio and opacity over 2 seconds
  const fadeOut = useCallback((fromVolume?: number): Promise<void> => {
    return new Promise((resolve) => {
      const startVolume = clampVolume(fromVolume ?? getActivePlaybackVolume());
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

        setActivePlaybackVolume(newVolume);
        setPlaybackOpacity(newOpacity);

        if (currentStep >= steps) {
          if (fadeIntervalRef.current) {
            clearInterval(fadeIntervalRef.current);
            fadeIntervalRef.current = null;
          }
          resolve();
        }
      }, stepDuration);
    });
  }, [getActivePlaybackVolume, setActivePlaybackVolume, setPlaybackOpacity]);

  // Endpoint heartbeat — all connected players send this so the admin console
  // has an accurate real-time roster. The backend only updates the canonical
  // player heartbeat when the calling endpoint currently owns master.
  const recoverHeartbeatSession = useCallback(async () => {
    const endpointId = endpointIdRef.current;
    const sessionId = sessionIdRef.current;
    if (!endpointId || !sessionId) return false;

    const result = await callPlayerControl({
      player_id: PLAYER_ID,
      action: 'register_session',
      session_id: sessionId,
      endpoint_id: endpointId,
      stored_player_id: localStorage.getItem('obie_priority_player_id') || undefined,
      stored_endpoint_id: localStorage.getItem('obie_priority_endpoint_id') || undefined,
      origin: window.location.origin,
      user_agent: navigator.userAgent,
      initiator: 'player_client',
      reason: 'heartbeat_recovery',
    });

    setIsSlavePlayer(!result?.is_priority);
    return true;
  }, []);

  useEffect(() => {
    if (!endpointIdRef.current || !sessionIdRef.current) return;

    let cancelled = false;
    const sendHeartbeat = async () => {
      try {
        const result = await callPlayerControl({
          player_id: PLAYER_ID,
          action: 'heartbeat',
          endpoint_id: endpointIdRef.current ?? undefined,
          session_id: sessionIdRef.current ?? undefined,
        });
        if (result?.success === false) {
          if (result?.ignored && result?.reason === 'stale_session') {
            console.warn('[Player] Heartbeat session is stale; re-registering endpoint session', {
              endpoint_id: endpointIdRef.current,
            });
            await recoverHeartbeatSession();
          } else {
            throw new Error(result?.reason || 'heartbeat_rejected');
          }
        }
        consecutiveHeartbeatFailuresRef.current = 0;
      } catch (error) {
        if (!cancelled) {
          consecutiveHeartbeatFailuresRef.current += 1;
          const failures = consecutiveHeartbeatFailuresRef.current;
          const logMethod = failures === 1 || failures % 12 === 0 ? console.warn : console.debug;
          logMethod('[Player] Heartbeat failed:', {
            failures,
            message: error instanceof Error ? error.message : JSON.stringify(error),
          });
        }
      }
    };

    sendHeartbeat();
    const interval = window.setInterval(sendHeartbeat, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentEndpointId, currentSessionId, isSlavePlayer, recoverHeartbeatSession]);

  // YTM Desktop skip fade: step volume 100→0 over 2s via setVolume commands
  const fadeOutYtm = useCallback((fromVolume?: number): Promise<void> => {
    return new Promise((resolve) => {
      const steps = 10;
      const stepDuration = 2000 / steps; // 200ms per step
      let currentStep = 0;
      const startVolume = clampVolume(fromVolume ?? getConfiguredVolume());
      const interval = window.setInterval(() => {
        currentStep++;
        const vol = Math.round(startVolume * (1 - currentStep / steps));
        ytmFetch('/api/v1/command', {
          method: 'POST',
          body: JSON.stringify({ command: 'setVolume', data: vol }),
        }).catch(() => {});
        if (currentStep >= steps) {
          clearInterval(interval);
          resolve();
        }
      }, stepDuration);
    });
  }, [getConfiguredVolume]);

  // Fade in audio and opacity over 2 seconds
  const fadeIn = useCallback((toVolume?: number): Promise<void> => {
    return new Promise((resolve) => {
      const startVolume = getActivePlaybackVolume();
      const targetVolume = clampVolume(toVolume ?? skipRestoreVolumeRef.current ?? getConfiguredVolume());
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
        const newVolume = startVolume + (targetVolume - startVolume) * progress;
        const newOpacity = targetOpacity * progress;

        setActivePlaybackVolume(newVolume);
        setPlaybackOpacity(newOpacity);

        if (currentStep >= steps) {
          if (fadeIntervalRef.current) {
            clearInterval(fadeIntervalRef.current);
            fadeIntervalRef.current = null;
          }
          resolve();
        }
      }, stepDuration);
    });
  }, [getActivePlaybackVolume, getConfiguredVolume, setActivePlaybackVolume, setPlaybackOpacity]);

  const restorePlaybackAfterSkip = useCallback((fade = true) => {
    const targetVolume = clampVolume(skipRestoreVolumeRef.current ?? getConfiguredVolume());
    skipRestorePendingRef.current = false;
    skipRestoreVolumeRef.current = null;

    if (fade) {
      fadeIn(targetVolume).catch(() => {
        setActivePlaybackVolume(targetVolume);
        setPlaybackOpacity(1);
      });
    } else {
      setActivePlaybackVolume(targetVolume);
      setPlaybackOpacity(1);
    }
  }, [fadeIn, getConfiguredVolume, setActivePlaybackVolume, setPlaybackOpacity]);

  const stopSkippedPlaybackAfterFade = useCallback(() => {
    if (skipFadePromiseRef.current) return skipFadePromiseRef.current;

    isEndingRef.current = true;
    isAdminSkipStoppingRef.current = true;
    isSkipLoadingRef.current = true;
    const restoreVolume = getActivePlaybackVolume();
    skipRestoreVolumeRef.current = restoreVolume > 0 ? restoreVolume : getConfiguredVolume();
    skipRestorePendingRef.current = true;

    skipFadePromiseRef.current = fadeOut(skipRestoreVolumeRef.current)
      .catch(() => {})
      .then(() => {
        try {
          if (localVideoRef.current) {
            localVideoRef.current.pause();
            localVideoRef.current.removeAttribute('src');
            localVideoRef.current.load();
          }
          destroyYouTubePlayer('skip fade completed');
        } catch (error) {
          console.warn('[Player] Failed to stop skipped playback after fade:', error);
        }
      })
      .finally(() => {
        skipFadePromiseRef.current = null;
        isAdminSkipStoppingRef.current = false;
        window.setTimeout(() => {
          if (!skipFadePromiseRef.current) {
            isEndingRef.current = false;
          }
        }, 2000);
      });

    return skipFadePromiseRef.current;
  }, [destroyYouTubePlayer, fadeOut, getActivePlaybackVolume, getConfiguredVolume]);

  const markYouTubeLoadStart = useCallback(() => {
    const now = Date.now();
    videoHasPlayedRef.current = false;
    firstPlayAtRef.current = 0;
    mediaLoadStartedAtRef.current = now;
    ignoreEndedUntilRef.current = now + 4000;
    lastPlaybackFailureKeyRef.current = null;
    lastRecoveryKeyRef.current = null;
    lastSuppressedPauseKeyRef.current = null;
  }, []);

  // Extract YouTube video ID from URL
  const extractYouTubeId = (url: string): string | null => {
    if (!url) return null;
    const match = url.match(
      /(?:youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/|youtube\.com\/shorts\/|youtu\.be\/)([^&?\s/]+)/
    );
    return match ? match[1] : null;
  };

  const isYouTubePlaybackUrl = useCallback((url: string | null | undefined): boolean => {
    if (!url) return false;
    return extractYouTubeId(url) !== null;
  }, []);

  const getPlaybackSourceLabel = useCallback(() => {
    if (localPlaybackUrlRef.current) return status?.source ?? 'local';
    return status?.source ?? 'youtube';
  }, [status?.source]);

  const resetSilenceTracking = useCallback((resetTriggered = false) => {
    silenceStartedAtRef.current = null;
    if (resetTriggered) silenceTriggeredForRef.current = null;
  }, []);

  const teardownLocalAudioAnalyser = useCallback(() => {
    localAudioSourceRef.current?.disconnect();
    localAnalyserRef.current?.disconnect();
    localAudioSourceRef.current = null;
    localAnalyserRef.current = null;
    localAudioElementRef.current = null;
    localWaveformRef.current = null;
    if (localAudioContextRef.current) {
      localAudioContextRef.current.close().catch(() => {});
      localAudioContextRef.current = null;
    }
  }, []);

  const ensureLocalAudioAnalyser = useCallback(async () => {
    if (!settings?.silence_skip_enabled) return false;
    const video = localVideoRef.current;
    if (!video) return false;

    if (localAudioElementRef.current === video && localAnalyserRef.current && localWaveformRef.current) {
      if (localAudioContextRef.current?.state === 'suspended') {
        await localAudioContextRef.current.resume().catch(() => {});
      }
      return true;
    }

    teardownLocalAudioAnalyser();

    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return false;

    const audioContext = new AudioContextCtor();
    const sourceNode = audioContext.createMediaElementSource(video);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;

    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);

    localAudioContextRef.current = audioContext;
    localAudioSourceRef.current = sourceNode;
    localAnalyserRef.current = analyser;
    localAudioElementRef.current = video;
    localWaveformRef.current = new Uint8Array(analyser.fftSize);

    await audioContext.resume().catch(() => {});
    return true;
  }, [settings?.silence_skip_enabled, teardownLocalAudioAnalyser]);

  const logPlayerEvent = useCallback(async (
    eventName: string,
    severity: 'debug' | 'info' | 'warn' | 'error' = 'info',
    details: Record<string, unknown> = {},
    reason?: string,
  ) => {
    try {
      await callPlayerControl({
        player_id: PLAYER_ID,
        action: 'client_log',
        session_id: sessionIdRef.current ?? undefined,
        endpoint_id: endpointIdRef.current ?? undefined,
        initiator: 'player_client',
        event_name: eventName,
        severity,
        reason,
        payload: details,
      });
    } catch (error) {
      console.error('[Player] Failed to write system log:', eventName, error);
    }
  }, []);

  const reportPlaybackFailure = useCallback(async (
    reason: string,
    details: Record<string, unknown> = {},
  ) => {
    const mediaId = currentMediaIdRef.current;
    const youtubeId = currentYouTubeIdRef.current;
    const key = `${mediaId ?? 'none'}:${reason}:${String(details.error_code ?? '')}`;
    if (lastPlaybackFailureKeyRef.current === key) {
      console.warn('[Player] Duplicate playback failure suppressed:', { reason, mediaId, youtubeId });
      return;
    }
    lastPlaybackFailureKeyRef.current = key;

    try {
      await callPlayerControl({
        player_id: PLAYER_ID,
        action: 'playback_failed',
        session_id: sessionIdRef.current ?? undefined,
        endpoint_id: endpointIdRef.current ?? undefined,
        initiator: 'player_client',
        event_name: 'playback_failed',
        reason,
        payload: {
          media_item_id: mediaId,
          youtube_id: youtubeId,
          playback_source: getPlaybackSourceLabel(),
          endpoint_id: endpointIdRef.current,
          session_id: sessionIdRef.current,
          ...details,
        },
      });
    } catch (error) {
      console.error('[Player] Failed to report playback failure:', error);
    }
  }, [getPlaybackSourceLabel]);

  // Report playback events to server (disabled for slave players)
  const reportStatus = useCallback(async (state: PlayerStatus['state'], progress?: number) => {
    // Slave players do not send status updates to server
    if (isSlavePlayer) {
      console.log('[Slave Player] Skipping status report:', { state, progress });
      return;
    }
    if (!endpointIdRef.current || !sessionIdRef.current) {
      console.debug('[Player] Status report skipped until endpoint/session registration is ready', { state, progress });
      return;
    }

    console.log('[Player] Reporting status:', { state, progress });
    try {
      await callPlayerControl({
        player_id: PLAYER_ID,
        state,
        progress,
        action: 'update',
        expected_media_id: currentMediaIdRef.current ?? undefined,
        session_id: sessionIdRef.current ?? undefined,
        endpoint_id: endpointIdRef.current ?? undefined,
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
    if (!endpointIdRef.current || !sessionIdRef.current) {
      console.warn('[Player] Ignoring ended/skip until endpoint/session registration is ready');
      return;
    }

    // Prevent concurrent calls: natural end + status subscription can both fire simultaneously.
    // The primary guard is server-side (player-control skips the intermediate state='idle' write),
    // but this ref provides belt-and-suspenders protection.
    //
    // isEndingRef stays true for 1000ms AFTER the queue_next call completes (see finally block).
    // This covers a race where player-control writing progress=1 to player_status fires a
    // second Realtime event with state='idle' that arrives after the first call returns —
    // the 1s cooldown absorbs that bounce window and prevents a double queue_next.
    if (isEndingRef.current) {
      console.log('[Player] End/skip cooldown active, ignoring duplicate trigger');
      return;
    }
    isEndingRef.current = true;
    const expectedMediaId = currentMediaIdRef.current;

    console.log(isSkip ? '[Player] Video SKIPPED - triggering queue_next' : '[Player] Video ENDED - triggering queue_next');

    // Fade out if this is a skip
    if (isSkip) {
      const restoreVolume = getActivePlaybackVolume();
      skipRestoreVolumeRef.current = restoreVolume > 0 ? restoreVolume : getConfiguredVolume();
      skipRestorePendingRef.current = true;
      if (playerModeRef.current === 'ytm_desktop') {
        // YTM Desktop: fade volume to 0 and pause. Restore when the next item starts.
        await fadeOutYtm(skipRestoreVolumeRef.current);
        await ytmFetch('/api/v1/command', { method: 'POST', body: JSON.stringify({ command: 'pause' }) }).catch(() => {});
      } else {
        await fadeOut(skipRestoreVolumeRef.current);
      }

      try {
        if (localVideoRef.current) {
          localVideoRef.current.pause();
          localVideoRef.current.removeAttribute('src');
          localVideoRef.current.load();
        }
        destroyYouTubePlayer('skip command completed');
      } catch (error) {
        console.warn('[Player] Failed to stop skipped playback cleanly:', error);
      }
    }

    try {
      const result = await callPlayerControl({
        player_id: PLAYER_ID,
        state: 'idle',
        progress: 1,
        expected_media_id: expectedMediaId ?? undefined,
        session_id: sessionIdRef.current ?? undefined,
        endpoint_id: endpointIdRef.current ?? undefined,
        action: 'ended', // Always use 'ended' after fade completes to trigger queue_next
      });
      console.log('[Player] Queue_next full result:', JSON.stringify(result, null, 2));
      
      // Load the next video immediately from the result
      if (result?.next_item) {
        console.log('[Player] Next item data:', {
          media_item_id: result.next_item.media_item_id,
          title: result.next_item.title,
          url: result.next_item.url,
          duration: result.next_item.duration,
          endpoint_id: endpointIdRef.current,
          session_id: sessionIdRef.current,
        });

        // Switch playback modes immediately from the queue_next result instead of
        // waiting for a follow-up realtime update to do it for us.
        if (isYouTubePlaybackUrl(result.next_item.url)) {
          if (localPlaybackUrlRef.current) {
            console.log('[Player] queue_next result is YouTube — clearing local/Cloudflare mode immediately');
            setLocalPlaybackUrl(null);
            localPlaybackUrlRef.current = null;
            try {
              localVideoRef.current?.pause();
              localVideoRef.current?.removeAttribute('src');
              localVideoRef.current?.load();
            } catch (error) {
              console.warn('[Player] Failed to tear down local video before YouTube handoff:', error);
            }
            teardownLocalAudioAnalyser();
          }
        } else if (result.next_item.url && result.next_item.url !== localPlaybackUrlRef.current) {
          console.log('[Player] queue_next result is local/Cloudflare — activating <video> immediately');
          localPlaybackUrlRef.current = result.next_item.url;
          setLocalPlaybackUrl(result.next_item.url);
        }
        
        const nextMediaId =
          result.next_item.media_item_id ??
          result.next_item.id ??
          result.next_item.current_media_id ??
          null;

        if (!nextMediaId || !result.next_item.url) {
          console.error('[Player] Invalid next_item from queue_next:', result.next_item);
          return;
        }

        const nextItemIsYouTube = isYouTubePlaybackUrl(result.next_item.url);

        const nextMedia: MediaItem = {
          id: nextMediaId,
          title: result.next_item.title || 'Unknown',
          artist: result.next_item.artist || 'Unknown',
          url: result.next_item.url,
          duration: result.next_item.duration || 0,
          source_id: result.next_item.source_id || '',
          source_type: result.next_item.source_type || (nextItemIsYouTube ? 'youtube' : 'cloudflare'),
          thumbnail: result.next_item.thumbnail || null,
          fetched_at: new Date().toISOString(),
          metadata: result.next_item.metadata || {},
        };
        console.log('[Player] Loading next media from queue_next result:', nextMedia);
        
        // If this was a skip, mark it so we can fade in when video starts
        if (isSkip) {
          isSkipLoadingRef.current = true;
        }

        if (nextMedia.id !== expectedMediaId) {
          currentMediaIdRef.current = null;
          currentYouTubeIdRef.current = null;
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
        const { data: latestStatus, error: latestStatusError } = await supabase
          .from('player_status')
          .select('*, current_media:media_items(*)')
          .eq('player_id', PLAYER_ID)
          .single();

        const latest = latestStatus as PlayerStatus | null;
        if (!latestStatusError && latest?.current_media_id && latest.current_media_id !== expectedMediaId) {
          console.log('[Player] Queue advance response had no next_item; using latest player_status instead:', {
            expected_media_id: expectedMediaId,
            current_media_id: latest.current_media_id,
            title: latest.current_media?.title,
            source: latest.source,
          });

          shouldAutoplayCurrentMediaRef.current = latest.state === 'playing' || latest.state === 'loading';
          setStatus(latest);

          const latestPlaybackUrl = latest.local_url || latest.current_media?.url || null;
          const latestMediaIsYouTube = isYouTubePlaybackUrl(latestPlaybackUrl);
          if ((latest.source === 'local' || latest.source === 'cloudflare') && latestPlaybackUrl && !latestMediaIsYouTube) {
            localPlaybackUrlRef.current = latestPlaybackUrl;
            setLocalPlaybackUrl(latestPlaybackUrl);
          } else if (localPlaybackUrlRef.current) {
            setLocalPlaybackUrl(null);
            localPlaybackUrlRef.current = null;
            try {
              localVideoRef.current?.pause();
              localVideoRef.current?.removeAttribute('src');
              localVideoRef.current?.load();
            } catch (error) {
              console.warn('[Player] Failed to tear down local video before status recovery handoff:', error);
            }
            teardownLocalAudioAnalyser();
          }

          const latestMediaForState = latest.current_media
            ? {
                ...latest.current_media,
                url:
                  (latest.source === 'local' || latest.source === 'cloudflare') && latestPlaybackUrl
                    ? latestPlaybackUrl
                    : latest.current_media.url,
                source_type:
                  latest.current_media.source_type ||
                  ((latest.source === 'local' || latest.source === 'cloudflare') ? 'cloudflare' : 'youtube'),
              }
            : null;
          setCurrentMedia(latestMediaForState);
          if (latest.current_media_id !== expectedMediaId) {
            currentMediaIdRef.current = null;
            currentYouTubeIdRef.current = null;
            isSkipLoadingRef.current = isSkip;
          }
          recentlyLoadedRef.current = true;
          setTimeout(() => {
            recentlyLoadedRef.current = false;
          }, 5000);
          return;
        }

        console.log('[Player] No more items in queue - result:', result);
        setCurrentMedia(null);
        if (isSkip && skipRestorePendingRef.current) {
          restorePlaybackAfterSkip(false);
        }
      }
    } catch (error) {
      logPlayerEvent('queue_advance_failed', 'error', {
        is_skip: isSkip,
        message: error instanceof Error ? error.message : String(error),
      }, 'queue_next_failed').catch(() => {});
      console.error('[Player] Failed to call queue_next:', error);
      if (isSkip && skipRestorePendingRef.current) {
        restorePlaybackAfterSkip(false);
      }
    } finally {
      // Hold the guard for 1000ms after completion.
      // A second Realtime state='idle' event (caused by the progress=1 write in player-control)
      // can arrive right after the first call returns. Without this cooldown, prevStateRef
      // still shows 'playing' (updated only after the await resolves), so the subscription
      // would trigger a second reportEndedAndNext and a second queue_next, skipping a song.
      setTimeout(() => {
        isEndingRef.current = false;
      }, 1000);
    }
  }, [destroyYouTubePlayer, fadeOut, fadeOutYtm, getActivePlaybackVolume, getConfiguredVolume, isSlavePlayer, isYouTubePlaybackUrl, logPlayerEvent, restorePlaybackAfterSkip, teardownLocalAudioAnalyser]);

  const evaluateTailSilence = useCallback(() => {
    if (!settings?.silence_skip_enabled) return;
    const video = localVideoRef.current;
    const analyser = localAnalyserRef.current;
    const waveform = localWaveformRef.current;
    if (!video || !analyser || !waveform) return;
    if (!isFinite(video.duration) || video.duration <= 0) return;
    if (video.paused || video.ended || status?.state === 'paused') {
      resetSilenceTracking(false);
      return;
    }

    const tailWindowSeconds = settings.silence_skip_tail_seconds ?? 20;
    if (video.duration - video.currentTime > tailWindowSeconds) {
      resetSilenceTracking(false);
      return;
    }

    analyser.getByteTimeDomainData(waveform as any);
    let sumSquares = 0;
    for (let i = 0; i < waveform.length; i++) {
      const normalized = (waveform[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / waveform.length);
    const threshold = settings.silence_skip_threshold ?? 0.01;
    const now = Date.now();

    if (rms < threshold) {
      if (silenceStartedAtRef.current === null) {
        silenceStartedAtRef.current = now;
        return;
      }

      const silenceDurationMs = now - silenceStartedAtRef.current;
      const requiredDurationMs = settings.silence_skip_duration_ms ?? 3000;
      const currentMediaId = currentMediaIdRef.current;
      if (silenceDurationMs >= requiredDurationMs && currentMediaId && silenceTriggeredForRef.current !== currentMediaId) {
        silenceTriggeredForRef.current = currentMediaId;
        console.log('[Player][silence-skip] Tail silence detected — triggering queue_next', {
          currentTime: video.currentTime,
          duration: video.duration,
          rms,
          threshold,
          silenceDurationMs,
        });
        callPlayerControl({
          player_id: PLAYER_ID,
          action: 'client_log',
          initiator: 'player_client',
          event_name: 'tail_silence_detected',
          severity: 'warn',
          reason: 'cloudflare_tail_silence',
          payload: {
            current_time: video.currentTime,
            duration: video.duration,
            silence_duration_ms: silenceDurationMs,
            threshold,
            rms,
          },
        }).catch(() => {});
        reportEndedAndNext(false);
      }
      return;
    }

    resetSilenceTracking(false);
  }, [
    settings?.silence_skip_enabled,
    settings?.silence_skip_tail_seconds,
    settings?.silence_skip_duration_ms,
    settings?.silence_skip_threshold,
    status?.state,
    reportEndedAndNext,
    resetSilenceTracking,
  ]);

  // YouTube Player event handlers
  const onPlayerReady = useCallback((event: any) => {
    setYouTubeIframePermissions(event?.target);
    console.log('[Player] YouTube player ready - waiting for user to press play');
    setPlayerReady(true); // Mark player as ready to hide loading overlay
    if (shouldAutoplayCurrentMediaRef.current && playerRef.current?.playVideo) {
      console.log('[Player] Existing playback detected on connect — auto-starting loaded video');
      setTimeout(() => {
        try {
          playerRef.current?.playVideo();
        } catch (error) {
          console.error('[Player] Failed to auto-play existing video on connect:', error);
        }
      }, 250);
    }
    // Don't report status here - let user click play first
    // Reporting 'idle' here causes the backend to think video ended and skip to next
  }, [setYouTubeIframePermissions]);

  const onPlayerStateChange = useCallback((event: any) => {
    // Ignore YouTube events when a Cloudflare/local video is active
    if (localPlaybackUrlRef.current) {
      console.log('[Player] YouTube state change ignored (local/Cloudflare video active):', event.data);
      return;
    }
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
      if (isAdminSkipStoppingRef.current && statusRef.current?.state === 'idle') {
        console.log('[Player] Ignoring PLAYING from skipped media while queue advance is in progress');
        return;
      }
      console.log('[Player] Video PLAYING');
      const now = Date.now();
      videoHasPlayedRef.current = true; // Video confirmed playing — any subsequent pause is user-initiated
      if (firstPlayAtRef.current === 0) {
        firstPlayAtRef.current = now;
      }
      ignoreEndedUntilRef.current = Math.max(ignoreEndedUntilRef.current, now + 1500);
      reportStatus('playing');

      // If we're at volume 0 (after skip), fade in
      if (playerRef.current) {
        const currentVol = getActivePlaybackVolume();
        if (skipRestorePendingRef.current || currentVol <= 1) {
          console.log('[Player] Auto-playing after skip - restoring volume...');
          restorePlaybackAfterSkip(true);
        }
      }
    } else if (event.data === 2) {
      // PAUSED
      console.log('[Player] Video PAUSED');
      const pauseAfterConfirmedStart = videoHasPlayedRef.current || firstPlayAtRef.current > 0 || !!status?.playback_started_at;
      const backendState = statusRef.current?.state ?? status?.state;
      const adminRequestedPause = backendState === 'paused';
      const skipOrAdvanceInProgress = isAdminSkipStoppingRef.current || backendState === 'idle';
      if (skipOrAdvanceInProgress) {
        console.log('[Player] Ignoring YouTube PAUSED during skip/queue advance', {
          media_item_id: currentMediaIdRef.current,
          youtube_id: currentYouTubeIdRef.current,
          backend_state: backendState,
          isEnding: isEndingRef.current,
          isAdminSkipStopping: isAdminSkipStoppingRef.current,
        });
        return;
      }
      if (!videoHasPlayedRef.current && playerRef.current && typeof playerRef.current.playVideo === 'function') {
        console.log('[Player] Video paused before first play — treating as startup pause and retrying play...');
        try {
          window.setTimeout(() => {
            try {
              playerRef.current?.playVideo();
            } catch (retryError) {
              console.error('[Player] Error retrying startup play:', retryError);
            }
          }, 250);
        } catch (error) {
          console.error('[Player] Error auto-playing video:', error);
        }
        return;
      }

      if (pauseAfterConfirmedStart && !adminRequestedPause) {
        const secondsSinceFirstPlay = firstPlayAtRef.current ? (Date.now() - firstPlayAtRef.current) / 1000 : null;
        const pauseKey = `${currentMediaIdRef.current ?? 'none'}:${currentYouTubeIdRef.current ?? 'none'}`;
        const shouldLogSuppressedPause = lastSuppressedPauseKeyRef.current !== pauseKey;
        lastSuppressedPauseKeyRef.current = pauseKey;

        if (shouldLogSuppressedPause) {
          console.debug('[Player] Ignoring transient YouTube PAUSED after confirmed start', {
            media_item_id: currentMediaIdRef.current,
            youtube_id: currentYouTubeIdRef.current,
            secondsSinceFirstPlay,
            backend_state: status?.state,
            playback_started_at: status?.playback_started_at ?? null,
          });
          logPlayerEvent('youtube_pause_suppressed', 'info', {
            media_item_id: currentMediaIdRef.current,
            youtube_id: currentYouTubeIdRef.current,
            seconds_since_first_play: secondsSinceFirstPlay,
            backend_state: status?.state,
            playback_started_at: status?.playback_started_at ?? null,
          }, 'transient_pause_after_start').catch(() => {});
        }
        if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
          window.setTimeout(() => {
            try {
              const statusSnapshot = statusRef.current;
              if (
                statusSnapshot?.state !== 'paused' &&
                !localPlaybackUrlRef.current &&
                (!statusSnapshot?.current_media_id || statusSnapshot.current_media_id === currentMediaIdRef.current)
              ) {
                playerRef.current?.playVideo();
              }
            } catch (retryError) {
              console.debug('[Player] Suppressed retry play error after transient pause:', {
                message: retryError instanceof Error ? retryError.message : String(retryError),
              });
            }
          }, 250);
        }
        return;
      }

      reportStatus('paused');

      // If video was recently loaded and paused unexpectedly after it had already started,
      // attempt to nudge it back into play once.
      if (recentlyLoadedRef.current && playerRef.current && typeof playerRef.current.playVideo === 'function') {
        console.log('[Player] Video paused unexpectedly after load, attempting auto-play...');
        try {
          playerRef.current.playVideo();
          recentlyLoadedRef.current = false;
        } catch (error) {
          console.error('[Player] Error auto-playing video:', error);
        }
      }
    } else if (event.data === 0) {
      // ENDED - trigger queue progression
      const msSinceLoad = Date.now() - mediaLoadStartedAtRef.current;
      const msUntilEndedAllowed = ignoreEndedUntilRef.current - Date.now();
      if (!videoHasPlayedRef.current || msSinceLoad < 4000 || msUntilEndedAllowed > 0) {
        console.warn('[Player] Ignoring stale ENDED during startup window', {
          videoHasPlayed: videoHasPlayedRef.current,
          msSinceLoad,
          msUntilEndedAllowed: Math.max(0, msUntilEndedAllowed),
          firstPlayAt: firstPlayAtRef.current,
          mediaId: currentMediaIdRef.current,
          youtubeId: currentYouTubeIdRef.current,
        });
        return;
      }
      console.log('[Player] Video ENDED - calling queue_next');
      reportEndedAndNext();
    } else if (event.data === 3) {
      // BUFFERING
      console.log('[Player] Video BUFFERING');
      if (videoHasPlayedRef.current || firstPlayAtRef.current > 0 || !!statusRef.current?.playback_started_at) {
        console.log('[Player] Ignoring BUFFERING after confirmed playback start');
        return;
      }
      reportStatus('loading');
    }
  }, [status?.playback_started_at, status?.state, reportStatus, reportEndedAndNext, getActivePlaybackVolume, restorePlaybackAfterSkip, logPlayerEvent]);

  // Handle playback errors — any YouTube player error skips immediately to the next video.
  // Error codes:
  //   2   = Invalid parameter (age-restricted or bad video ID)
  //   5   = HTML5 player error (network, decoding)
  //   100 = Video not found or private  → also removes it from queue/playlists
  //   101 = Embedding not allowed by owner
  //   150 = Same as 101 (embedding not allowed by owner)
  const onPlayerError = useCallback(async (event: any) => {
    // Ignore YouTube errors when a Cloudflare/local video is active
    if (localPlaybackUrlRef.current) {
      console.log('[Player] YouTube error ignored (local/Cloudflare video active):', event.data);
      return;
    }
    const errorCode = Number(event.data);
    const failureReason =
      errorCode === 101 || errorCode === 150 ? 'youtube_embed_blocked'
      : errorCode === 100 ? 'youtube_video_unavailable'
      : errorCode === 2 ? 'youtube_invalid_parameter_or_restricted'
      : errorCode === 5 ? 'youtube_html5_playback_error'
      : 'youtube_player_error';

    console.error('[Player] YouTube player error:', event.data, failureReason);
    logPlayerEvent('youtube_playback_error', 'error', {
      error_code: errorCode,
      media_item_id: currentMediaIdRef.current,
      youtube_id: currentYouTubeIdRef.current,
      playback_source: getPlaybackSourceLabel(),
    }, 'youtube_player_error').catch(() => {});
    reportPlaybackFailure(failureReason, {
      error_code: errorCode,
      media_item_id: currentMediaIdRef.current,
      youtube_id: currentYouTubeIdRef.current,
      player_state: typeof playerRef.current?.getPlayerState === 'function' ? playerRef.current.getPlayerState() : null,
    }).catch(() => {});

    if (isSlavePlayer) return;

    if (errorCode === 100) {
      // Video is gone — remove it from the queue and all playlists so it never comes up again.
      const unavailableMediaId = currentMediaIdRef.current;
      if (unavailableMediaId) {
        try {
          const { data: queueItem, error: queueError } = await supabase
            .from('queue')
            .select('id')
            .eq('media_item_id', unavailableMediaId)
            .eq('player_id', PLAYER_ID)
            .maybeSingle();

          if (!queueError && queueItem) {
            await callQueueManager({
              player_id: PLAYER_ID,
              action: 'remove',
              queue_id: (queueItem as { id: string }).id,
            });
          }

          await callPlaylistManager({
            action: 'remove_media_globally',
            player_id: PLAYER_ID,
            media_item_id: unavailableMediaId,
          });
          console.log('[Player] Removed unavailable video from queue and playlists');
        } catch (removeErr) {
          console.error('[Player] Failed to remove unavailable video:', removeErr);
        }
      }
    }

    // Skip immediately for all error codes.
    // Do not rely on the 4-second loading timeout: a YouTube PAUSED event often
    // fires just before the error, causing the server status to land in 'paused'
    // (via an async race between reportStatus calls), which cancels the timeout
    // and leaves the player stuck indefinitely.
    console.error(`[Player] Skipping video due to playback error (${errorCode})`);
    reportEndedAndNext(false);
  }, [getPlaybackSourceLabel, isSlavePlayer, reportEndedAndNext, logPlayerEvent, reportPlaybackFailure]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (ytApiReady) return;

    if (window.YT?.Player) {
      console.log('[Player] YouTube IFrame API already present');
      setYtApiReady(true);
      return;
    }

    console.log('[Player] Loading YouTube IFrame API...');

    // Load the IFrame Player API code asynchronously, but only once.
    const existingTag = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existingTag) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    // API will call this function when ready
    window.onYouTubeIframeAPIReady = () => {
      console.log('[Player] YouTube IFrame API ready');
      setYtApiReady(true);
    };
  }, [ytApiReady]);

  useEffect(() => {
    return () => {
      destroyYouTubePlayer('component unmount');
    };
  }, [destroyYouTubePlayer]);

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

        // Register this player instance as a potential priority player.
        // endpointId is stable for a browser endpoint; sessionId changes per page load.
        const sessionId = crypto.randomUUID();
        let endpointId = localStorage.getItem('obie_player_endpoint_id');
        if (!endpointId) {
          endpointId = crypto.randomUUID();
          localStorage.setItem('obie_player_endpoint_id', endpointId);
        }

        const storedPlayerId = localStorage.getItem('obie_priority_player_id');
        const storedEndpointId = localStorage.getItem('obie_priority_endpoint_id');

        sessionIdRef.current = sessionId;
        endpointIdRef.current = endpointId;
        setCurrentSessionId(sessionId);
        setCurrentEndpointId(endpointId);

        console.log('[Player] Registering session:', sessionId, 'endpoint_id:', endpointId, 'stored_endpoint_id:', storedEndpointId);
        
        const sessionResult = await callPlayerControl({
          player_id: PLAYER_ID,
          action: 'register_session',
          session_id: sessionId,
          endpoint_id: endpointId,
          stored_player_id: storedPlayerId || undefined,
          stored_endpoint_id: storedEndpointId || undefined,
          origin: window.location.origin,
          user_agent: navigator.userAgent,
        });

        // Store whether this player is a slave (not priority)
        setIsSlavePlayer(!sessionResult.is_priority);

        console.log('[Player] Session registered successfully, is_slave:', !sessionResult.is_priority, 'restored:', sessionResult.restored || false);
      } catch (error) {
        console.error('[Player] Failed to initialize:', error);
      }
    };

    initPlayer();
  }, []);

  useEffect(() => {
    if (!currentEndpointId) return;

    const applyEndpointState = (endpoint: PlayerEndpoint | null) => {
      if (!endpoint) return;
      const slave = endpoint.role !== 'master';
      setIsSlavePlayer(slave);
      if (!slave) {
        localStorage.setItem('obie_priority_player_id', PLAYER_ID);
        localStorage.setItem('obie_priority_endpoint_id', currentEndpointId);
      } else {
        localStorage.removeItem('obie_priority_player_id');
        localStorage.removeItem('obie_priority_endpoint_id');
      }

      if (endpoint.identify_until) {
        const identifyUntilMs = new Date(endpoint.identify_until).getTime();
        if (identifyUntilMs > Date.now()) {
          setIdentifyUntil(identifyUntilMs);
          return;
        }
      }
      setIdentifyUntil(null);
    };

    const sub = subscribeToPlayerEndpoint(currentEndpointId, applyEndpointState);
    return () => sub.unsubscribe();
  }, [currentEndpointId]);

  useEffect(() => {
    if (!identifyUntil) return;
    const timeoutMs = identifyUntil - Date.now();
    if (timeoutMs <= 0) {
      setIdentifyUntil(null);
      return;
    }
    const timer = window.setTimeout(() => setIdentifyUntil(null), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [identifyUntil]);

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
      const newMediaId = newStatus.current_media_id;
      const oldMediaId = currentMediaIdRef.current;
      const statusPlaybackUrl =
        newStatus.local_url ||
        newStatus.current_media?.url ||
        null;

      const statusIsLocalOrCloudflare =
        !!statusPlaybackUrl &&
        !isYouTubePlaybackUrl(statusPlaybackUrl) &&
        (
          newStatus.source === 'local' ||
          newStatus.source === 'cloudflare' ||
          newStatus.current_media?.source_type === 'local' ||
          newStatus.current_media?.source_type === 'cloudflare' ||
          !isYouTubePlaybackUrl(newStatus.current_media?.url)
        );

      const mediaForState = newStatus.current_media
        ? {
            ...newStatus.current_media,
            url: statusIsLocalOrCloudflare && statusPlaybackUrl ? statusPlaybackUrl : newStatus.current_media.url,
            source_type:
              newStatus.current_media.source_type ||
              (statusIsLocalOrCloudflare ? 'cloudflare' : 'youtube'),
          }
        : null;

      const expectedStatusYouTubeId = statusPlaybackUrl ? extractYouTubeId(statusPlaybackUrl) : null;
      const iframeMatchesStatus =
        !!newStatus.current_media_id &&
        currentMediaIdRef.current === newStatus.current_media_id &&
        (
          !expectedStatusYouTubeId ||
          currentYouTubeIdRef.current === expectedStatusYouTubeId
        );
      
      // SKIP: Admin set state to 'idle' while video was playing.
      if (newState === 'idle' && (prevState === 'playing' || prevState === 'paused')) {
        console.log('[Player] Skip detected from Admin - stopping current media and waiting for server queue advance');
        stopSkippedPlaybackAfterFade();
        prevStateRef.current = newState;
        // Do not write this stale idle/old-media status into local state after
        // the skip starts. player-control advances the queue immediately and
        // the next status event loads the authoritative current media.
        return;
      }

      const adminSkipNewMedia = newMediaId && newMediaId !== oldMediaId && newStatus.last_recovery_reason === 'admin_skip';

      if (adminSkipNewMedia) {
        console.log('[Player] Admin skip advanced queue - waiting for local fade before loading next media', {
          old_id: oldMediaId,
          new_id: newMediaId,
          title: newStatus.current_media?.title,
        });
        await stopSkippedPlaybackAfterFade();
      }

      // Reconcile renderer/source before applying play/pause commands. This keeps
      // stale YouTube iframes from receiving commands for Cloudflare/local media.
      if (statusIsLocalOrCloudflare) {
        if (statusPlaybackUrl !== localPlaybackUrlRef.current) {
          console.log(`[Player][realtime] source=${newStatus.source} → activating <video>`);
          console.log(`[Player][realtime]   media_id=${newMediaId}  url=${statusPlaybackUrl}`);
          lastPlaybackFailureKeyRef.current = null;
          lastRecoveryKeyRef.current = null;
          localPlaybackUrlRef.current = statusPlaybackUrl;
          setLocalPlaybackUrl(statusPlaybackUrl);
        }
      } else if (localPlaybackUrlRef.current) {
        console.log(`[Player][realtime] source=${newStatus.source ?? 'youtube'} → reset to iframe mode`);
        setLocalPlaybackUrl(null);
        localPlaybackUrlRef.current = null;
        try {
          localVideoRef.current?.pause();
          localVideoRef.current?.removeAttribute('src');
          localVideoRef.current?.load();
        } catch (error) {
          console.warn('[Player] Failed to tear down local video on realtime source change:', error);
        }
        teardownLocalAudioAnalyser();
      }

      // Handle state transitions with fades.
      // In YTM Desktop mode playerRef.current is null (no iframe), so we must also
      // allow the block when playerModeRef indicates ytm_desktop.
      if ((playerRef.current || playerModeRef.current === 'ytm_desktop' || statusIsLocalOrCloudflare) && prevState !== newState) {
        if (newState === 'paused' && prevState === 'playing') {
          if (playerModeRef.current === 'ytm_desktop') {
            // Mark that this pause is admin-initiated so end detection ignores the
            // resulting trackState 1→0 transition in the state-update handler.
            ytmAdminPausedRef.current = true;
            setTimeout(() => { ytmAdminPausedRef.current = false; }, 3000);
            ytmFetch('/api/v1/command', { method: 'POST', body: JSON.stringify({ command: 'pause' }) }).catch(() => {});
          } else if (localPlaybackUrlRef.current && localVideoRef.current) {
            // Cloudflare/local: pause the <video> element
            console.log('[Player] Pausing local/Cloudflare video...');
            localVideoRef.current.pause();
          } else if (statusIsLocalOrCloudflare) {
            console.log('[Player] Pause ignored until local/Cloudflare <video> mounts');
          } else if (!iframeMatchesStatus) {
            console.warn('[Player] Pause ignored because iframe media does not match player_status', {
              status_media_id: newStatus.current_media_id,
              loaded_media_id: currentMediaIdRef.current,
              expected_youtube_id: expectedStatusYouTubeId,
              loaded_youtube_id: currentYouTubeIdRef.current,
            });
          } else if (playerRef.current) {
            // Fade out when pausing
            console.log('[Player] Pausing - fading out...');
            await fadeOut();
            playerRef.current.pauseVideo();
          }
        } else if (newState === 'playing' && prevState === 'paused') {
          if (playerModeRef.current === 'ytm_desktop') {
            ytmFetch('/api/v1/command', { method: 'POST', body: JSON.stringify({ command: 'play' }) }).catch(() => {});
          } else if (localPlaybackUrlRef.current && localVideoRef.current) {
            // Cloudflare/local: resume the <video> element
            console.log('[Player] Resuming local/Cloudflare video...');
            localVideoRef.current.play().catch(() => {});
          } else if (statusIsLocalOrCloudflare) {
            console.log('[Player] Resume waiting for local/Cloudflare <video> to mount');
            shouldAutoplayCurrentMediaRef.current = true;
          } else if (!iframeMatchesStatus) {
            console.warn('[Player] Resume ignored because iframe media does not match player_status', {
              status_media_id: newStatus.current_media_id,
              loaded_media_id: currentMediaIdRef.current,
              expected_youtube_id: expectedStatusYouTubeId,
              loaded_youtube_id: currentYouTubeIdRef.current,
            });
            shouldAutoplayCurrentMediaRef.current = true;
            if (mediaForState) setCurrentMedia(mediaForState);
          } else if (playerRef.current) {
            // Fade in when resuming
            console.log('[Player] Resuming - fading in...');
            playerRef.current.playVideo();
            await fadeIn();
          }
        }
      }
      
      prevStateRef.current = newState;
      setStatus(newStatus);

      if (newMediaId && newMediaId !== oldMediaId) {
        shouldAutoplayCurrentMediaRef.current = newState === 'playing' || newState === 'loading';
        console.log('[Player] New media from status (CHANGED):', {
          old_id: oldMediaId,
          new_id: newMediaId,
          title: newStatus.current_media?.title,
          artist: newStatus.current_media?.artist
        });
        setCurrentMedia(mediaForState);

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
  }, [fadeIn, fadeOut, isYouTubePlaybackUrl, reportEndedAndNext, stopSkippedPlaybackAfterFade, teardownLocalAudioAnalyser]);

  // Subscribe to player settings (to watch karaoke_mode)
  useEffect(() => {
    const settingsSub = subscribeToPlayerSettings(PLAYER_ID, setSettings);
    return () => settingsSub.unsubscribe();
  }, []);

  // Derive current player mode; keep a ref in sync for use inside subscription callbacks
  const playerMode = settings?.player_mode ?? 'iframe';
  useEffect(() => {
    playerModeRef.current = settings?.player_mode ?? 'iframe';
  }, [settings?.player_mode]);
  useEffect(() => { localPlaybackUrlRef.current = localPlaybackUrl; }, [localPlaybackUrl]);
  useEffect(() => {
    resetSilenceTracking(true);
    return () => {
      resetSilenceTracking(true);
      teardownLocalAudioAnalyser();
    };
  }, [localPlaybackUrl, currentMedia?.id, resetSilenceTracking, teardownLocalAudioAnalyser]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      const body = JSON.stringify({
        player_id: PLAYER_ID,
        action: 'disconnect',
        session_id: sessionIdRef.current,
        endpoint_id: endpointIdRef.current,
        initiator: 'player_client',
        reason: 'window_unload',
      });
      fetch(`${SUPABASE_URL}/functions/v1/player-control`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body,
      }).catch(() => {});
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ── YTM Desktop auth ──────────────────────────────────────────────────────
  const ytmRequestAuth = useCallback(async () => {
    setYtmAuthStep('requesting');
    setYtmError(null);
    try {
      const res = await fetch(`${YTM_BASE}/api/v1/auth/requestcode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: YTM_APP_ID, appName: 'Obie Jukebox', appVersion: '1.0.0' }),
      });
      if (!res.ok) throw new Error('YTM Desktop not responding');
      const data = await res.json();
      const code: string = data.code;
      setYtmAuthCode(code);
      setYtmAuthStep('waiting');
      // Poll every 2 s until approved (max 30 s timeout per request)
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 45) { clearInterval(poll); setYtmAuthStep('idle'); return; }
        try {
          const authRes = await fetch(`${YTM_BASE}/api/v1/auth/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: YTM_APP_ID, code }),
          });
          if (!authRes.ok) return;
          const authData = await authRes.json();
          if (authData.token) {
            clearInterval(poll);
            saveYtmToken(authData.token);
            setYtmToken(authData.token); // triggers Socket.IO connection effect
            setYtmAuthStep('authorized');
          }
        } catch { /* still waiting */ }
      }, 2000);
    } catch {
      setYtmError('YTM Desktop not found at localhost:9863. Start YTM Desktop and enable Companion Server.');
      setYtmAuthStep('idle');
    }
  }, []);

  // Test reachability of YTM Desktop Companion Server without requiring auth
  const ytmTestConnection = useCallback(async () => {
    setYtmTestResult('testing');
    setYtmTestMsg(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${YTM_BASE}/api/v1/state`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        setYtmTestResult('ok');
        setYtmTestMsg('Server is running');
      } else if (res.status === 401) {
        setYtmTestResult('ok');
        setYtmTestMsg('Server found — click Connect to authorize');
      } else {
        setYtmTestResult('error');
        setYtmTestMsg(`HTTP ${res.status} — check Companion Server settings`);
      }
    } catch {
      setYtmTestResult('error');
      setYtmTestMsg('No response from localhost:9863 — is YTM Desktop running?');
    }
  }, []);

  // Tear down YTM connections when leaving ytm_desktop mode
  useEffect(() => {
    if (playerMode !== 'ytm_desktop') {
      ytmSocketRef.current?.disconnect();
      ytmSocketRef.current = null;
      setYtmNowPlaying(null);
      setYtmConnected(false);
      setYtmError(null);
      setYtmAuthStep('idle');
    }
  }, [playerMode]);

  // Socket.IO realtime connection: replaces polling — state-update events fire instantly on track changes
  useEffect(() => {
    if (playerMode !== 'ytm_desktop') return;
    if (!ytmToken) return;

    const socket = io(`${YTM_BASE}/api/v1/realtime`, {
      auth: { token: ytmToken },
      transports: ['websocket'], // API requires websocket-only (no polling)
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });
    ytmSocketRef.current = socket;

    socket.on('connect', () => {
      console.log('[YTM] Socket.IO connected');
      setYtmConnected(true);
      setYtmError(null);
    });

    socket.on('disconnect', () => {
      console.log('[YTM] Socket.IO disconnected');
      setYtmConnected(false);
    });

    socket.on('connect_error', (err: Error) => {
      console.error('[YTM] Socket.IO connect error:', err.message);
      setYtmConnected(false);
      setYtmError('Connection error — is YTM Desktop companion server running?');
    });

    socket.on('state-update', (data: any) => {
      setYtmConnected(true);
      setYtmError(null);
      // YTM Desktop API v1 state-update has the same structure as GET /state:
      //   data.player.trackState    (-1=Unknown, 0=Paused, 1=Playing, 2=Buffering; no "ended" state)
      //   data.player.videoProgress (float, SECONDS)
      //   data.video.id             (YouTube video ID)
      //   data.video.durationSeconds (integer, seconds)
      const video = data.video;
      const trackState: number = typeof data.player?.trackState === 'number' ? data.player.trackState : -1;
      const videoProgress: number = typeof data.player?.videoProgress === 'number' ? data.player.videoProgress : 0;

      if (video) {
        const thumb = video.thumbnails?.[0]?.url || '';
        setYtmNowPlaying({ title: video.title || '', artist: video.author || '', thumbnail: thumb });
      }

      if (ytmCurrentVideoIdRef.current) {
        // Per API: the state video object uses "id" for the YouTube video ID
        const videoMatches = (video?.id ?? null) === ytmCurrentVideoIdRef.current;
        const prevTrackState = ytmTrackStateRef.current;
        ytmTrackStateRef.current = trackState;

        // Report 'playing' once per video (backup path if changeVideo HTTP response was slow/missed)
        if (videoMatches && trackState === 1 && !ytmPlayingReportedRef.current) {
          ytmPlayingReportedRef.current = true;
          reportStatus('playing');
        }

        // End detection — videoProgress is SECONDS, trackState 0=Paused (no "ended" state in API).
        // API field is video.durationSeconds; fall back to video.duration in case of API variance.
        const duration: number =
          (typeof video?.durationSeconds === 'number' && video.durationSeconds > 0 ? video.durationSeconds : 0) ||
          (typeof video?.duration === 'number' && video.duration > 0 ? video.duration : 0);

        // Within 2 seconds of the end (requires duration to be known)
        const atEnd = videoMatches && duration > 0 && videoProgress >= duration - 2;

        // YTM Desktop transitions playing→unknown (-1) at end (observed via Socket.IO).
        // Fallback: also catch playing→paused (0) in case behaviour varies by track.
        // Gated on !ytmAdminPausedRef so admin-initiated pauses don't falsely trigger this.
        const pausedWhilePlaying = videoMatches
          && (trackState === 0 || trackState === -1) && prevTrackState === 1  // playing → paused/unknown
          && !ytmAdminPausedRef.current                        // not an admin pause
          && (duration > 0 ? videoProgress > duration * 0.85  // near end (if duration known)
                           : videoProgress > 10);             // >10s in (if duration unknown)

        if (atEnd || pausedWhilePlaying) {
          console.log('[YTM] Song ended — triggering queue_next', { videoProgress, duration, trackState, prevTrackState });
          ytmCurrentVideoIdRef.current = null; // prevent double-trigger
          reportEndedAndNext();
        }
      }
    });

    return () => {
      socket.disconnect();
      ytmSocketRef.current = null;
    };
  }, [playerMode, ytmToken, reportEndedAndNext, reportStatus]);

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
    lyricsMediaIdRef.current = null;
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
    if (lyricsDataRef.current && lyricsMediaIdRef.current === currentMedia.id) {
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
        lyricsMediaIdRef.current = currentMedia.id;
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
    if (!currentMedia) return;

    const statusSnapshot = statusRef.current ?? status;
    const statusSource = statusSnapshot?.source;
    const statusLocalUrl = statusSnapshot?.local_url ?? null;
    const statusMediaId = statusSnapshot?.current_media_id ?? null;
    const localUrlAtEffectStart = localPlaybackUrlRef.current || localPlaybackUrl;

    const currentMediaUrlIsYouTube = isYouTubePlaybackUrl(currentMedia.url);
    const currentMediaHasDirectUrl = !currentMediaUrlIsYouTube;
    const statusLocalUrlMatchesCurrent =
      !!statusLocalUrl &&
      (!statusMediaId || currentMedia.id === statusMediaId) &&
      !isYouTubePlaybackUrl(statusLocalUrl);
    const sourceClaimsLocal =
      statusSource === 'local' ||
      statusSource === 'cloudflare' ||
      currentMedia.source_type === 'cloudflare' ||
      currentMedia.source_type === 'local';

    const lockedLocalPlaybackUrl =
      (statusLocalUrlMatchesCurrent ? statusLocalUrl : null) ||
      (!currentMediaUrlIsYouTube ? currentMedia.url : null) ||
      (sourceClaimsLocal && !isYouTubePlaybackUrl(localUrlAtEffectStart) ? localUrlAtEffectStart : null) ||
      null;

    const shouldUseLocalVideo =
      !!lockedLocalPlaybackUrl &&
      !isYouTubePlaybackUrl(lockedLocalPlaybackUrl) &&
      (
        currentMediaHasDirectUrl ||
        statusLocalUrlMatchesCurrent ||
        (sourceClaimsLocal && (!statusMediaId || currentMedia.id === statusMediaId))
      );

    if (shouldUseLocalVideo) {
      console.log('[Player] Cloudflare/local media locked to <video>; skipping YouTube iframe load', {
        media_id: currentMedia.id,
        source: statusSource ?? currentMedia.source_type,
        playback_url: lockedLocalPlaybackUrl,
        current_media_url: currentMedia.url,
      });

      if (lockedLocalPlaybackUrl && lockedLocalPlaybackUrl !== localPlaybackUrlRef.current) {
        localPlaybackUrlRef.current = lockedLocalPlaybackUrl;
        setLocalPlaybackUrl(lockedLocalPlaybackUrl);
      }

      currentMediaIdRef.current = currentMedia.id;
      currentYouTubeIdRef.current = null;
      videoHasPlayedRef.current = false;
      lastPlaybackFailureKeyRef.current = null;
      lastRecoveryKeyRef.current = null;

      if (playerRef.current) {
        destroyYouTubePlayer('switching to local/Cloudflare video');
      }

      return;
    }

    // YTM Desktop mode: dispatch changeVideo instead of creating an iframe.
    if (playerModeRef.current === 'ytm_desktop') {
      if (currentMediaIdRef.current === currentMedia.id) {
        console.log('[Player] Same media (YTM), skipping');
        return;
      }
      const videoId = extractYouTubeId(currentMedia.url);
      if (!videoId) {
        console.error('[YTM] Could not extract YouTube ID from:', currentMedia.url);
        return;
      }
      currentMediaIdRef.current = currentMedia.id;
      ytmCurrentVideoIdRef.current = videoId;
      ytmPlayingReportedRef.current = false;
      ytmTrackStateRef.current = null;
      console.log('[YTM] Sending changeVideo:', videoId);
      ytmFetch('/api/v1/command', {
        method: 'POST',
        body: JSON.stringify({ command: 'changeVideo', data: { videoId } }),
      }).then(res => {
        if (res.ok) {
          setYtmConnected(true);
          setYtmError(null);
          window.setTimeout(() => {
            if (ytmCurrentVideoIdRef.current === videoId && !ytmPlayingReportedRef.current) {
              reportPlaybackFailure('ytm_playback_not_confirmed', {
                youtube_id: videoId,
                media_item_id: currentMediaIdRef.current,
              }).catch(() => {});
              reportEndedAndNext(false);
            }
          }, 10000);
        } else if (res.status === 401) {
          setYtmConnected(false);
          setYtmError('YTM auth failed — please reconnect');
        } else {
          setYtmError(`YTM command failed (HTTP ${res.status})`);
        }
      }).catch(() => {
        setYtmError('YTM Desktop offline — start YTM Desktop with Companion Server enabled');
        setYtmConnected(false);
        reportPlaybackFailure('ytm_desktop_offline', {
          youtube_id: videoId,
          media_item_id: currentMediaIdRef.current,
        }).catch(() => {});
        reportEndedAndNext(false);
      });
      return;
    }

    if (!ytApiReady || !playerDivRef.current) return;

    const youtubeId = extractYouTubeId(currentMedia.url);
    if (!youtubeId) {
      console.error('[Player] Could not extract YouTube ID from:', currentMedia.url);
      reportPlaybackFailure('youtube_id_extract_failed', {
        media_item_id: currentMedia.id,
        url: currentMedia.url,
      }).catch(() => {});
      reportEndedAndNext(false);
      return;
    }

    if (currentMediaIdRef.current === currentMedia.id && currentYouTubeIdRef.current === youtubeId && playerRef.current) {
      console.log('[Player] Same YouTube media already loaded; skipping iframe rebuild', {
        media_id: currentMedia.id,
        youtube_id: youtubeId,
      });
      return;
    }

    console.log('[Player] Loading NEW YouTube media:', {
      id: currentMedia.id,
      title: currentMedia.title,
      artist: currentMedia.artist,
      url: currentMedia.url,
      youtube_id: youtubeId,
    });

    const isAfterSkip = isSkipLoadingRef.current;
    currentMediaIdRef.current = currentMedia.id;
    currentYouTubeIdRef.current = youtubeId;
    markYouTubeLoadStart();
    setPlayerReady(false);

    if (playerRef.current) {
      console.log('[Player] Destroying existing YouTube player before loading new media:', {
        new_media_id: currentMedia.id,
        new_youtube_id: youtubeId,
      });
      destroyYouTubePlayer('loading new YouTube media');
    }

    if (isAfterSkip) {
      console.log('[Player] Loading after skip - will fade in on play');
      setPlaybackOpacity(0);
      setActivePlaybackVolume(0);
      isSkipLoadingRef.current = false;
    } else {
      setPlaybackOpacity(1);
      setActivePlaybackVolume(getConfiguredVolume());
    }

    const youtubeMount = createYouTubeMount();
    if (!youtubeMount) return;

    console.log('[Player] Creating YouTube player for video:', youtubeId);
    playerRef.current = new window.YT.Player(youtubeMount, {
      host: YOUTUBE_EMBED_HOST,
      width: '100%',
      height: '100%',
      videoId: youtubeId,
      playerVars: {
        enablejsapi: 1,
        origin: window.location.origin,
        autoplay: shouldAutoplayCurrentMediaRef.current ? 1 : 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,
        vq: 'auto',
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
    window.setTimeout(() => setYouTubeIframePermissions(playerRef.current), 0);
  }, [createYouTubeMount, currentMedia, destroyYouTubePlayer, localPlaybackUrl, ytApiReady, status?.source, status?.local_url, status?.current_media_id, isYouTubePlaybackUrl, onPlayerReady, onPlayerStateChange, onPlayerError, reportPlaybackFailure, reportEndedAndNext, markYouTubeLoadStart, getConfiguredVolume, setActivePlaybackVolume, setPlaybackOpacity, setYouTubeIframePermissions]);

  // Auto-skip videos that stay in 'loading' status for 4+ seconds, or that enter
  // 'paused' before the video has ever actually played (unexpected pause = error).
  // This catches age-restricted, geographically blocked, embedding-blocked, or
  // other failed-to-load videos regardless of which transient state they land in.
  useEffect(() => {
    if (!status) return;

    // ── Clear any existing timeouts ────────────────────────────────────────
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    if (unexpectedPauseTimeoutRef.current) {
      clearTimeout(unexpectedPauseTimeoutRef.current);
      unexpectedPauseTimeoutRef.current = null;
    }

    const advanceToNext = async (reason: string) => {
      console.error(`[Player] ${reason} — advancing to next video`);
      const recoveryKey = `${status.current_media_id ?? 'none'}:${reason}`;
      if (lastRecoveryKeyRef.current !== recoveryKey) {
        lastRecoveryKeyRef.current = recoveryKey;
        logPlayerEvent('player_recovery_triggered', 'warn', {
          recovery_reason: reason,
          source: status.source ?? 'youtube',
          media_item_id: status.current_media_id,
          endpoint_id: endpointIdRef.current,
          session_id: sessionIdRef.current,
        }, reason).catch(() => {});
        reportPlaybackFailure('playback_start_timeout', {
          recovery_reason: reason,
          media_item_id: status.current_media_id,
          playback_source: status.source ?? 'youtube',
        }).catch(() => {});
      } else {
        console.warn('[Player] Duplicate recovery log suppressed:', { reason, media_item_id: status.current_media_id });
      }
      try {
        await reportEndedAndNext(false);
      } catch (error) {
        logPlayerEvent('player_recovery_failed', 'error', {
          recovery_reason: reason,
          message: error instanceof Error ? error.message : String(error),
        }, reason).catch(() => {});
        console.error('[Player] Failed to advance after auto-skip:', error);
      }
    };

    // Skip loading/pause timeouts when a local/Cloudflare video is active —
    // the <video> element handles its own lifecycle and will report 'playing'.
    const statusPlaybackUrl = status.local_url || status.current_media?.url || null;
    if (status.source === 'cloudflare' || status.source === 'local' || (statusPlaybackUrl && !isYouTubePlaybackUrl(statusPlaybackUrl))) {
      console.log(`[Player] Source is ${status.source ?? 'direct-video'} — skipping YouTube loading/pause timeouts`);
      return;
    }

    if (status.state === 'loading') {
      if (videoHasPlayedRef.current || status.playback_started_at) {
        console.warn('[Player] Backend still loading after confirmed playback — re-reporting playing instead of recovering', {
          media_item_id: status.current_media_id,
          playback_started_at: status.playback_started_at ?? null,
        });
        reportStatus('playing', status.progress);
        return;
      }
      // ── 4-second loading timeout ──────────────────────────────────────────
      console.log('[Player] Video entered loading state, setting 8-second timeout to load next if not loaded');
      loadingTimeoutRef.current = window.setTimeout(() => {
        loadingTimeoutRef.current = null;
        advanceToNext('Video still in loading state after 8 seconds');
      }, 8000);

    } else if (status.state === 'paused' && !videoHasPlayedRef.current) {
      if (status.playback_started_at) {
        console.warn('[Player] Backend paused after confirmed playback — re-reporting playing instead of recovering', {
          media_item_id: status.current_media_id,
          playback_started_at: status.playback_started_at,
        });
        reportStatus('playing', status.progress);
        return;
      }
      if (recentlyLoadedRef.current) {
        console.log('[Player] Video paused before first play but still within startup grace window');
        return;
      }
      // ── Unexpected pause: video paused before it ever played ──────────────
      // This fires when an error (e.g. embedding block, network issue) causes the
      // player to land in 'paused' rather than 'loading'. Since the video has
      // never entered 'playing' state, this is not a user-initiated pause —
      // auto-advance after 3 seconds.
      console.warn('[Player] Video paused before it ever played — unexpected pause, will auto-advance in 6s');
      unexpectedPauseTimeoutRef.current = window.setTimeout(() => {
        unexpectedPauseTimeoutRef.current = null;
        advanceToNext('Video paused before playing (unexpected pause)');
      }, 6000);

    } else if (status.state !== 'paused') {
      // Status changed to something other than paused/loading — log the transition
      console.log('[Player] Status changed from loading to:', status.state);
    }

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      if (unexpectedPauseTimeoutRef.current) {
        clearTimeout(unexpectedPauseTimeoutRef.current);
        unexpectedPauseTimeoutRef.current = null;
      }
    };
  }, [status, logPlayerEvent, reportEndedAndNext, reportPlaybackFailure, reportStatus]);

  // Sync player state with server commands
  useEffect(() => {
    if (!status) return;

    if (playerModeRef.current === 'ytm_desktop') {
      if (status.state === 'playing') {
        ytmFetch('/api/v1/command', { method: 'POST', body: JSON.stringify({ command: 'play' }) }).catch(() => {});
      } else if (status.state === 'paused') {
        ytmFetch('/api/v1/command', { method: 'POST', body: JSON.stringify({ command: 'pause' }) }).catch(() => {});
      }
      return;
    }

    const statusPlaybackUrl = status.local_url || status.current_media?.url || null;
    const statusSourceIsLocal = status.source === 'cloudflare' || status.source === 'local';
    const statusMediaIsYouTube = isYouTubePlaybackUrl(statusPlaybackUrl);
    const statusPlaybackIsLocal = !!statusPlaybackUrl && !statusMediaIsYouTube;
    if ((statusSourceIsLocal || statusPlaybackIsLocal) && statusPlaybackIsLocal) {
      if (localVideoRef.current) {
        if (status.state === 'playing') {
          localVideoRef.current.play().catch(() => {});
        } else if (status.state === 'paused') {
          localVideoRef.current.pause();
        }
      } else {
        if (statusPlaybackUrl && statusPlaybackUrl !== localPlaybackUrlRef.current) {
          localPlaybackUrlRef.current = statusPlaybackUrl;
          setLocalPlaybackUrl(statusPlaybackUrl);
        }
        console.debug('[Player] Waiting for local/Cloudflare <video> to mount before applying playback command', {
          state: status.state,
          media_id: status.current_media_id,
          source: status.source,
        });
      }
      return;
    }

    if (!playerRef.current || !playerRef.current.playVideo) return;
    if (localPlaybackUrl) return;

    const expectedYouTubeId = extractYouTubeId(statusPlaybackUrl || '');
    if (
      expectedYouTubeId
      && (
        currentMediaIdRef.current !== status.current_media_id
        || currentYouTubeIdRef.current !== expectedYouTubeId
      )
    ) {
      console.warn('[Player] Ignoring iframe command because loaded iframe media does not match player_status', {
        state: status.state,
        status_media_id: status.current_media_id,
        loaded_media_id: currentMediaIdRef.current,
        expected_youtube_id: expectedYouTubeId,
        loaded_youtube_id: currentYouTubeIdRef.current,
      });
      if (status.current_media) {
        setCurrentMedia(status.current_media);
      }
      return;
    }

    const player = playerRef.current;

    // Send commands to YouTube player based on server state
    if (status.state === 'playing') {
      player.playVideo();
    } else if (status.state === 'paused') {
      player.pauseVideo();
    }
  }, [status, localPlaybackUrl, isYouTubePlaybackUrl]);

  return (
    <div className="relative w-screen h-screen bg-black">
      {/* YouTube Player Container (hidden in ytm_desktop mode or when local fallback is active) */}
      <div
        ref={playerDivRef}
        id="player"
        className="w-full h-full"
        style={{ display: (playerMode === 'ytm_desktop' || !!localPlaybackUrl) ? 'none' : 'block' }}
      />

      {/* Local Video Fallback — plays a yt-dlp-downloaded .mp4 from Supabase Storage */}
      {localPlaybackUrl && (
        <video
          ref={localVideoRef}
          key={localPlaybackUrl}
          src={localPlaybackUrl}
          autoPlay
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'cover', objectPosition: 'center center', background: 'black' }}
          onPlay={async () => {
            const v = localVideoRef.current;
            console.log(`[Player][local-video] ▶ PLAY  src=${localPlaybackUrl}  duration=${v ? v.duration.toFixed(1) + 's' : '?'}`);
            videoHasPlayedRef.current = true;
            resetSilenceTracking(false);
            if (skipRestorePendingRef.current && v) {
              v.volume = 0;
              v.style.opacity = '0';
              restorePlaybackAfterSkip(true);
            } else if (v && v.volume <= 0.01) {
              v.volume = getConfiguredVolume() / 100;
              v.style.opacity = '1';
            }
            await ensureLocalAudioAnalyser();
            reportStatus('playing');
          }}
          onTimeUpdate={() => {
            evaluateTailSilence();
            const now = Date.now();
            if (now - localVideoLastReportRef.current < 5000) return; // Throttle to every 5s
            localVideoLastReportRef.current = now;
            const v = localVideoRef.current;
            if (v && v.duration && isFinite(v.duration) && v.duration > 0) {
              const progress = v.currentTime / v.duration;
              reportStatus('playing', progress);
            }
          }}
          onEnded={() => {
            resetSilenceTracking(true);
            console.log('[Player][local-video] ■ ENDED — triggering queue_next');
            reportEndedAndNext(false);
          }}
          onError={(e) => {
            resetSilenceTracking(true);
            console.error('[Player][local-video] ✖ ERROR:', e);
            reportPlaybackFailure('local_or_cloudflare_video_error', {
              media_item_id: currentMediaIdRef.current,
              playback_source: status?.source ?? 'local',
              local_url: localPlaybackUrl,
            }).catch(() => {});
            setLocalPlaybackUrl(null);
            reportEndedAndNext(false);
          }}
          onPause={() => {
            resetSilenceTracking(false);
          }}
        />
      )}

      {/* YTM Desktop Overlay */}
      {playerMode === 'ytm_desktop' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black">
          {ytmConnected && ytmNowPlaying ? (
            <div style={{ textAlign: 'center', maxWidth: 480, padding: '0 24px' }}>
              {ytmNowPlaying.thumbnail && (
                <img src={ytmNowPlaying.thumbnail} alt="" style={{ width: 240, height: 180, objectFit: 'cover', borderRadius: 12, marginBottom: 20 }} />
              )}
              <div style={{ color: '#fff', fontSize: 26, fontWeight: 700, marginBottom: 8, lineHeight: '1.3' }}>{ytmNowPlaying.title}</div>
              <div style={{ color: '#aaa', fontSize: 18, marginBottom: 16 }}>{ytmNowPlaying.artist}</div>
              <div style={{ color: '#4ade80', fontSize: 12, letterSpacing: 1 }}>▶ Playing via YTM Desktop</div>
            </div>
          ) : ytmAuthStep === 'waiting' && ytmAuthCode ? (
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{ fontSize: 16, color: '#aaa', marginBottom: 12 }}>Approve connection in YTM Desktop:</div>
              <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 10, background: '#111', padding: '18px 28px', borderRadius: 10, marginBottom: 16, fontFamily: 'monospace' }}>{ytmAuthCode}</div>
              <div style={{ fontSize: 13, color: '#555' }}>Waiting for approval…</div>
            </div>
          ) : ytmAuthStep === 'requesting' ? (
            <div style={{ color: '#aaa', fontSize: 16 }}>Connecting to YTM Desktop…</div>
          ) : (
            <div style={{ color: '#fff', maxWidth: 540, width: '100%', padding: '0 24px' }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6, textAlign: 'center' }}>YTM Desktop Mode</div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <a
                  href="https://github.com/ytmdesktop/ytmdesktop/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#60a5fa', fontSize: 12, textDecoration: 'none', fontFamily: 'monospace' }}
                >
                  ↗ github.com/ytmdesktop/ytmdesktop/releases
                </a>
              </div>

              {/* ── API Server Settings reference ── */}
              <div style={{ marginBottom: 16, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.05)', fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: 1, textTransform: 'uppercase' }}>
                  Required API Server Settings
                </div>
                {([
                  ['Hostname',          'localhost  (127.0.0.1)'],
                  ['Port',              '9863'],
                  ['Authorization',     'Bearer token  —  OAuth-style companion handshake'],
                  ['HTTPS / TLS',       'Disabled  (plain HTTP, no certificates needed)'],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', gap: 12, alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.35)', minWidth: 130, flexShrink: 0 }}>{label}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0' }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* ── Setup instructions ── */}
              <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Setup</div>
                {([
                  <>Open YTM Desktop → <b style={{ color: '#e2e8f0' }}>Settings → Integrations → Companion Server</b></>,
                  <>Toggle <b style={{ color: '#e2e8f0' }}>Enable Companion Server</b> ON; confirm port is <b style={{ color: '#e2e8f0' }}>9863</b></>,
                  <>Click <b style={{ color: '#e2e8f0' }}>Test Connection</b> to verify reachability, then <b style={{ color: '#e2e8f0' }}>Connect</b> to authorize Obie</>,
                ]).map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: i < 2 ? 8 : 0, fontSize: 13, color: '#999', lineHeight: '1.5' }}>
                    <span style={{ color: 'rgba(255,255,255,0.2)', minWidth: 18, fontFamily: 'monospace', flexShrink: 0 }}>{i + 1}.</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>

              {/* ── Error banner ── */}
              {ytmError && (
                <div style={{ marginBottom: 14, padding: '8px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', fontSize: 12 }}>
                  {ytmError}
                </div>
              )}

              {/* ── Action row ── */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={ytmTestConnection}
                  disabled={ytmTestResult === 'testing'}
                  style={{ padding: '9px 18px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: ytmTestResult === 'testing' ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: ytmTestResult === 'testing' ? 0.6 : 1 }}
                >
                  {ytmTestResult === 'testing' ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  onClick={ytmRequestAuth}
                  style={{ padding: '9px 18px', background: '#e33122', borderRadius: 9, border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                >
                  {getYtmToken() ? 'Reconnect YTM Desktop' : 'Connect YTM Desktop'}
                </button>
              </div>

              {/* ── Test result ── */}
              {ytmTestResult !== 'idle' && ytmTestMsg && (
                <div style={{ marginTop: 10, fontSize: 12, color: ytmTestResult === 'ok' ? '#4ade80' : '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'monospace' }}>{ytmTestResult === 'ok' ? '✓' : '✗'}</span>
                  <span>{ytmTestMsg}</span>
                </div>
              )}
            </div>
          )}
          {ytmError && ytmConnected && (
            <div style={{ position: 'absolute', top: 16, left: 16, right: 16, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 16px', color: '#fca5a5', fontSize: 12, textAlign: 'center' }}>
              {ytmError}
            </div>
          )}
        </div>
      )}

      {/* Click Prevention Overlay - Allows play when paused, blocks pause when playing */}
      {/* Disabled in YTM Desktop mode so the YTM overlay buttons are clickable */}
      <div
        className="absolute inset-0 w-full h-full cursor-default"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          // Allow clicking to PLAY when video is paused
          if (status?.state === 'paused' && playerRef.current && typeof playerRef.current.playVideo === 'function') {
            const statusPlaybackUrl = status.local_url || status.current_media?.url || null;
            const statusSourceIsLocal = status.source === 'cloudflare' || status.source === 'local';
            const statusMediaIsYouTube = isYouTubePlaybackUrl(statusPlaybackUrl);
            const statusPlaybackIsLocal = !!statusPlaybackUrl && !statusMediaIsYouTube;
            const expectedYouTubeId = extractYouTubeId(statusPlaybackUrl || '');
            if ((statusSourceIsLocal || statusPlaybackIsLocal) && statusPlaybackIsLocal) {
              console.log('[Player] Click PLAY ignored for local/Cloudflare status; <video> owns playback');
              return false;
            }
            if (
              expectedYouTubeId
              && (
                currentMediaIdRef.current !== status.current_media_id
                || currentYouTubeIdRef.current !== expectedYouTubeId
              )
            ) {
              console.warn('[Player] Click PLAY ignored because iframe media does not match player_status', {
                status_media_id: status.current_media_id,
                loaded_media_id: currentMediaIdRef.current,
                expected_youtube_id: expectedYouTubeId,
                loaded_youtube_id: currentYouTubeIdRef.current,
              });
              if (status.current_media) {
                setCurrentMedia(status.current_media);
              }
              return false;
            }
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
        style={{ pointerEvents: playerMode === 'ytm_desktop' ? 'none' : 'auto' }}
      />

      {identifyUntil && (
        <div
          className="absolute inset-0 pointer-events-none z-20 animate-pulse"
          style={{
            border: '10px solid rgba(239, 68, 68, 0.96)',
            boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.2), 0 0 34px rgba(239,68,68,0.45)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 18,
              left: 18,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgba(127, 29, 29, 0.92)',
              border: '1px solid rgba(248, 113, 113, 0.65)',
              color: '#fee2e2',
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Identify Player
          </div>
        </div>
      )}

      {/* Only the current master endpoint shows the Outside Obie logo */}
      {!isSlavePlayer && (
        <img
          src="/Obie_neon_no_BG.png"
          alt="Obie Logo"
          className="absolute bottom-[40px] left-[20px] w-[8vw] h-auto pointer-events-none z-10"
          style={{ maxWidth: '160px', minWidth: '60px' }}
        />
      )}

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
            <div className="mb-1 text-gray-300 truncate">{cleanDisplayText(currentMedia.title)}</div>
            <div className="text-gray-500 text-xs truncate">{cleanDisplayText(currentMedia.artist)}</div>
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
            <div className="inline-block w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
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

      {refreshPrompt && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            zIndex: 80,
            background: 'rgba(0,0,0,0.78)',
            backdropFilter: 'blur(5px)',
          }}
          onClick={() => setRefreshPrompt(null)}
        >
          <div
            style={{
              width: 'min(520px, calc(100vw - 48px))',
              padding: '30px 34px',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.16)',
              background: 'rgba(17,17,17,0.96)',
              boxShadow: '0 24px 90px rgba(0,0,0,0.86)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              textAlign: 'center',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>
              {typeof refreshPrompt.payload?.title === 'string' ? refreshPrompt.payload.title : 'Update available'}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,0.72)', maxWidth: 430 }}>
              {typeof refreshPrompt.payload?.message === 'string'
                ? refreshPrompt.payload.message
                : 'A newer Obie build is available. Refresh this screen now.'}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setRefreshPrompt(null)}
                style={{
                  padding: '11px 18px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.82)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: '11px 20px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: '#fff',
                  color: '#111',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Refresh Now
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
