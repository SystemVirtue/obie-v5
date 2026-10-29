// Slideshow Overlay — purely presentational layer that sits on top of the
// now-playing video and cycles through stills / short muted clips.
//
// Design constraints (deliberate):
//   * Never touches player control. No playVideo/pauseVideo/volume calls, no
//     interaction with the click-prevention overlay. It only paints.
//   * `pointer-events: none`, so it can never swallow a click or block the
//     "click to play when paused" behaviour underneath it.
//   * Transparent layer, and the media itself is inset by 5% of the viewport on
//     every edge. The now-playing video therefore stays VISIBLE behind and
//     around the slide — nothing is ever hidden or blacked out.
//   * Media is FITTED, not cropped to fill: `object-fit: contain` keeps the
//     whole still/clip on screen inside the allowed inset area, and the Ken
//     Burns move travels *under* fit so a zoom never crops it either.
//   * Occlusion does not change layout geometry, so the YouTube iframe's
//     IntersectionObserver viewability is unaffected (now unobstructed, so
//     viewability is at least as good as before) — the music video keeps
//     playing and its audio keeps flowing at the configured level.
//   * Every slideshow <video> is muted with volume pinned to 0. Only the music
//     video is ever audible. Slideshow media never enters the audio graph.
//   * Single-slot renderer: exactly one media element is mounted at a time, so
//     TV/kiosk hardware never has to decode two clips at once.
//   * Stills use a randomly chosen transition: a plain fade-in/fade-out, or a
//     slow "Ken Burns" move (push-in, pull-back, or a horizontal drift). All are
//     plain CSS transitions — no requestAnimationFrame animation loop. When the
//     Ken Burns option is on, the move runs for the whole hold time, so the
//     image appears to move continuously rather than settling.
//   * Optional vignette feathers the slide's edges into the video behind it via
//     `mask-image`, so borders never read as a hard rectangle. Unlike a darkened
//     gradient it never dims the picture — it fades the edges to transparent.
//   * Fail-open: a bad URL skips forward; the overlay never black-screens or
//     blocks playback. A video watchdog advances if no frame ever arrives, so a
//     stalled or undecodable clip can never leave a permanent gap.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SlideshowMediaItem } from '@shared/supabase-client';

type Slide = { url: string; type: 'image' | 'video' };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(mp4|webm|m4v|mov|ogv|ogg|mkv)(?:[?#]|$)/i;

/** Hard ceiling for a video slide in case its `ended` event never fires. */
const VIDEO_SAFETY_MS = 180_000;
/** Grace period added to an image's hold time in case `load` never fires. */
const IMAGE_LOAD_GRACE_MS = 15_000;
/** Duration of the slow "Ken Burns" push/pull applied to still images. */
const IMAGE_ZOOM_MS = 2_000;
/** How far the Ken Burns move travels: the still starts 8% under fit and grows. */
const IMAGE_ZOOM_SCALE = 1.08;
/** Inset from every edge so the now-playing video stays visible around a slide. */
const MEDIA_INSET = '5%';
/** Horizontal travel of a "pan" Ken Burns move, as a percentage of slide width. */
const PAN_DRIFT_PERCENT = 2;
/** Advance a video slide if no frame arrives within this window. */
const VIDEO_WATCHDOG_MS = 12_000;

/** Transition style for a still image. */
type ImageMotion = 'fade' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';

/** Ken Burns configuration resolved from `player_settings`. */
type KenBurnsStyle = 'fade' | 'zoom' | 'pan' | 'both' | 'random';

/**
 * Pick a transition for the next still. With Ken Burns off this reproduces the
 * original behaviour: half the stills fade plainly, the rest split evenly between
 * pushing in and pulling back. With Ken Burns on the configured style decides the
 * palette — `both`/`random` mix fades, zooms and drifts. Randomised per slide so
 * the rotation never feels mechanical.
 */
function pickImageMotion(kenburns: boolean, style: KenBurnsStyle): ImageMotion {
  if (!kenburns) {
    if (Math.random() < 0.5) return 'fade';
    return Math.random() < 0.5 ? 'zoom-in' : 'zoom-out';
  }

  const modes: ImageMotion[] =
    style === 'fade'
      ? ['fade']
      : style === 'zoom'
        ? ['zoom-in', 'zoom-out']
        : style === 'pan'
          ? ['pan-left', 'pan-right']
          : ['fade', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right'];
  return modes[Math.floor(Math.random() * modes.length)] ?? 'fade';
}


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
  /** Run the Ken Burns move for the whole hold time instead of a fixed 2s. */
  kenburnsEnabled?: boolean;
  /** Which moves the Ken Burns option may pick from. Defaults to `random`. */
  kenburnsStyle?: KenBurnsStyle;
  /** Vignette strength 0-100; 0 disables it. Defaults to 0. */
  vignetteStrength?: number;
  /** Advance a video slide if no frame arrives within this window. Defaults to 12s. */
  videoWatchdogMs?: number;
}

export default function SlideshowOverlay({
  active,
  slides,
  imageSeconds = 5,
  fadeMs = 600,
  kenburnsEnabled = false,
  kenburnsStyle = 'random',
  vignetteStrength = 0,
  videoWatchdogMs = VIDEO_WATCHDOG_MS,
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
  // Transition chosen for the current still, plus whether its Ken Burns move has
  // been kicked off. `motionOn` only ever flips false -> true for a slide, so a
  // zoom never rewinds while the slide is fading out.
  const [imageMotion, setImageMotion] = useState<ImageMotion>('fade');
  const [motionOn, setMotionOn] = useState(false);

  const orderRef = useRef<number[]>([]);
  const cursorRef = useRef(0);
  const lastUrlRef = useRef<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const preloadedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<number | null>(null);
  const advanceRef = useRef<() => void>(() => {});
  // Purely visual settings. Held in refs so changing them never restarts the
  // rotation or resets the timer that is already running.
  const kenburnsRef = useRef(kenburnsEnabled);
  kenburnsRef.current = kenburnsEnabled;
  const kenburnsStyleRef = useRef(kenburnsStyle);
  kenburnsStyleRef.current = kenburnsStyle;
  const videoWatchdogMsRef = useRef(videoWatchdogMs);
  videoWatchdogMsRef.current = videoWatchdogMs;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const videoWatchdogRef = useRef<number | null>(null);

  const clearVideoWatchdog = useCallback(() => {
    if (videoWatchdogRef.current !== null) {
      window.clearTimeout(videoWatchdogRef.current);
      videoWatchdogRef.current = null;
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
      setMotionOn(false);
      setImageMotion('fade');
      return;
    }

    let cancelled = false;
    const fade = Math.max(0, fadeMs);
    const holdMs = Math.max(1, imageSeconds) * 1000;

    const advance = () => {
      if (cancelled) return;
      clearTimer();
      clearVideoWatchdog();
      setVisible(false); // fade the current slide out, revealing the video behind

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

        // Pick this still's transition up front so the new element mounts at its
        // *starting* transform (under fit for a push-in, exactly fit for a
        // pull-back) and the CSS transition has somewhere to travel from.
        // Videos never zoom.
        setImageMotion(
          slide.type === 'image'
            ? pickImageMotion(kenburnsRef.current, kenburnsStyleRef.current)
            : 'fade',
        );
        setMotionOn(false);
        setCurrent(slide);

        // Next frame, so the new element mounts at opacity 0 (and at its base
        // scale) and the CSS transition actually runs instead of snapping in.
        requestAnimationFrame(() => {
          if (cancelled) return;
          setVisible(true);
          setMotionOn(true);
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
      clearVideoWatchdog();
    };
  }, [active, poolKey, imageSeconds, fadeMs, clearTimer, clearVideoWatchdog, takeNext, peekNext, preload]);

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
   *
   * Also arms the watchdog. A `.mov` (QuickTime) or otherwise undecodable clip
   * cannot play in Chromium; if it never reaches `playing`, this timer advances
   * past it instead of leaving a gap on screen for the full safety ceiling.
   */
  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.volume = 0;
    const played = el.play();
    if (played && typeof played.catch === 'function') played.catch(() => {});

    clearVideoWatchdog();
    const disarm = () => clearVideoWatchdog();
    el.addEventListener('playing', disarm);
    el.addEventListener('timeupdate', disarm);
    el.addEventListener('loadeddata', disarm);
    videoWatchdogRef.current = window.setTimeout(
      () => advanceRef.current(),
      Math.max(1000, videoWatchdogMsRef.current),
    );
  }, [clearVideoWatchdog]);

  if (!active || !current) return null;

  const fadeSeconds = Math.max(0, fadeMs) / 1000;
  const zooming = current.type === 'image' && imageMotion !== 'fade';
  const panning = imageMotion === 'pan-left' || imageMotion === 'pan-right';

  // With Ken Burns on the move runs for the whole hold, so the image drifts
  // continuously instead of settling after 2s. With it off the original fixed
  // 2s move is kept.
  const motionSeconds = kenburnsEnabled
    ? Math.max(1, imageSeconds)
    : IMAGE_ZOOM_MS / 1000;

  // The move travels *below* fit rather than above it, so a still is never
  // cropped or pushed off screen: a push-in starts at fit-and-shrunk and grows
  // to exactly fit, a pull-back starts at fit and settles back down. A drift
  // stays at fit-and-shrunk throughout, so its slack absorbs the sideways travel
  // and the clip box never crops it.
  // `motionOn` only flips true once, so the move never rewinds while the slide
  // is fading out.
  const fitScale = 1 / IMAGE_ZOOM_SCALE;
  let scale = 1;
  let drift = 0;
  if (zooming) {
    if (imageMotion === 'zoom-in') {
      scale = motionOn ? 1 : fitScale;
    } else if (imageMotion === 'zoom-out') {
      scale = motionOn ? fitScale : 1;
    } else if (panning) {
      scale = fitScale;
      const dir = imageMotion === 'pan-left' ? 1 : -1;
      drift = motionOn ? -dir * PAN_DRIFT_PERCENT : dir * PAN_DRIFT_PERCENT;
    }
  }

  // Vignette: fade the slide's own edges to transparent so its border melts into
  // the playing video instead of reading as a hard rectangle. A mask (rather than
  // a darkened gradient) never dims the picture itself.
  const vignette = Math.max(0, Math.min(100, vignetteStrength));
  const vignetteMask =
    current.type === 'image' && vignette > 0
      ? `radial-gradient(ellipse at center, rgba(0,0,0,1) ${Math.max(0, 100 - vignette)}%, rgba(0,0,0,0) 100%)`
      : undefined;

  const mediaStyle = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    // `contain`, not `cover`: fit the whole still/clip inside the allowed area
    // instead of zooming-to-fill and cropping its edges off screen.
    objectFit: 'contain' as const,
    objectPosition: 'center center',
    transform: zooming
      ? `scale(${scale})${panning ? ` translateX(${drift}%)` : ''}`
      : 'none',
    transformOrigin: 'center center',
    ...(vignetteMask
      ? { maskImage: vignetteMask, WebkitMaskImage: vignetteMask }
      : {}),
    opacity: visible ? 1 : 0,
    transition: zooming
      ? `opacity ${fadeSeconds}s ease-in-out, transform ${motionSeconds}s ${kenburnsEnabled ? 'linear' : 'ease-in-out'}`
      : `opacity ${fadeSeconds}s ease-in-out`,
  };

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 9 }}
    >
      {/* Transparent layer: the now-playing video stays visible behind the slide
          and in the border. The inner clip box holds the 5% inset and stops the
          Ken Burns zoom from spilling into that border. */}
      <div style={{ position: 'absolute', inset: MEDIA_INSET, overflow: 'hidden' }}>
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
    </div>
  );
}
