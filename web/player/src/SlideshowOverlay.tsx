// Slideshow Overlay — purely presentational layer that sits on top of the
// now-playing video and cycles through stills / short muted clips.
//
// Design constraints (deliberate):
//   * Never touches player control. No playVideo/pauseVideo/volume calls, no
//     interaction with the click-prevention overlay. It only paints.
//   * `pointer-events: none`, so it can never swallow a click or block the
//     "click to play when paused" behaviour underneath it.
//   * Occlusion does not change layout geometry, so the YouTube iframe's
//     IntersectionObserver viewability is unaffected — the music video keeps
//     playing and its audio keeps flowing at the configured level.
//   * Every slideshow <video> is muted with volume pinned to 0. Only the music
//     video is ever audible. Slideshow media never enters the audio graph.
//   * Single-slot renderer: exactly one media element is mounted at a time, so
//     TV/kiosk hardware never has to decode two clips at once.
//   * Fades are plain CSS opacity transitions — no requestAnimationFrame loop.
//   * Fail-open: a bad URL skips forward; the overlay never black-screens or
//     blocks playback.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SlideshowMediaItem } from '@shared/supabase-client';

type Slide = { url: string; type: 'image' | 'video' };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(mp4|webm|m4v|mov|ogv|ogg|mkv)(?:[?#]|$)/i;

/** Hard ceiling for a video slide in case its `ended` event never fires. */
const VIDEO_SAFETY_MS = 180_000;
/** Grace period added to an image's hold time in case `load` never fires. */
const IMAGE_LOAD_GRACE_MS = 15_000;

/**
 * Coerce whatever is stored in `player_settings.slideshow_media` into a clean,
 * de-duplicated list. Tolerates plain URL strings as well as `{ url, type }`
 * objects, and drops anything that is not an http(s) URL or whose kind cannot
 * be determined.
 */
export function normalizeSlides(raw: unknown): Slide[] {
  if (!Array.isArray(raw)) return [];

  const out: Slide[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    let url = '';
    let declared: string | undefined;

    if (typeof entry === 'string') {
      url = entry.trim();
    } else if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      url = typeof obj.url === 'string' ? obj.url.trim() : '';
      declared = typeof obj.type === 'string' ? obj.type.toLowerCase() : undefined;
    }

    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;

    let type: 'image' | 'video' | null =
      declared === 'image' || declared === 'video' ? declared : null;
    if (!type) {
      type = VIDEO_EXT.test(url) ? 'video' : IMAGE_EXT.test(url) ? 'image' : null;
    }
    if (!type) continue;

    seen.add(url);
    out.push({ url, type });
  }

  return out;
}

interface SlideshowOverlayProps {
  /** True when the slideshow is enabled AND the player is not in an error state. */
  active: boolean;
  /** Cached manifest from `player_settings.slideshow_media`. */
  slides?: SlideshowMediaItem[] | null;
  /** Seconds each still image is held. Defaults to 5. */
  imageSeconds?: number;
  /** Cross-fade duration in milliseconds. Defaults to 600. */
  fadeMs?: number;
}

export default function SlideshowOverlay({
  active,
  slides,
  imageSeconds = 5,
  fadeMs = 600,
}: SlideshowOverlayProps) {
  // Normalise once per distinct URL set. `poolKey` is what drives restarts, so
  // an unrelated settings save (new object identity, same URLs) never restarts
  // the rotation.
  const pool = useMemo(() => normalizeSlides(slides), [slides]);
  const poolKey = useMemo(() => pool.map((slide) => slide.url).join('|'), [pool]);

  // Latest pool readable from timer callbacks without re-running the effect.
  const poolRef = useRef<Slide[]>(pool);
  poolRef.current = pool;

  const [current, setCurrent] = useState<Slide | null>(null);
  const [visible, setVisible] = useState(false);

  const orderRef = useRef<number[]>([]);
  const cursorRef = useRef(0);
  const lastUrlRef = useRef<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const preloadedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<number | null>(null);
  const advanceRef = useRef<() => void>(() => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Warm the next still so the fade-in doesn't land on an empty frame. */
  const preload = useCallback((slide: Slide | null) => {
    if (!slide || slide.type !== 'image' || preloadedRef.current.has(slide.url)) return;
    preloadedRef.current.add(slide.url);
    const img = new Image();
    img.decoding = 'async';
    img.src = slide.url;
  }, []);

  /** Fisher-Yates shuffle, avoiding an immediate repeat across a reshuffle. */
  const buildOrder = useCallback((length: number) => {
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = indices[i];
      indices[i] = indices[j];
      indices[j] = swap;
    }

    const lastUrl = lastUrlRef.current;
    if (length > 1 && lastUrl) {
      const lastIdx = indices.findIndex((i) => poolRef.current[i]?.url === lastUrl);
      if (lastIdx === 0) {
        const swap = indices[0];
        indices[0] = indices[1];
        indices[1] = swap;
      }
    }
    return indices;
  }, []);

  /** Pull the next slide, reshuffling and looping forever on exhaustion. */
  const takeNext = useCallback(() => {
    const list = poolRef.current;
    if (list.length === 0) return null;

    if (cursorRef.current >= orderRef.current.length) {
      orderRef.current = buildOrder(list.length);
      cursorRef.current = 0;
    }

    const slide = list[orderRef.current[cursorRef.current]];
    cursorRef.current += 1;
    return slide ?? null;
  }, [buildOrder]);

  /** Best-effort peek at the following slide, used only for image preloading. */
  const peekNext = useCallback(() => {
    const list = poolRef.current;
    if (list.length === 0) return null;
    if (cursorRef.current >= orderRef.current.length) return list[0] ?? null;
    return list[orderRef.current[cursorRef.current]] ?? null;
  }, []);

  // The rotation lives in a single effect keyed on the URL set, so timers are
  // owned in one place and always torn down cleanly.
  useEffect(() => {
    clearTimer();
    orderRef.current = [];
    cursorRef.current = 0;
    preloadedRef.current = new Set();
    lastUrlRef.current = null;
    currentUrlRef.current = null;
    advanceRef.current = () => {};

    const list = poolRef.current;
    if (!active || list.length === 0) {
      setVisible(false);
      setCurrent(null);
      return;
    }

    let cancelled = false;
    const fade = Math.max(0, fadeMs);
    const holdMs = Math.max(1, imageSeconds) * 1000;

    const advance = () => {
      if (cancelled) return;
      clearTimer();
      setVisible(false); // fade the current slide out onto the opaque black backdrop

      timerRef.current = window.setTimeout(() => {
        if (cancelled) return;

        const slide = takeNext();
        if (!slide) {
          setCurrent(null);
          currentUrlRef.current = null;
          return;
        }

        lastUrlRef.current = slide.url;
        currentUrlRef.current = slide.url;
        setCurrent(slide);

        // Next frame, so the new element mounts at opacity 0 and the CSS
        // transition actually runs 0 -> 1 instead of snapping in.
        requestAnimationFrame(() => {
          if (!cancelled) setVisible(true);
        });

        preload(peekNext());

        if (slide.type === 'image') {
          // Replaced with the real hold time by handleImageLoad once decoded;
          // this is only the fallback for an image whose load never fires.
          timerRef.current = window.setTimeout(advance, holdMs + IMAGE_LOAD_GRACE_MS);
        } else {
          // Videos advance on `ended`; this is only the safety net.
          timerRef.current = window.setTimeout(advance, VIDEO_SAFETY_MS);
        }
      }, fade);
    };

    advanceRef.current = advance;
    advance();

    return () => {
      cancelled = true;
      advanceRef.current = () => {};
      clearTimer();
    };
  }, [active, poolKey, imageSeconds, fadeMs, clearTimer, takeNext, peekNext, preload]);

  /**
   * Start the image's hold time when it actually decodes, so a slow load does
   * not eat into its display time.
   */
  const handleImageLoad = useCallback(() => {
    if (!currentUrlRef.current) return;
    clearTimer();
    timerRef.current = window.setTimeout(
      () => advanceRef.current(),
      Math.max(1, imageSeconds) * 1000,
    );
  }, [clearTimer, imageSeconds]);

  /**
   * Pin the clip silent at mount time. React's `muted` prop is not reliably
   * reflected as the DOM property, and autoplay only works when the element is
   * genuinely muted, so set it explicitly before play().
   */
  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.volume = 0;
    const played = el.play();
    if (played && typeof played.catch === 'function') played.catch(() => {});
  }, []);

  if (!active || !current) return null;

  const fadeSeconds = Math.max(0, fadeMs) / 1000;
  const mediaStyle = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    objectPosition: 'center center',
    opacity: visible ? 1 : 0,
    transition: `opacity ${fadeSeconds}s ease-in-out`,
  };

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"
      style={{ zIndex: 9, background: '#000' }}
    >
      {current.type === 'image' ? (
        <img
          key={current.url}
          src={current.url}
          alt=""
          draggable={false}
          onLoad={handleImageLoad}
          onError={() => advanceRef.current()}
          style={mediaStyle}
        />
      ) : (
        <video
          key={current.url}
          ref={setVideoEl}
          src={current.url}
          muted
          autoPlay
          playsInline
          preload="auto"
          controls={false}
          disablePictureInPicture
          tabIndex={-1}
          onEnded={() => advanceRef.current()}
          onError={() => advanceRef.current()}
          // Belt-and-braces for "mute all slideshow audio": if anything nudges
          // the element's volume, snap it straight back to silent.
          onVolumeChange={(event) => {
            const el = event.currentTarget;
            if (!el.muted) el.muted = true;
            if (el.volume !== 0) el.volume = 0;
          }}
          style={mediaStyle}
        />
      )}
    </div>
  );
}
