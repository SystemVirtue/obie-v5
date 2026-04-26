// Obie Admin Console v2 — Obsidian Stage Design
// All data flows through real Supabase subscriptions and Edge Function calls.
// No mock data. No simulated anything.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  supabase,
  subscribeToQueue,
  subscribeToPlayerStatus,
  subscribeToPlayerSettings,
  subscribeToPlayerEndpoints,
  subscribeToAdminBroadcasts,
  subscribeToTable,
  callQueueManager,
  callPlayerControl,
  callPlaylistManager,
  callKioskHandler,
  createAdminBroadcast,
  callRadioGenerator,
  getPlaylists,
  getPlaylistItems,
  getTotalCredits,
  updateAllCredits,
  type QueueItem,
  type Player,
  type PlayerStatus,
  type SystemLog,
  type Playlist,
  type PlaylistItem,
  type PlayerSettings,
  type PlayerEndpoint,
  type MediaItem,
  type AdminBroadcast,
  type R2File,
  signIn,
  signOut,
  getCurrentUser,
  subscribeToAuth,
  type AuthUser,
} from '@shared/supabase-client';
import { cleanDisplayText } from '../../shared/media-utils';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PLAYER_ID = '00000000-0000-0000-0000-000000000001';

// ─────────────────────────────────────────────────────────────────────────────
// PREFERENCES  (localStorage-backed font size + accent colour)
// ─────────────────────────────────────────────────────────────────────────────

const FS_SCALES = [
  { zoom: 0.82, label: 'Smallest', pct: '82%' },
  { zoom: 0.91, label: 'Smaller',  pct: '91%' },
  { zoom: 1.00, label: 'Normal',   pct: '100%' },
  { zoom: 1.10, label: 'Larger',   pct: '110%' },
  { zoom: 1.22, label: 'Largest',  pct: '122%' },
];

const PRESET_COLOURS = [
  { hex: '#f59e0b', name: 'Amber' },    { hex: '#ef4444', name: 'Red' },
  { hex: '#f97316', name: 'Orange' },   { hex: '#eab308', name: 'Yellow' },
  { hex: '#22c55e', name: 'Green' },    { hex: '#14b8a6', name: 'Teal' },
  { hex: '#06b6d4', name: 'Cyan' },     { hex: '#3b82f6', name: 'Blue' },
  { hex: '#6366f1', name: 'Indigo' },   { hex: '#8b5cf6', name: 'Violet' },
  { hex: '#d946ef', name: 'Fuchsia' },  { hex: '#ec4899', name: 'Pink' },
  { hex: '#a3e635', name: 'Lime' },     { hex: '#94a3b8', name: 'Slate' },
  { hex: '#ffffff', name: 'White' },
];

// Hardcoded playlists matching import-all-playlists.sh
const PREDEFINED_PLAYLISTS = [
  { ytId: 'PLJ7vMjpVbhBWLWJpweVDki43Wlcqzsqdu', name: 'DJAMMMS Default Playlist' },
  { ytId: 'PLN9QqCogPsXIoSObV0F39OZ_MlRZ9tRT9', name: 'Obie Nights' },
  { ytId: 'PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH', name: 'Obie Playlist' },
  { ytId: 'PLN9QqCogPsXIkPh6xm7cxSN9yTVaEoj0j', name: 'Obie Jo' },
  { ytId: 'PLN9QqCogPsXLAtgvLQ0tvpLv820R7PQsM', name: 'Karaoke' },
  { ytId: 'PLN9QqCogPsXLsv5D5ZswnOSnRIbGU80IS', name: 'Poly' },
  { ytId: 'PLN9QqCogPsXIqfwdfe4hf3qWM1mFweAXP', name: 'Obie Johno' },
];

// ─── Colour helpers ──────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function darkenHex(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  return '#' + [r, g, b].map(v => Math.round(v * (1 - pct)).toString(16).padStart(2, '0')).join('');
}
function isLightColour(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 186;
}
function applyAccentCSS(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const [r, g, b] = hexToRgb(hex);
  const root = document.documentElement;
  root.style.setProperty('--accent',        hex);
  root.style.setProperty('--accent-dark',   darkenHex(hex, 0.12));
  root.style.setProperty('--accent-dim',    `rgba(${r},${g},${b},0.15)`);
  root.style.setProperty('--accent-border', `rgba(${r},${g},${b},0.30)`);
  root.style.setProperty('--accent-glow',   `rgba(${r},${g},${b},0.38)`);
  root.style.setProperty('--accent-rgb',    `${r},${g},${b}`);
}
function applyZoom(zoom: number) {
  const el = document.getElementById('root');
  if (el) (el.style as unknown as Record<string,string>).zoom = String(zoom);
}

// ─── Prefs hook ──────────────────────────────────────────────────────────────
function usePrefs() {
  const [accent, setAccentState] = useState(() => {
    try { return localStorage.getItem('obie_accent') || '#f59e0b'; } catch { return '#f59e0b'; }
  });
  const [fsIdx, setFsIdxState] = useState(() => {
    try { const v = localStorage.getItem('obie_fontsize'); return v !== null ? parseInt(v, 10) : 2; }
    catch { return 2; }
  });
  useEffect(() => { applyAccentCSS(accent); }, [accent]);
  useEffect(() => { applyZoom(FS_SCALES[fsIdx].zoom); }, [fsIdx]);

  const setAccent = useCallback((hex: string) => {
    setAccentState(hex); applyAccentCSS(hex);
    try { localStorage.setItem('obie_accent', hex); } catch { /* noop */ }
  }, []);
  const setFsIdx = useCallback((idx: number) => {
    const c = Math.max(0, Math.min(FS_SCALES.length - 1, idx));
    setFsIdxState(c); applyZoom(FS_SCALES[c].zoom);
    try { localStorage.setItem('obie_fontsize', String(c)); } catch { /* noop */ }
  }, []);

  return { accent, setAccent, fsIdx, setFsIdx, fsScale: FS_SCALES[fsIdx] };
}

type Prefs = ReturnType<typeof usePrefs>;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function fmtDuration(sec: number | null | undefined): string {
  const s = sec ?? 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div className="animate-spin rounded-full border-2 border-t-transparent inline-block"
      style={{ width: size, height: size, borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      style={{ width: 44, height: 24, borderRadius: 999, flexShrink: 0,
        background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.12)', transition: 'background 0.2s',
        position: 'relative', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        border: 'none', outline: 'none' }}>
      <span style={{ position: 'absolute', top: 3, left: checked ? 23 : 3, width: 18, height: 18,
        borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }} />
    </button>
  );
}

function PanelHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 24px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>{title}</h1>
        {subtitle && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

function Btn({ onClick, children, variant = 'ghost', disabled, style: xs }: {
  onClick?: (e: React.MouseEvent) => void; children: React.ReactNode;
  variant?: 'accent' | 'solid' | 'ghost' | 'danger'; disabled?: boolean; style?: React.CSSProperties;
}) {
  const vmap: Record<string, React.CSSProperties> = {
    accent: { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' },
    solid:  { background: 'var(--accent)', color: '#000' },
    ghost:  { background: 'rgba(255,255,255,0.05)', color: 'var(--muted)', border: '1px solid rgba(255,255,255,0.1)' },
    danger: { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' },
  };
  return (
    <button disabled={disabled} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: 'none',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
        ...vmap[variant], ...xs }}>
      {children}
    </button>
  );
}

function SaveBtn({ onSave, loading }: { onSave: () => Promise<void>; loading?: boolean }) {
  const [saved, setSaved] = useState(false);
  const handle = async () => { await onSave(); setSaved(true); setTimeout(() => setSaved(false), 2500); };
  return (
    <button onClick={handle} disabled={loading}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 12,
        cursor: loading ? 'default' : 'pointer', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600,
        background: saved ? 'rgba(34,197,94,0.18)' : 'var(--accent)',
        color: saved ? '#4ade80' : '#000',
        border: saved ? '1px solid rgba(34,197,94,0.4)' : 'none', transition: 'all 0.2s' }}>
      {loading ? <Spinner size={14} /> : saved ? '✓ Saved' : 'Save Settings'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN FORM
// ─────────────────────────────────────────────────────────────────────────────

function LoginForm({ onSignIn }: { onSignIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const result = await signIn(email, password);
      if (result.user) {
        onSignIn({ id: result.user.id, email: result.user.email || '',
          role: result.user.user_metadata?.role || result.user.app_metadata?.role });
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed to sign in'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 50% 0%,rgba(245,158,11,0.08),transparent)', pointerEvents: 'none' }} />
      <div style={{ width: 380, background: '#0e0e0e', border: '1px solid var(--border)', borderRadius: 20, padding: 36, position: 'relative' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', boxShadow: '0 0 24px var(--accent-glow)' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: '#000' }}>O</span>
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>Obie Admin</h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4, letterSpacing: '0.1em' }}>CONSOLE ACCESS</p>
        </div>
        <form onSubmit={handleSubmit}>
          {['Email', 'Password'].map((label) => (
            <div key={label} style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</label>
              <input type={label === 'Password' ? 'password' : 'email'} required
                value={label === 'Email' ? email : password}
                onChange={e => label === 'Email' ? setEmail(e.target.value) : setPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, background: '#0a0a0a',
                  border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' }} />
            </div>
          ))}
          {error && <p style={{ color: '#f87171', fontSize: 12, marginBottom: 12, fontFamily: 'var(--font-mono)' }}>{error}</p>}
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', cursor: loading ? 'default' : 'pointer',
              background: 'var(--accent)', color: '#000', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
              opacity: loading ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {loading ? <><Spinner size={16} /> Signing in…</> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NOW PLAYING STAGE
// ─────────────────────────────────────────────────────────────────────────────

function NowPlayingStage({ status, queue, settings, onPlayPause, onSkip, isSkipping, onRemove, masterOfflineWarning }: {
  status: PlayerStatus | null; queue: QueueItem[]; settings: PlayerSettings | null;
  onPlayPause: () => void; onSkip: () => void; isSkipping: boolean; onRemove: (id: string) => void;
  masterOfflineWarning?: string | null;
}) {
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cm = (status as any)?.current_media as any;
  const thumb  = cm?.thumbnail || '';
  const title  = cm?.title     || 'Nothing playing';
  const artist = cm?.artist    || '—';
  const isPlaying = status?.state === 'playing';
  const isPaused  = status?.state === 'paused';
  const progress  = Math.min(100, (status?.progress ?? 0) * 100);
  const stateLabel = isSkipping ? 'SKIPPING' : isPlaying ? 'Now Playing' : isPaused ? 'Paused' : (status?.state || 'Idle');
  const playbackSource = status?.source ?? 'youtube';
  const sourceLabel =
    playbackSource === 'cloudflare' ? 'Cached Cloudflare'
    : playbackSource === 'local' ? 'Local fallback'
    : 'YouTube iframe';
  const playbackConfirmed = !!status?.playback_started_at;
  const playbackError = status?.playback_error;
  const handlePlayPauseClick = () => {
    if (isSkipping) return;
    if (isPlaying) { setShowPauseConfirm(true); } else { onPlayPause(); }
  };

  // 🐛 DEBUG: Track what's playing vs what's in queue
  console.log('[NowPlayingStage] 🎵 Current playing status:', {
    current_media_id: (status as any)?.current_media_id?.slice(0, 8) || 'none',
    title: title,
    state: status?.state,
    queue_length: queue.length,
    queue_items: queue.map(item => ({
      id: item.id.slice(0, 8),
      media_id: item.media_item_id?.slice(0, 8),
      position: item.position,
      type: item.type,
      title: item.media_item?.title?.slice(0, 30)
    }))
  });

  // Check if current media is actually in the queue
  const currentQueueItem = queue.find((item) => item.media_item_id === (status as any)?.current_media_id);
  console.log('[NowPlayingStage] 🎯 currentQueueItem match:', {
    found: !!currentQueueItem,
    media_id: currentQueueItem?.media_item_id?.slice(0, 8) || 'none',
    position: currentQueueItem?.position,
    type: currentQueueItem?.type,
    title: currentQueueItem?.media_item?.title?.slice(0, 30) || 'none'
  });

  const upNext   = queue.filter(q => q.media_item_id !== (status as any)?.current_media_id).slice(0, 3);
  const priority = queue.filter(q => q.type === 'priority');

  return (
    <div style={{ position: 'relative', height: '33vh', minHeight: 240, flexShrink: 0, overflow: 'hidden', background: '#050505' }}>
      {/* Blurred art backdrop */}
      {thumb && <>
        <img src={thumb} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(60px) saturate(1.4) brightness(0.28)', transform: 'scale(1.4)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(5,5,5,0.85) 0%,rgba(5,5,5,0.2) 50%,rgba(5,5,5,0.92) 100%)' }} />
      </>}
      {/* Grain */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.12, pointerEvents: 'none', backgroundSize: '128px',
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")` }} />
      {/* Bottom line */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,var(--accent-border),transparent)' }} />

      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '16px 22px 0' }}>
        {masterOfflineWarning && (
          <div style={{
            marginBottom: 10,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.14)',
            border: '1px solid rgba(248,113,113,0.35)',
            color: '#fca5a5',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.04em',
            textTransform: 'uppercase'
          }}>
            {masterOfflineWarning}
          </div>
        )}
        {/* Top */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          {/* Thumb */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 80, height: 80, borderRadius: 14, overflow: 'hidden', background: '#111', boxShadow: '0 8px 32px rgba(0,0,0,0.9),0 0 0 1px rgba(255,255,255,0.07)' }}>
              {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.15)', fontSize: 28 }}>♪</div>}
            </div>
            <div style={{ position: 'absolute', bottom: -3, right: -3, width: 14, height: 14, borderRadius: '50%', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: isPlaying ? '#22c55e' : '#fbbf24', boxShadow: `0 0 6px ${isPlaying ? '#22c55e' : '#fbbf24'}` }} />
            </div>
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: isSkipping ? '#f59e0b' : isPlaying ? '#22c55e' : '#fbbf24',
                boxShadow: `0 0 8px ${isSkipping ? '#f59e0b' : isPlaying ? '#22c55e' : '#fbbf24'}`,
                animation: (isPlaying || isSkipping) ? 'pulse 1.6s ease-in-out infinite' : 'none' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em',
                color: isSkipping ? '#f59e0b' : isPlaying ? '#4ade80' : 'rgba(255,255,255,0.4)',
                textTransform: 'uppercase', fontWeight: 600 }}>
                {stateLabel}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', borderRadius: 999,
                background: playbackSource === 'cloudflare' ? 'rgba(34,197,94,0.12)' : playbackSource === 'local' ? 'rgba(59,130,246,0.14)' : 'rgba(251,191,36,0.12)',
                color: playbackSource === 'cloudflare' ? '#4ade80' : playbackSource === 'local' ? '#93c5fd' : '#fbbf24',
                border: `1px solid ${playbackSource === 'cloudflare' ? 'rgba(34,197,94,0.25)' : playbackSource === 'local' ? 'rgba(59,130,246,0.3)' : 'rgba(251,191,36,0.25)'}` }}>
                {sourceLabel}
              </span>
              {status?.current_media_id && (
                <span title={playbackConfirmed ? `Confirmed ${new Date(status.playback_started_at as string).toLocaleTimeString()}` : 'Waiting for first real playing event'}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', borderRadius: 999,
                    background: playbackConfirmed ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                    color: playbackConfirmed ? '#86efac' : '#fbbf24',
                    border: `1px solid ${playbackConfirmed ? 'rgba(34,197,94,0.22)' : 'rgba(245,158,11,0.25)'}` }}>
                  {playbackConfirmed ? 'START CONFIRMED' : 'AWAITING START'}
                </span>
              )}
            </div>
            {playbackError && (
              <div style={{ marginBottom: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#fca5a5',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Last failure: {playbackError}{status?.playback_error_code ? ` (${status.playback_error_code})` : ''}
              </div>
            )}
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: '#fff',
              letterSpacing: '-0.03em', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textShadow: isPlaying ? '0 0 40px rgba(255,255,255,0.15)' : 'none' }}>{title}</h2>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'rgba(255,255,255,0.55)', marginTop: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>{artist}</p>
          </div>

          {/* Up Next */}
          <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', marginBottom: 2 }}>Up Next</div>
            {upNext.length === 0
              ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Queue empty</div>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              : upNext.map((item, i) => { const m = (item as any).media_item as any; return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 9, padding: '5px 9px', background: 'rgba(255,255,255,0.06)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.22)', width: 12 }}>{i + 1}</span>
                  {m?.thumbnail && <img src={m.thumbnail} alt="" style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m?.title || 'Unknown'}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{m?.artist || ''}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>{fmtDuration(m?.duration)}</span>
                  <button onClick={() => onRemove(item.id)} style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(239,68,68,0.12)', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 10, flexShrink: 0 }}>✕</button>
                </div>
              );})}
          </div>

          {/* Priority requests */}
          {/* Moved to upNext for consistent order */}
        </div>

        {/* Controls */}
        <div style={{ paddingBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
              {fmtDuration((status?.progress ?? 0) * (cm?.duration ?? 0))}
            </span>
            <div style={{ flex: 1, height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.1)', position: 'relative' }}>
              <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg,var(--accent),var(--accent-dark))', width: `${progress}%`, transition: 'width 0.5s linear' }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{fmtDuration(cm?.duration)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Play/Pause — RED+yellow when playing, GREEN+white when paused, grey when skipping */}
            <button onClick={handlePlayPauseClick} disabled={isSkipping}
              title={isSkipping ? 'Skipping…' : isPlaying ? 'Pause playback' : 'Resume playback'}
              style={{ width: 44, height: 44, borderRadius: '50%', border: 'none',
                cursor: isSkipping ? 'default' : 'pointer', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                background: isSkipping ? 'rgba(255,255,255,0.08)' : isPlaying ? '#dc2626' : '#16a34a',
                color: isSkipping ? 'rgba(255,255,255,0.25)' : isPlaying ? '#facc15' : '#fff',
                boxShadow: isSkipping ? 'none' : isPlaying ? '0 4px 18px rgba(220,38,38,0.45)' : '0 4px 18px rgba(22,163,74,0.45)',
                transition: 'background 0.2s, box-shadow 0.2s, color 0.2s',
                opacity: isSkipping ? 0.45 : 1 }}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button onClick={onSkip} disabled={isSkipping} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', cursor: isSkipping ? 'default' : 'pointer',
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, opacity: isSkipping ? 0.45 : 1 }}>
              {isSkipping ? <Spinner size={14} /> : '⏭'}
            </button>
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)' }}>🔊</span>
            <div style={{ width: 72 }}><input type="range" min={0} max={100} value={settings?.volume ?? 75} readOnly /></div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', width: 22 }}>{settings?.volume ?? 75}</span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99,
              background: isSkipping ? 'rgba(245,158,11,0.12)' : isPlaying ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${isSkipping ? 'rgba(245,158,11,0.3)' : isPlaying ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.1)'}` }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: isSkipping ? '#f59e0b' : isPlaying ? '#22c55e' : '#fbbf24' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: isSkipping ? '#fbbf24' : isPlaying ? '#4ade80' : '#fbbf24' }}>{stateLabel}</span>
            </div>
            {priority.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#60a5fa' }}>⭐ {priority.length} PRIORITY</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pause confirmation modal */}
      {showPauseConfirm && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowPauseConfirm(false)}>
          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: '28px 32px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, minWidth: 280,
            boxShadow: '0 24px 80px rgba(0,0,0,0.9)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>Pause Playback?</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setShowPauseConfirm(false)}
                style={{ padding: '9px 24px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)',
                  background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                  fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500 }}>
                Cancel
              </button>
              <button onClick={() => { setShowPauseConfirm(false); onPlayPause(); }}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none',
                  background: '#dc2626', color: '#fff', cursor: 'pointer',
                  fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
                  boxShadow: '0 4px 18px rgba(220,38,38,0.4)' }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────

type ViewId =
  | 'search'
  | 'library'
  | 'queue'
  | 'playlists-all' | 'playlists-import'
  | 'settings-playback' | 'settings-kiosk' | 'settings-branding' | 'settings-scripts' | 'settings-prefs'
  | 'logs';

const NAV = [
  { id: 'search',    icon: '🔍', label: 'Search',    children: [] as { id: ViewId; label: string }[] },
  { id: 'library',   icon: '💾', label: 'Browse Library', children: [] as { id: ViewId; label: string }[] },
  { id: 'queue',     icon: '🎵', label: 'Queue',     children: [] as { id: ViewId; label: string }[] },
  { id: 'playlists', icon: '📋', label: 'Playlists', children: [
    { id: 'playlists-all'    as ViewId, label: 'All Playlists' },
    { id: 'playlists-import' as ViewId, label: 'Import Playlist' },
  ]},
  { id: 'settings',  icon: '⚙️', label: 'Settings',  children: [
    { id: 'settings-playback' as ViewId, label: 'Playback' },
    { id: 'settings-kiosk'    as ViewId, label: 'Kiosk' },
    { id: 'settings-branding' as ViewId, label: 'Branding' },
    { id: 'settings-scripts'  as ViewId, label: 'Functions & Scripts' },
    { id: 'settings-prefs'    as ViewId, label: 'Console Preferences' },
  ]},
  { id: 'logs',      icon: '📄', label: 'Logs',      children: [] as { id: ViewId; label: string }[] },
];

function Sidebar({ view, setView, queue, user, onSignOut }: {
  view: ViewId; setView: (v: ViewId) => void;
  queue: QueueItem[]; user: AuthUser; onSignOut: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [openGroup, setOpenGroup] = useState<string>('queue');
  const priorityCount = queue.filter(q => q.type === 'priority').length;

  const handleGroup = (group: typeof NAV[0]) => {
    if (group.children.length === 0) { setOpenGroup(''); setView(group.id as ViewId); return; }
    const isOpen = openGroup === group.id;
    setOpenGroup(isOpen ? '' : group.id);
    if (!isOpen) setView(group.children[0].id);
  };

  const isGroupActive = (group: typeof NAV[0]) =>
    group.children.some(c => c.id === view) || (group.children.length === 0 && view === group.id as ViewId);

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', flexShrink: 0,
      width: expanded ? 220 : 60, height: '100%', background: 'var(--surface)',
      borderRight: '1px solid var(--border)', transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 13px', height: 54, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 14px var(--accent-glow)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: '#000' }}>O</span>
        </div>
        {expanded && <>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#fff', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>Obie</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Admin Console</div>
          </div>
          <button onClick={() => setExpanded(false)} style={{ marginLeft: 'auto', width: 22, height: 22, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', borderRadius: 6, fontSize: 14 }}>‹</button>
        </>}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV.map(group => {
          const active = isGroupActive(group);
          const open   = openGroup === group.id;
          return (
            <div key={group.id}>
              <button onClick={() => handleGroup(group)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                padding: expanded ? '9px 13px' : '9px 0', justifyContent: expanded ? 'flex-start' : 'center',
                background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative',
                color: active ? 'var(--accent)' : 'rgba(255,255,255,0.4)' }}>
                {active && <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 2, height: 18, borderRadius: '0 2px 2px 0', background: 'var(--accent)' }} />}
                <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: active ? 'var(--accent-dim)' : 'transparent' }}>{group.icon}</div>
                {expanded && <>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>{group.label}</span>
                  {group.children.length > 0 && <span style={{ fontSize: 11, opacity: 0.45, flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>›</span>}
                  {group.id === 'queue' && priorityCount > 0 && !open && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{priorityCount}</span>
                  )}
                </>}
              </button>
              {expanded && open && group.children.length > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.015)', borderLeft: '1px solid rgba(255,255,255,0.06)', marginLeft: 21 }}>
                  {group.children.map(child => (
                    <button key={child.id} onClick={() => setView(child.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7,
                      padding: '7px 13px', background: 'transparent', border: 'none', cursor: 'pointer',
                      color: view === child.id ? 'var(--accent)' : 'rgba(255,255,255,0.38)' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: view === child.id ? 'var(--accent)' : 'rgba(255,255,255,0.15)' }} />
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>{child.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      {expanded ? (
        <div style={{ padding: '10px 13px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          <button onClick={onSignOut} style={{ width: '100%', padding: '6px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.08)', color: '#f87171', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 11 }}>Sign Out</button>
        </div>
      ) : (
        <button onClick={() => setExpanded(true)} style={{ padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 14 }}>›</button>
      )}
    </aside>
  );
}

interface AdminSearchResult {
  id: string;
  title: string;
  artist?: string | null;
  thumbnail?: string;
  thumbnailUrl?: string;
  url: string;
  source?: string;
}

interface LibraryBrowseItem extends R2File {
  source?: 'cloudflare';
}

function SearchPanel() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AdminSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistPickerFor, setPlaylistPickerFor] = useState<AdminSearchResult | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [addingToQueue, setAddingToQueue] = useState<string | null>(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPlaylists(PLAYER_ID)
      .then((data) => {
        setPlaylists(data);
        const active = data.find((p) => p.is_active);
        setSelectedPlaylistId(active?.id ?? data[0]?.id ?? '');
      })
      .catch(console.error);
  }, []);

  const showStatus = (text: string, ok: boolean) => {
    setStatusMsg({ text, ok });
    window.setTimeout(() => setStatusMsg(null), 3500);
  };

  const performSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsSearching(true);
    setSearchResults([]);
    setPlaylistPickerFor(null);
    try {
      const [ytSettled, r2Settled] = await Promise.allSettled([
        callKioskHandler({ action: 'search', query: trimmed }) as Promise<{ videos?: AdminSearchResult[] }>,
        callKioskHandler({ action: 'search_r2', query: trimmed }) as Promise<{ videos?: AdminSearchResult[] }>,
      ]);
      const ytVideos = ytSettled.status === 'fulfilled' ? (ytSettled.value?.videos ?? []) : [];
      const r2Videos = r2Settled.status === 'fulfilled' ? (r2Settled.value?.videos ?? []) : [];
      setSearchResults([...r2Videos, ...ytVideos]);
    } catch (err) {
      console.error('Search failed:', err);
      showStatus('Search failed. Check console for details.', false);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setSearchResults([]);
    setPlaylistPickerFor(null);
    inputRef.current?.focus();
  };

  const handleAddToQueue = async (result: AdminSearchResult) => {
    setAddingToQueue(result.id);
    try {
      const params: Parameters<typeof callKioskHandler>[0] = {
        action: 'admin_request',
        player_id: PLAYER_ID,
        add_to_queue: true,
      };
      if (result.source === 'cloudflare') {
        params.r2_file_id = result.id;
      } else {
        params.url = result.url;
        params.title = result.title;
        params.artist = result.artist ?? null;
        params.thumbnail = result.thumbnailUrl || result.thumbnail || null;
      }
      const res = await callKioskHandler(params) as { queue_id?: string; error?: string };
      if (res?.error) throw new Error(res.error);
      showStatus(`Added "${cleanDisplayText(result.title)}" to Priority Queue`, true);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Failed to add to queue', false);
    } finally {
      setAddingToQueue(null);
    }
  };

  const handleAddToPlaylist = async () => {
    if (!playlistPickerFor || !selectedPlaylistId) return;
    const result = playlistPickerFor;
    setAddingToPlaylist(result.id);
    try {
      const reqParams: Parameters<typeof callKioskHandler>[0] = {
        action: 'admin_request',
        player_id: PLAYER_ID,
        add_to_queue: false,
      };
      if (result.source === 'cloudflare') {
        reqParams.r2_file_id = result.id;
      } else {
        reqParams.url = result.url;
        reqParams.title = result.title;
        reqParams.artist = result.artist ?? null;
        reqParams.thumbnail = result.thumbnailUrl || result.thumbnail || null;
      }
      const res = await callKioskHandler(reqParams) as { media_item_id?: string; error?: string };
      if (res?.error) throw new Error(res.error);
      if (!res.media_item_id) throw new Error('No media item returned');

      await callPlaylistManager({
        action: 'add_item',
        playlist_id: selectedPlaylistId,
        media_item_id: res.media_item_id,
      });

      const playlist = playlists.find((p) => p.id === selectedPlaylistId);
      showStatus(`Added to "${playlist?.name ?? 'playlist'}"`, true);
      setPlaylistPickerFor(null);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Failed to add to playlist', false);
    } finally {
      setAddingToPlaylist(null);
    }
  };

  const activePlaylist = playlists.find((p) => p.is_active);
  const sortedPlaylists = [
    ...(activePlaylist ? [activePlaylist] : []),
    ...playlists.filter((p) => !p.is_active).sort((a, b) => a.name.localeCompare(b.name)),
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Search" subtitle="Search library and YouTube — actions bypass the credit system" />

      <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && performSearch()}
          placeholder="Artist, song title..."
          autoFocus
          style={{
            flex: 1,
            padding: '9px 14px',
            borderRadius: 10,
            background: '#0d0d0d',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#fff',
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <Btn variant="accent" onClick={performSearch} disabled={isSearching || !query.trim()}>
          {isSearching ? <><Spinner size={13} /> Searching...</> : 'Search'}
        </Btn>
        <Btn variant="ghost" onClick={handleClear} disabled={isSearching}>Clear</Btn>
      </div>

      {statusMsg && (
        <div style={{
          margin: '8px 24px 0',
          padding: '8px 12px',
          borderRadius: 8,
          background: statusMsg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          color: statusMsg.ok ? '#4ade80' : '#f87171',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
        }}>
          {statusMsg.text}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 24px' }}>
        {isSearching && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            <Spinner size={16} /> Searching...
          </div>
        )}

        {!isSearching && searchResults.length === 0 && query.trim() && (
          <div style={{ padding: '24px 0', color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            No results found.
          </div>
        )}

        {searchResults.map((result) => {
          const thumb = result.thumbnailUrl || result.thumbnail || '';
          const title = cleanDisplayText(result.title) || 'Unknown Title';
          const artist = result.artist ? cleanDisplayText(result.artist) : null;
          const isHovered = hoveredId === result.id;
          const isR2 = result.source === 'cloudflare';

          return (
            <div
              key={`${result.source ?? 'yt'}-${result.id}`}
              onMouseEnter={() => setHoveredId(result.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '7px 10px',
                borderRadius: 10,
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                background: isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
                transition: 'background 0.12s',
              }}
            >
              <div style={{ width: 48, height: 36, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                {thumb ? (
                  <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                    {isR2 ? '💾' : '▶'}
                  </div>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {artist ? `${artist} - ${title}` : title}
                </div>
                {isR2 && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--accent)', marginTop: 1 }}>LIBRARY</div>
                )}
              </div>

              {isHovered && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Btn variant="accent" disabled={addingToQueue === result.id} onClick={() => handleAddToQueue(result)}>
                    {addingToQueue === result.id ? <><Spinner size={12} /> Adding...</> : '+ Priority Queue'}
                  </Btn>
                  <Btn variant="ghost" disabled={addingToPlaylist === result.id} onClick={() => setPlaylistPickerFor(result)}>
                    + Playlist
                  </Btn>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {playlistPickerFor && (
        <div style={{ padding: '16px 24px 20px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.4)', minWidth: 72 }}>Playlist</div>
          <select
            value={selectedPlaylistId}
            onChange={(e) => setSelectedPlaylistId(e.target.value)}
            style={{ minWidth: 240, padding: '9px 12px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-display)', fontSize: 13, outline: 'none' }}
          >
            {sortedPlaylists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.is_active ? 'Active: ' : ''}{playlist.name}
              </option>
            ))}
          </select>
          <Btn variant="accent" disabled={!selectedPlaylistId || addingToPlaylist === playlistPickerFor.id} onClick={handleAddToPlaylist}>
            {addingToPlaylist === playlistPickerFor.id ? <><Spinner size={12} /> Adding...</> : 'Add to Playlist'}
          </Btn>
          <Btn variant="ghost" onClick={() => setPlaylistPickerFor(null)}>Cancel</Btn>
        </div>
      )}
    </div>
  );
}

function BrowseLibraryPanel() {
  const [query, setQuery] = useState('');
  const [karaokeMode, setKaraokeMode] = useState<'all' | 'include' | 'exclude'>('exclude');
  const [items, setItems] = useState<LibraryBrowseItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistPickerFor, setPlaylistPickerFor] = useState<LibraryBrowseItem | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [addingToQueue, setAddingToQueue] = useState<string | null>(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    getPlaylists(PLAYER_ID)
      .then((data) => {
        setPlaylists(data);
        const active = data.find((p) => p.is_active);
        setSelectedPlaylistId(active?.id ?? data[0]?.id ?? '');
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        let req = supabase
          .from('r2_files')
          .select('*')
          .order('title', { ascending: true })
          .limit(500);

        const trimmed = query.trim().replace(/[%(),]/g, ' ');
        if (trimmed) {
          req = req.or(`title.ilike.%${trimmed}%,file_name.ilike.%${trimmed}%,artist.ilike.%${trimmed}%,object_key.ilike.%${trimmed}%`);
        }
        if (karaokeMode === 'include') {
          req = req.ilike('object_key', '%karaoke%');
        } else if (karaokeMode === 'exclude') {
          req = req.not('object_key', 'ilike', '%karaoke%');
        }

        const { data, error } = await req;
        if (error) throw error;
        if (!cancelled) {
          setItems(((data ?? []) as LibraryBrowseItem[]).map((item) => ({ ...item, source: 'cloudflare' as const })));
        }
      } catch (error) {
        console.error('[BrowseLibrary] Failed to load R2 files:', error);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    const sub = subscribeToTable<R2File>('r2_files', null, () => { load().catch(() => {}); });
    return () => { cancelled = true; sub.unsubscribe(); };
  }, [query, karaokeMode]);

  const showStatus = (text: string, ok: boolean) => {
    setStatusMsg({ text, ok });
    window.setTimeout(() => setStatusMsg(null), 3500);
  };

  const handleAddToQueue = async (item: LibraryBrowseItem) => {
    setAddingToQueue(item.id);
    try {
      const res = await callKioskHandler({
        action: 'admin_request',
        player_id: PLAYER_ID,
        add_to_queue: true,
        r2_file_id: item.id,
      }) as { queue_id?: string; error?: string };
      if (res?.error) throw new Error(res.error);
      showStatus(`Added "${cleanDisplayText(item.title || item.file_name)}" to Priority Queue`, true);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Failed to add to queue', false);
    } finally {
      setAddingToQueue(null);
    }
  };

  const handleAddToPlaylist = async () => {
    if (!playlistPickerFor || !selectedPlaylistId) return;
    setAddingToPlaylist(playlistPickerFor.id);
    try {
      const res = await callKioskHandler({
        action: 'admin_request',
        player_id: PLAYER_ID,
        add_to_queue: false,
        r2_file_id: playlistPickerFor.id,
      }) as { media_item_id?: string; error?: string };
      if (res?.error) throw new Error(res.error);
      if (!res.media_item_id) throw new Error('No media item returned');
      await callPlaylistManager({
        action: 'add_item',
        playlist_id: selectedPlaylistId,
        media_item_id: res.media_item_id,
      });
      const playlist = playlists.find((p) => p.id === selectedPlaylistId);
      showStatus(`Added to "${playlist?.name ?? 'playlist'}"`, true);
      setPlaylistPickerFor(null);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Failed to add to playlist', false);
    } finally {
      setAddingToPlaylist(null);
    }
  };

  const sortedPlaylists = [
    ...playlists.filter((p) => p.is_active),
    ...playlists.filter((p) => !p.is_active).sort((a, b) => a.name.localeCompare(b.name)),
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Browse Library" subtitle="Explore Cloudflare R2 media and add items directly to queue or playlists" />

      <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, artist, folder..."
          style={{
            flex: 1,
            minWidth: 240,
            padding: '9px 14px',
            borderRadius: 10,
            background: '#0d0d0d',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#fff',
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        {([
          ['exclude', 'Exclude Karaoke'],
          ['include', 'Karaoke Only'],
          ['all', 'All Files'],
        ] as const).map(([mode, label]) => (
          <Btn
            key={mode}
            variant={karaokeMode === mode ? 'accent' : 'ghost'}
            onClick={() => setKaraokeMode(mode)}
          >
            {label}
          </Btn>
        ))}
      </div>

      {statusMsg && (
        <div style={{
          margin: '8px 24px 0',
          padding: '8px 12px',
          borderRadius: 8,
          background: statusMsg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          color: statusMsg.ok ? '#4ade80' : '#f87171',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
        }}>
          {statusMsg.text}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 24px' }}>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            <Spinner size={16} /> Loading library...
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <div style={{ padding: '24px 0', color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            No library items matched the current filters.
          </div>
        )}

        {items.map((item) => {
          const title = cleanDisplayText(item.title || item.file_name) || 'Unknown Title';
          const artist = item.artist ? cleanDisplayText(item.artist) : null;
          const isHovered = hoveredId === item.id;
          const folderHint = item.object_key.split('/').slice(0, -1).join(' / ') || 'Library';

          return (
            <div
              key={item.id}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '7px 10px',
                borderRadius: 10,
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                background: isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
                transition: 'background 0.12s',
              }}
            >
              <div style={{ width: 48, height: 36, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💾</div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {artist ? `${artist} - ${title}` : title}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {folderHint}
                </div>
              </div>

              {isHovered && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Btn variant="accent" disabled={addingToQueue === item.id} onClick={() => handleAddToQueue(item)}>
                    {addingToQueue === item.id ? <><Spinner size={12} /> Adding...</> : '+ Priority Queue'}
                  </Btn>
                  <Btn variant="ghost" disabled={addingToPlaylist === item.id} onClick={() => setPlaylistPickerFor(item)}>
                    + Playlist
                  </Btn>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {playlistPickerFor && (
        <div style={{ padding: '16px 24px 20px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.4)', minWidth: 72 }}>Playlist</div>
          <select
            value={selectedPlaylistId}
            onChange={(e) => setSelectedPlaylistId(e.target.value)}
            style={{ minWidth: 240, padding: '9px 12px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-display)', fontSize: 13, outline: 'none' }}
          >
            {sortedPlaylists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.is_active ? 'Active: ' : ''}{playlist.name}
              </option>
            ))}
          </select>
          <Btn variant="accent" disabled={!selectedPlaylistId || addingToPlaylist === playlistPickerFor.id} onClick={handleAddToPlaylist}>
            {addingToPlaylist === playlistPickerFor.id ? <><Spinner size={12} /> Adding...</> : 'Confirm'}
          </Btn>
          <Btn variant="ghost" onClick={() => setPlaylistPickerFor(null)} disabled={addingToPlaylist === playlistPickerFor.id}>Cancel</Btn>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE PANEL
// ─────────────────────────────────────────────────────────────────────────────

function SortableQueueItem({ item, onRemove }: { item: QueueItem; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (item as any).media_item as any;
  const sourceType = m?.source_type === 'cloudflare' ? 'cloudflare' : 'youtube';
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 11, padding: '9px 11px',
        background: 'rgba(255,255,255,0.025)', marginBottom: 4, border: '1px solid rgba(255,255,255,0.04)' }}>
        <button {...attributes} {...listeners} style={{ cursor: 'grab', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.2)', padding: 2, flexShrink: 0, fontSize: 14 }}>⋮⋮</button>
        {m?.thumbnail && <img src={m.thumbnail} alt="" style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m?.title || 'Unknown'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m?.artist || ''}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '1px 5px', borderRadius: 999,
              background: sourceType === 'cloudflare' ? 'rgba(34,197,94,0.1)' : 'rgba(251,191,36,0.1)',
              color: sourceType === 'cloudflare' ? '#86efac' : '#fbbf24',
              border: `1px solid ${sourceType === 'cloudflare' ? 'rgba(34,197,94,0.22)' : 'rgba(251,191,36,0.22)'}` }}>
              {sourceType === 'cloudflare' ? 'CACHED' : 'YOUTUBE'}
            </span>
          </div>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{fmtDuration(m?.duration)}</span>
        <button onClick={() => onRemove(item.id)} style={{ width: 26, height: 26, borderRadius: 7, background: 'rgba(239,68,68,0.12)', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 12 }}>✕</button>
      </div>
    </div>
  );
}

function QueuePanel({ queue, status, onRemove, onReorder, onShuffle, isShuffling, onStartRadio, isGeneratingRadio }: {
  queue: QueueItem[]; status: PlayerStatus | null;
  onRemove: (id: string) => void; onReorder: (e: DragEndEvent) => void;
  onShuffle: () => void; isShuffling: boolean;
  onStartRadio: (source: 'now_playing' | 'history' | 'playlist') => void;
  isGeneratingRadio: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const normalQ   = queue.filter(q => q.type === 'normal'   && q.media_item_id !== status?.current_media_id);
  const priorityQ = queue.filter(q => q.type === 'priority' && q.media_item_id !== status?.current_media_id);
  const totalCount = normalQ.length + priorityQ.length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Queue" subtitle={`${totalCount} song${totalCount !== 1 ? 's' : ''}`}
        actions={<>
          <Btn variant="ghost" onClick={() => onStartRadio('now_playing')} disabled={isGeneratingRadio || !status?.current_media_id}>
            {isGeneratingRadio ? <><Spinner size={12} /> Building…</> : 'Radio: Now Playing'}
          </Btn>
          <Btn variant="ghost" onClick={() => onStartRadio('history')} disabled={isGeneratingRadio}>
            {isGeneratingRadio ? <><Spinner size={12} /> Building…</> : 'Radio: History'}
          </Btn>
          <Btn variant="ghost" onClick={() => onStartRadio('playlist')} disabled={isGeneratingRadio}>
            {isGeneratingRadio ? <><Spinner size={12} /> Building…</> : 'Radio: Playlist'}
          </Btn>
          <Btn variant="accent" onClick={onShuffle} disabled={isShuffling}>{isShuffling ? <><Spinner size={12} /> Shuffling…</> : '🔀 Shuffle'}</Btn>
        </>}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px' }}>

        {/* ── Priority Requests ─────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: '#60a5fa', textTransform: 'uppercase' }}>Priority Requests</span>
            {priorityQ.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 6px', borderRadius: 99, background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{priorityQ.length}</span>
            )}
          </div>

          {priorityQ.length === 0 ? (
            <div style={{ borderRadius: 10, padding: '14px 16px', background: 'rgba(59,130,246,0.04)', border: '1px dashed rgba(59,130,246,0.15)', color: 'rgba(255,255,255,0.22)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'center' }}>
              Empty
            </div>
          ) : (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            priorityQ.map(item => { const m = (item as any).media_item as any; return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12, padding: '10px 12px', marginBottom: 6, background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)' }}>
                {m?.thumbnail && <img src={m.thumbnail} alt="" style={{ width: 36, height: 36, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m?.title || 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 2 }}>{item.requested_by || 'Kiosk'}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{fmtDuration(m?.duration)}</span>
                <button onClick={() => onRemove(item.id)} style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(239,68,68,0.12)', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 12, flexShrink: 0 }}>✕</button>
              </div>
            );})
          )}
        </div>

        {/* ── Divider ───────────────────────────────────────────── */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginBottom: 20 }} />

        {/* ── Up Next ───────────────────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Up Next</span>
            {normalQ.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 6px', borderRadius: 99, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)' }}>{normalQ.length}</span>
            )}
          </div>

          {normalQ.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>Queue is empty</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
              <SortableContext items={normalQ.map(i => i.id)} strategy={verticalListSortingStrategy}>
                {normalQ.map(item => <SortableQueueItem key={item.id} item={item} onRemove={onRemove} />)}
              </SortableContext>
            </DndContext>
          )}
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYLISTS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function PlaylistsPanel({ view }: { view: ViewId }) {
  const [playlists, setPlaylists] = useState<(Playlist & { item_count?: number })[]>([]);
  const [playlistItems, setPlaylistItems] = useState<(PlaylistItem & { media_item?: MediaItem })[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingId, setLoadingId]   = useState<string | null>(null);
  const isLoadingPlaylistRef        = useRef(false); // prevents concurrent load_playlist calls
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null);
  const [importYtId, setImportYtId] = useState('');
  const [importName, setImportName] = useState('');
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState<{ text: string; ok: boolean } | null>(null);

  const loadPlaylists = useCallback(async () => {
    try { const data = await getPlaylists(PLAYER_ID); setPlaylists(data as typeof playlists); }
    catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadPlaylists(); }, [loadPlaylists]);
  useEffect(() => {
    if (expandedId) getPlaylistItems(expandedId).then(setPlaylistItems).catch(console.error);
  }, [expandedId]);

  const handleLoad = async (e: React.MouseEvent, playlist: Playlist) => {
    // Ref guard prevents concurrent load_playlist calls regardless of React render timing.
    // State guard (loadingId !== null) covers the UI, but there is a micro-race window
    // between setLoadingId() and the next render that the ref eliminates.
    if (isLoadingPlaylistRef.current) return;
    e.stopPropagation();
    setLoadingId(playlist.id);
    isLoadingPlaylistRef.current = true;
    try {
      // Single atomic call: clears normal queue, loads playlist, sets active_playlist_id,
      // updates player_status — all under pg_advisory_xact_lock in the load_playlist RPC.
      await callPlaylistManager({ action: 'load_playlist', player_id: PLAYER_ID, playlist_id: playlist.id });
      setMsg({ text: `✓ Loaded "${playlist.name}" into queue`, ok: true });
      await loadPlaylists();
    } catch (e) { console.error(e); setMsg({ text: '❌ Failed to load playlist', ok: false }); }
    finally { setLoadingId(null); isLoadingPlaylistRef.current = false; }
  };

  const handleDelete = async (playlist: Playlist) => {
    if (!window.confirm(`Delete "${playlist.name}"? This cannot be undone.`)) return;
    try { await callPlaylistManager({ action: 'delete', player_id: PLAYER_ID, playlist_id: playlist.id }); await loadPlaylists(); }
    catch (e) { console.error(e); }
  };

  const handleCreate = async () => {
    const name = window.prompt('New playlist name:');
    if (!name) return;
    try { await callPlaylistManager({ action: 'create', player_id: PLAYER_ID, name }); await loadPlaylists(); }
    catch (e) { console.error(e); }
  };

  const handleImport = async () => {
    if (!importYtId.trim()) return;
    setImporting(true); setImportResult(null);
    try {
      const name = importName.trim() || `Imported ${importYtId.trim().slice(0, 12)}`;
      const created = await callPlaylistManager({ action: 'create', player_id: PLAYER_ID, name }) as { playlist?: { id: string } };
      const playlistId = created?.playlist?.id;
      if (!playlistId) throw new Error('Failed to create playlist record');
      const ytUrl = `https://www.youtube.com/playlist?list=${importYtId.trim()}`;
      const result = await callPlaylistManager({ action: 'scrape', playlist_id: playlistId, url: ytUrl }) as { count?: number };
      setImportResult({ text: `✓ Imported ${result?.count ?? 0} videos into "${name}"`, ok: true });
      setImportYtId(''); setImportName('');
      await loadPlaylists();
    } catch (e: unknown) {
      setImportResult({ text: `❌ ${e instanceof Error ? e.message : 'Import failed'}`, ok: false });
    } finally { setImporting(false); }
  };

  if (view === 'playlists-import') return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Import Playlist" subtitle="Scrape a YouTube playlist into Obie via Edge Function" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 480, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
          {[{ label: 'YouTube Playlist ID *', value: importYtId, set: setImportYtId, ph: 'PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH', mono: true },
            { label: 'Playlist Name (optional)', value: importName, set: setImportName, ph: 'My Custom Playlist', mono: false }].map(f => (
            <div key={f.label} style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{f.label}</label>
              <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: f.mono ? 'var(--font-mono)' : 'var(--font-display)', fontSize: 13, outline: 'none' }} />
            </div>
          ))}
          <button onClick={handleImport} disabled={importing || !importYtId.trim()}
            style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', cursor: importing || !importYtId.trim() ? 'default' : 'pointer',
              background: 'var(--accent)', color: '#000', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
              opacity: importing || !importYtId.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {importing ? <><Spinner size={16} /> Importing…</> : '📥 Import Playlist'}
          </button>
          {importResult && <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 9,
            background: importResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${importResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
            color: importResult.ok ? '#4ade80' : '#f87171', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{importResult.text}</div>}
        </div>
      </div>
    </div>
  );

  // playlists-all
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active = playlists.find(p => (p as any).is_active);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted = [...playlists].sort((a, b) => ((b as any).is_active ? 1 : 0) - ((a as any).is_active ? 1 : 0));
  const totalSongs = playlists.reduce((a, p) => a + (p.item_count ?? 0), 0);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Playlists" subtitle={`${playlists.length} playlists · ${totalSongs.toLocaleString()} total songs`}
        actions={<Btn variant="accent" onClick={handleCreate}>＋ New Playlist</Btn>}
      />
      {msg && <div style={{ margin: '8px 24px 0', padding: '8px 12px', borderRadius: 8,
        background: msg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
        color: msg.ok ? '#4ade80' : '#f87171', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{msg.text}</div>}
      {active && (
        <div style={{ margin: '8px 24px 0', padding: '8px 14px', borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>
          ▶ Currently Active: {active.name}
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
        {sorted.map(playlist => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const isActive   = (playlist as any).is_active;
          const isExpanded = expandedId === playlist.id;
          return (
            <div key={playlist.id} style={{ marginBottom: 6, borderRadius: 13,
              background: isActive ? 'var(--accent-dim)' : 'rgba(255,255,255,0.025)',
              border: `1px solid ${isActive ? 'var(--accent-border)' : 'rgba(255,255,255,0.06)'}` }}>
              <div onClick={() => setExpandedId(isExpanded ? null : playlist.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: isActive ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)' }}>🎵</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playlist.name}</span>
                    {isActive && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '1px 6px', borderRadius: 99, background: 'rgba(34,197,94,0.18)', color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>ACTIVE</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{(playlist.item_count ?? 0).toLocaleString()} songs</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <Btn variant="accent" onClick={e => handleLoad(e, playlist)} disabled={loadingId !== null}>
                    {loadingId === playlist.id ? <Spinner size={12} /> : '▶ Load Queue'}
                  </Btn>
                  <Btn variant="danger" onClick={() => handleDelete(playlist)}>🗑</Btn>
                </div>
              </div>
              {isExpanded && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', maxHeight: 240, overflowY: 'auto', padding: '8px 14px 10px' }}>
                  {playlistItems.length === 0
                    ? <div style={{ color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '8px 0' }}>No items loaded yet</div>
                    : playlistItems.slice(0, 50).map((item, i) => (
                        <div key={item.id} style={{ display: 'flex', gap: 9, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.2)', width: 28 }}>{i + 1}</span>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(item.media_item as any)?.title || 'Unknown'}
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(item.media_item as any)?.artist ? ` · ${(item.media_item as any).artist}` : ''}
                          </div>
                        </div>
                      ))
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS — shared layout helpers
// ─────────────────────────────────────────────────────────────────────────────

function SettingsRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#e5e5e5' }}>{label}</div>
        {desc && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0, marginLeft: 16 }}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function SettingsPanel({ view, settings, prefs }: { view: ViewId; settings: PlayerSettings | null; prefs: Prefs }) {
  const [local, setLocal]     = useState<PlayerSettings | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [connectedEndpoints, setConnectedEndpoints] = useState<PlayerEndpoint[]>([]);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [resettingPriority, setResettingPriority] = useState(false);
  const [priorityResetDone, setPriorityResetDone] = useState(false);
  const [hoveredEndpointId, setHoveredEndpointId] = useState<string | null>(null);
  const [identifyingEndpointId, setIdentifyingEndpointId] = useState<string | null>(null);
  const [promotingEndpointId, setPromotingEndpointId] = useState<string | null>(null);
  const [localMediaScanning, setLocalMediaScanning]     = useState(false);
  const [localMediaScanResult, setLocalMediaScanResult] = useState<{ count: number; path: string } | null>(null);

  useEffect(() => { setLocal(settings ? { ...settings } : null); }, [settings]);
  useEffect(() => {
    setCreditsLoading(true);
    getTotalCredits(PLAYER_ID).then(setCredits).catch(console.error).finally(() => setCreditsLoading(false));

    const sub = subscribeToTable('kiosk_sessions', { column: 'player_id', value: PLAYER_ID }, async () => {
      const total = await getTotalCredits(PLAYER_ID).catch(() => null);
      if (total !== null) setCredits(total);
    });
    return () => sub.unsubscribe();
  }, []);
  useEffect(() => {
    const sub = subscribeToPlayerEndpoints(PLAYER_ID, setConnectedEndpoints);
    return () => sub.unsubscribe();
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (k: keyof PlayerSettings, v: any) => setLocal(p => p ? { ...p, [k]: v } : p);

  const saveFields = async (fields: Partial<PlayerSettings>) => {
    setSaving(true); setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('player_settings').update(fields).eq('player_id', PLAYER_ID);
      if (error) throw error;
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setSaving(false); }
  };

  const handleSavePlayback = () => local ? saveFields({
    shuffle: local.shuffle,
    loop: local.loop,
    volume: local.volume,
    karaoke_mode: local.karaoke_mode,
    player_mode: local.player_mode,
    silence_skip_enabled: local.silence_skip_enabled ?? false,
    silence_skip_tail_seconds: local.silence_skip_tail_seconds ?? 20,
    silence_skip_duration_ms: local.silence_skip_duration_ms ?? 3000,
    silence_skip_threshold: local.silence_skip_threshold ?? 0.01,
  }) : Promise.resolve();
  const handleSaveKiosk    = () => local ? saveFields({
    freeplay: local.freeplay,
    coin_per_song: local.coin_per_song,
    search_enabled: local.search_enabled,
    max_queue_size: local.max_queue_size,
    priority_queue_limit: local.priority_queue_limit,
    local_media_path: (local as any).local_media_path ?? null,
    cloudflare_enabled: local.cloudflare_enabled ?? false,
    cloudflare_r2_public_url: local.cloudflare_r2_public_url ?? null,
  } as Partial<PlayerSettings>) : Promise.resolve();
  const handleSaveBranding = () => local ? saveFields({ branding: local.branding }) : Promise.resolve();

  const handleToggle = async (field: keyof PlayerSettings) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newVal = !(local as any)?.[field];
    set(field, newVal);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('player_settings').update({ [field]: newVal }).eq('player_id', PLAYER_ID);
    } catch (e) { console.error(e); set(field, !newVal); }
  };

  const handleAddCredits = async (amt: number) => {
    setCreditsLoading(true);
    try { await updateAllCredits(PLAYER_ID, 'add', amt); setCredits(await getTotalCredits(PLAYER_ID)); }
    catch (e) { console.error(e); } finally { setCreditsLoading(false); }
  };
  const handleClearCredits = async () => {
    setCreditsLoading(true);
    try { await updateAllCredits(PLAYER_ID, 'clear'); setCredits(0); }
    catch (e) { console.error(e); } finally { setCreditsLoading(false); }
  };
  const handleResetPriorityPlayer = async () => {
    if (resettingPriority) return;
    setResettingPriority(true);
    setPriorityResetDone(false);
    try {
      await callPlayerControl({ player_id: PLAYER_ID, action: 'reset_priority', initiator: 'admin_ui' });
      setPriorityResetDone(true);
      setTimeout(() => setPriorityResetDone(false), 2500);
    }
    catch (e) { console.error(e); }
    finally { setResettingPriority(false); }
  };

  const handleScanLocalMedia = async () => {
    if (!('showDirectoryPicker' in window)) {
      setLocalMediaScanResult({ count: -1, path: 'Browser does not support directory picker' });
      return;
    }
    setLocalMediaScanning(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
      const videoExts = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ogv', '.mpg', '.mpeg', '.wmv', '.flv']);
      let count = 0;
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const dot = entry.name.lastIndexOf('.');
          if (dot !== -1 && videoExts.has(entry.name.slice(dot).toLowerCase())) count++;
        }
      }
      const dirName: string = dirHandle.name;
      set('local_media_path' as keyof PlayerSettings, dirName);
      setLocalMediaScanResult({ count, path: dirName });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') console.error('Directory scan error:', e);
    } finally {
      setLocalMediaScanning(false);
    }
  };

  const endpointIsActive = useCallback((endpoint: PlayerEndpoint) => {
    if (endpoint.status !== 'connected') return false;
    const lastSeen = endpoint.last_seen ? new Date(endpoint.last_seen).getTime() : 0;
    return lastSeen > Date.now() - 45000;
  }, []);

  const formatEndpointLabel = useCallback((endpoint: PlayerEndpoint) => {
    const source = endpoint.origin || 'Unknown origin';
    try {
      const parsed = new URL(source);
      return parsed.host || parsed.origin;
    } catch {
      return source.replace(/^https?:\/\//, '');
    }
  }, []);

  const formatLastSeen = useCallback((value: string | null) => {
    if (!value) return 'No heartbeat';
    const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (deltaSeconds < 2) return 'just now';
    if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
    const deltaMinutes = Math.round(deltaSeconds / 60);
    return `${deltaMinutes}m ago`;
  }, []);

  const handleIdentifyEndpoint = async (endpointId: string) => {
    if (identifyingEndpointId || promotingEndpointId) return;
    setIdentifyingEndpointId(endpointId);
    try {
      await callPlayerControl({
        player_id: PLAYER_ID,
        action: 'identify_endpoint',
        target_endpoint_id: endpointId,
        initiator: 'admin_ui',
        reason: 'identify_player_button',
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIdentifyingEndpointId(null);
    }
  };

  const handleSetMasterEndpoint = async (endpoint: PlayerEndpoint) => {
    if (promotingEndpointId || identifyingEndpointId) return;
    if (endpoint.role !== 'slave' || !endpointIsActive(endpoint)) return;
    setPromotingEndpointId(endpoint.endpoint_id);
    try {
      await callPlayerControl({
        player_id: PLAYER_ID,
        action: 'set_master_endpoint',
        target_endpoint_id: endpoint.endpoint_id,
        initiator: 'admin_ui',
        reason: 'set_master_button',
      });
    } catch (e) {
      console.error(e);
    } finally {
      setPromotingEndpointId(null);
    }
  };

  if (!local) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>;

  const errBlock = error && (
    <div style={{ padding: '8px 12px', borderRadius: 9, background: 'rgba(239,68,68,0.1)', color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 16 }}>{error}</div>
  );

  const wrap = (title: string, subtitle: string, content: React.ReactNode, onSave: () => Promise<void>) => (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title={title} subtitle={subtitle} />
      <div style={{ flex: 1, overflowY: 'scroll', padding: 24 }}>
        <div style={{ maxWidth: 480 }}>{errBlock}{content}<div style={{ marginTop: 20 }}><SaveBtn onSave={onSave} loading={saving} /></div></div>
      </div>
    </div>
  );

  if (view === 'settings-playback') {
    const activeEndpoints = [...connectedEndpoints]
      .filter(endpointIsActive)
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'master' ? -1 : 1;
        return new Date(b.last_seen || b.connected_at).getTime() - new Date(a.last_seen || a.connected_at).getTime();
      });

    const leftContent = <>
      <SettingsRow label="Shuffle Playlist when loaded"  desc="Randomly reorder Up Next when a new playlist is loaded (Now Playing is never moved)"><Toggle checked={!!local.shuffle}      onChange={() => handleToggle('shuffle')} /></SettingsRow>
      <SettingsRow label="Loop Playlist"    desc="Restart from beginning when queue ends"><Toggle checked={!!local.loop}         onChange={() => handleToggle('loop')} /></SettingsRow>
      {'karaoke_mode' in local && <SettingsRow label="Karaoke Mode" desc="Enable karaoke UI on kiosk"><Toggle checked={!!local.karaoke_mode} onChange={() => handleToggle('karaoke_mode')} /></SettingsRow>}
      <SettingsRow label={`Volume: ${local.volume ?? 75}`} desc="Default player volume">
        <input type="range" min={0} max={100} value={local.volume ?? 75} onChange={e => set('volume', Number(e.target.value))} style={{ width: 160 }} />
      </SettingsRow>
      {'player_mode' in local && (
        <SettingsRow label="Player Mode" desc="iFrame embeds YouTube directly; ytm_desktop routes playback through YTM Desktop Companion (localhost:9863)">
          <select
            value={local.player_mode ?? 'iframe'}
            onChange={e => set('player_mode', e.target.value as 'iframe' | 'ytm_desktop')}
            style={{ padding: '7px 12px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none', cursor: 'pointer' }}
          >
            <option value="iframe">iFrame Player</option>
            <option value="ytm_desktop">ytm_desktop API</option>
          </select>
        </SettingsRow>
      )}
      {'silence_skip_enabled' in local && (
        <>
          <SettingsRow label="Silence Detection" desc="For Cloudflare/local media, skip long silent tails near the end of a track">
            <Toggle checked={!!local.silence_skip_enabled} onChange={() => handleToggle('silence_skip_enabled' as keyof PlayerSettings)} />
          </SettingsRow>
          {local.silence_skip_enabled && (
            <>
              <SettingsRow label="Silence Tail Window" desc="Only monitor audio during the final N seconds">
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={local.silence_skip_tail_seconds ?? 20}
                  onChange={e => set('silence_skip_tail_seconds', Number(e.target.value))}
                  style={{ width: 72, textAlign: 'center', padding: '7px 10px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' }}
                />
              </SettingsRow>
              <SettingsRow label="Silence Duration (ms)" desc="Continuous silence required before auto-skip">
                <input
                  type="number"
                  min={500}
                  max={10000}
                  step={100}
                  value={local.silence_skip_duration_ms ?? 3000}
                  onChange={e => set('silence_skip_duration_ms', Number(e.target.value))}
                  style={{ width: 88, textAlign: 'center', padding: '7px 10px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' }}
                />
              </SettingsRow>
              <SettingsRow label="Silence Threshold" desc="Lower values are stricter; 0.01 is a conservative starting point">
                <input
                  type="number"
                  min={0.001}
                  max={0.1}
                  step={0.001}
                  value={local.silence_skip_threshold ?? 0.01}
                  onChange={e => set('silence_skip_threshold', Number(e.target.value))}
                  style={{ width: 88, textAlign: 'center', padding: '7px 10px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' }}
                />
              </SettingsRow>
            </>
          )}
        </>
      )}
      <div style={{ marginTop: 18, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>Priority Player</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>
          Clears priority designation. The next player to initialise will claim it.
        </div>
        <Btn
          variant={priorityResetDone ? 'accent' : 'ghost'}
          onClick={handleResetPriorityPlayer}
          disabled={resettingPriority || !!promotingEndpointId}
          style={priorityResetDone ? {
            background: 'rgba(34,197,94,0.18)',
            color: '#4ade80',
            border: '1px solid rgba(34,197,94,0.38)',
          } : undefined}
        >
          {resettingPriority ? <><Spinner size={12} /> Resetting…</> : priorityResetDone ? '✓ Priority Reset' : '🔄 Reset Priority Player'}
        </Btn>
      </div>
      <div style={{ marginTop: 20 }}><SaveBtn onSave={handleSavePlayback} loading={saving} /></div>
    </>;

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PanelHeader title="Playback Settings" subtitle="Queue and player behaviour" />
        <div style={{ flex: 1, overflowY: 'scroll', padding: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 520px) minmax(380px, 1fr)', gap: 24, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ maxWidth: 520 }}>{errBlock}{leftContent}</div>
            </div>
            <div style={{ minWidth: 0, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: '#fff' }}>Connected Players</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                    Realtime endpoint roster. Hover a row to identify or promote a live player.
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
                  {activeEndpoints.length} connected
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.1fr) 120px 120px minmax(190px, 1fr)', gap: 12, padding: '0 0 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Endpoint', 'Role', 'Status', 'Actions'].map(label => (
                  <div key={label} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                ))}
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeEndpoints.length === 0 ? (
                  <div style={{ padding: '18px 14px', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    No connected player endpoints detected.
                  </div>
                ) : activeEndpoints.map(endpoint => {
                  const isHovered = hoveredEndpointId === endpoint.endpoint_id;
                  const isMaster = endpoint.role === 'master';
                  const canPromote = endpoint.role === 'slave' && endpointIsActive(endpoint);
                  const identifyBusy = identifyingEndpointId === endpoint.endpoint_id;
                  const promoteBusy = promotingEndpointId === endpoint.endpoint_id;
                  return (
                    <div
                      key={endpoint.endpoint_id}
                      onMouseEnter={() => setHoveredEndpointId(endpoint.endpoint_id)}
                      onMouseLeave={() => setHoveredEndpointId(current => current === endpoint.endpoint_id ? null : current)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(180px, 1.1fr) 120px 120px minmax(190px, 1fr)',
                        gap: 12,
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {formatEndpointLabel(endpoint)}
                        </div>
                        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                          {endpoint.endpoint_id.slice(0, 8)} · seen {formatLastSeen(endpoint.last_seen)}
                        </div>
                      </div>
                      <div>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 74,
                          padding: '5px 10px',
                          borderRadius: 999,
                          fontFamily: 'var(--font-display)',
                          fontSize: 12,
                          fontWeight: 600,
                          color: isMaster ? '#fbbf24' : '#93c5fd',
                          background: isMaster ? 'rgba(251,191,36,0.12)' : 'rgba(59,130,246,0.12)',
                          border: `1px solid ${isMaster ? 'rgba(251,191,36,0.24)' : 'rgba(59,130,246,0.24)'}`,
                        }}>
                          {isMaster ? 'Master' : 'Slave'}
                        </span>
                      </div>
                      <div>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 90,
                          padding: '5px 10px',
                          borderRadius: 999,
                          fontFamily: 'var(--font-display)',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#4ade80',
                          background: 'rgba(34,197,94,0.12)',
                          border: '1px solid rgba(34,197,94,0.24)',
                        }}>
                          Connected
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start', minHeight: 34 }}>
                        {isHovered ? (
                          <>
                            <Btn
                              variant="ghost"
                              onClick={() => handleIdentifyEndpoint(endpoint.endpoint_id)}
                              disabled={!!identifyingEndpointId || !!promotingEndpointId}
                              style={{ padding: '6px 10px', fontSize: 12 }}
                            >
                              {identifyBusy ? <><Spinner size={11} /> Identifying…</> : 'IDENTIFY PLAYER'}
                            </Btn>
                            {canPromote && (
                              <Btn
                                variant="accent"
                                onClick={() => handleSetMasterEndpoint(endpoint)}
                                disabled={!!identifyingEndpointId || !!promotingEndpointId}
                                style={{ padding: '6px 10px', fontSize: 12 }}
                              >
                                {promoteBusy ? <><Spinner size={11} /> Setting…</> : 'SET AS MASTER'}
                              </Btn>
                            )}
                          </>
                        ) : (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.22)' }}>
                            {isMaster ? 'Current master endpoint' : 'Hover for actions'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'settings-kiosk') return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Kiosk Settings" subtitle="Request, credits and coin acceptor configuration" />
      <div style={{ flex: 1, overflowY: 'scroll', padding: 24 }}>
        <div style={{ maxWidth: 480 }}>{errBlock}
          <SettingsRow label="Free Play"              desc="Allow requests without credits"><Toggle checked={!!local.freeplay}        onChange={() => handleToggle('freeplay')} /></SettingsRow>
          <SettingsRow label="Search Enabled"         desc="Allow kiosk users to search songs"><Toggle checked={!!local.search_enabled}  onChange={() => handleToggle('search_enabled')} /></SettingsRow>
          {'kiosk_show_virtual_coin_button' in local && (
            <SettingsRow label="Show Virtual Coin Button" desc="Display INSERT COIN button on kiosk">
              <Toggle checked={!!local.kiosk_show_virtual_coin_button} onChange={() => handleToggle('kiosk_show_virtual_coin_button' as keyof PlayerSettings)} />
            </SettingsRow>
          )}
          {[{ label: 'Credits per Song', key: 'coin_per_song', desc: 'credits required per request' },
            { label: 'Max Queue Size',   key: 'max_queue_size', desc: 'max songs in normal queue' },
            { label: 'Priority Queue Limit', key: 'priority_queue_limit', desc: 'max priority request slots' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ].map(({ label, key, desc }) => (<SettingsRow key={key} label={label} desc={desc}>
            <input type="number" min={1} value={(local as any)[key] ?? 1} onChange={e => set(key as keyof PlayerSettings, Number(e.target.value))}
              style={{ width: 72, textAlign: 'center', padding: '7px 10px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' }} />
          </SettingsRow>))}
          {(local as any).local_media_enabled !== undefined && (
            <SettingsRow label="Include Local Media from this device" desc="Play video files from a local folder alongside YouTube content">
              <Toggle checked={!!(local as any).local_media_enabled} onChange={() => handleToggle('local_media_enabled' as keyof PlayerSettings)} />
            </SettingsRow>
          )}
          {'cloudflare_enabled' in local && (
            <SettingsRow label="Cloudflare R2 Search" desc="Include Cloudflare library results in kiosk and admin search">
              <Toggle checked={!!local.cloudflare_enabled} onChange={() => handleToggle('cloudflare_enabled' as keyof PlayerSettings)} />
            </SettingsRow>
          )}
          <div style={{ marginTop: 20 }}><SaveBtn onSave={handleSaveKiosk} loading={saving} /></div>

          {/* Local Media folder */}
          {(local as any).local_media_enabled && (
            <div style={{ marginTop: 16, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Local Media Folder</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>
                Provide the path to a folder containing local video files, or use Browse &amp; Scan to pick a folder.
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="/path/to/local/videos"
                  value={(local as any).local_media_path ?? ''}
                  onChange={e => set('local_media_path' as keyof PlayerSettings, e.target.value)}
                  style={{ flex: 1, padding: '9px 12px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none' }}
                />
                <Btn variant="ghost" onClick={handleScanLocalMedia} disabled={localMediaScanning}>
                  {localMediaScanning ? '…' : '📁 Browse & Scan'}
                </Btn>
              </div>
              {localMediaScanResult && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: localMediaScanResult.count > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(251,191,36,0.1)',
                  border: `1px solid ${localMediaScanResult.count > 0 ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.3)'}` }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: localMediaScanResult.count > 0 ? '#4ade80' : '#fbbf24' }}>
                    {localMediaScanResult.count < 0
                      ? `⚠ ${localMediaScanResult.path}`
                      : localMediaScanResult.count > 0
                        ? `✓ Found ${localMediaScanResult.count} video file${localMediaScanResult.count !== 1 ? 's' : ''} in "${localMediaScanResult.path}"`
                        : `⚠ No video files found in "${localMediaScanResult.path}"`}
                  </span>
                  <button onClick={() => setLocalMediaScanResult(null)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '2px 8px' }}>
                    OK
                  </button>
                </div>
              )}
            </div>
          )}

          {local.cloudflare_enabled && (
            <div style={{ marginTop: 16, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Cloudflare R2</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>
                Public base URL used for bucket playback and thumbnails.
              </div>
              <input
                type="text"
                placeholder="https://pub-...r2.dev"
                value={local.cloudflare_r2_public_url ?? ''}
                onChange={e => set('cloudflare_r2_public_url', e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none' }}
              />
            </div>
          )}

          {/* Credits block */}
          <div style={{ marginTop: 28, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Kiosk Credits</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--accent)', marginRight: 8 }}>{creditsLoading ? '…' : credits ?? 0}</div>
              <Btn variant="accent" onClick={() => handleAddCredits(1)} disabled={creditsLoading}>+1</Btn>
              <Btn variant="accent" onClick={() => handleAddCredits(3)} disabled={creditsLoading}>+3</Btn>
              <Btn variant="danger" onClick={handleClearCredits} disabled={creditsLoading}>Clear</Btn>
            </div>
          </div>

          {/* Coin acceptor */}
          {'kiosk_coin_acceptor_enabled' in local && (
            <div style={{ marginTop: 16, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Coin Acceptor Hardware</div>
              <button onClick={() => handleToggle('kiosk_coin_acceptor_enabled' as keyof PlayerSettings)} style={{ padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
                background: local.kiosk_coin_acceptor_enabled ? (local.kiosk_coin_acceptor_connected ? 'rgba(34,197,94,0.18)' : 'rgba(251,191,36,0.15)') : 'rgba(59,130,246,0.15)',
                color:      local.kiosk_coin_acceptor_enabled ? (local.kiosk_coin_acceptor_connected ? '#4ade80'              : '#fbbf24')                  : '#60a5fa' }}>
                {local.kiosk_coin_acceptor_enabled ? (local.kiosk_coin_acceptor_connected ? '🟢 Connected' : '🟡 Connecting…') : '🔵 Enable Coin Acceptor'}
              </button>
              {local.kiosk_coin_acceptor_device_id && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>Device: {local.kiosk_coin_acceptor_device_id}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (view === 'settings-branding') return wrap('Branding', 'Kiosk display settings', <>
    {[{ label: 'Jukebox Name', key: 'name', ph: 'Obie Jukebox', mono: false }, { label: 'Logo URL', key: 'logo', ph: 'https://example.com/logo.png', mono: true }].map(f => (
      <div key={f.key} style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{f.label}</label>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <input value={(local.branding as any)?.[f.key] || ''} onChange={e => set('branding', { ...local.branding, [f.key]: e.target.value })} placeholder={f.ph}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: f.mono ? 'var(--font-mono)' : 'var(--font-display)', fontSize: 13, outline: 'none' }} />
      </div>
    ))}
    <div>
      <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Theme</label>
      <div style={{ display: 'flex', gap: 8 }}>
        {['dark', 'light'].map(t => (
          <button key={t} onClick={() => set('branding', { ...local.branding, theme: t })}
            style={{ flex: 1, padding: '9px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 13,
              border: `1px solid ${local.branding?.theme === t ? 'var(--accent-border)' : 'rgba(255,255,255,0.08)'}`,
              background: local.branding?.theme === t ? 'var(--accent-dim)' : 'rgba(255,255,255,0.04)',
              color: local.branding?.theme === t ? 'var(--accent)' : 'rgba(255,255,255,0.4)' }}>
            {t === 'dark' ? '🌙 Dark' : '☀️ Light'}
          </button>
        ))}
      </div>
    </div>
  </>, handleSaveBranding);

  // prefs
  return <ConsolePrefsPanel prefs={prefs} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRIPTS PANEL  (real Edge Function calls)
// ─────────────────────────────────────────────────────────────────────────────

interface ScriptLog { ts: string; text: string; level: 'info' | 'ok' | 'err'; }

function ScriptCard({ icon, name, desc, category, onRun, input }: {
  icon: string; name: string; desc: string; category: string;
  onRun: (input: string, log: (e: ScriptLog) => void) => Promise<void>;
  input?: { label: string; placeholder: string; required?: boolean };
}) {
  const [inputVal, setInputVal] = useState('');
  const [running, setRunning]   = useState(false);
  const [logs, setLogs]         = useState<ScriptLog[]>([]);
  const [done, setDone]         = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((entry: ScriptLog) => {
    setLogs(prev => [...prev, entry]);
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50);
  }, []);

  const handleRun = async () => {
    if (input?.required && !inputVal.trim()) return;
    setRunning(true); setDone(false); setLogs([]);
    try { await onRun(inputVal.trim(), addLog); setDone(true); }
    catch (e: unknown) { addLog({ ts: new Date().toLocaleTimeString(), text: `Error: ${e instanceof Error ? e.message : String(e)}`, level: 'err' }); }
    finally { setRunning(false); }
  };

  return (
    <div style={{ borderRadius: 16, marginBottom: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '17px 18px' }}>
        <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#e5e5e5' }}>{name}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 7px', borderRadius: 99, background: 'var(--accent-dim)', color: 'var(--accent)' }}>{category}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: input ? 10 : 0 }}>{desc}</div>
          {input && (
            <input value={inputVal} onChange={e => setInputVal(e.target.value)} placeholder={input.placeholder} disabled={running}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 9, background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none' }} />
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
          {done
            ? <Btn variant="ghost" onClick={() => { setLogs([]); setDone(false); setInputVal(''); }}>Reset</Btn>
            : <Btn variant="solid" onClick={handleRun} disabled={running || (!!input?.required && !inputVal.trim())}>
                {running ? <><Spinner size={12} /> Running…</> : '▶ Run'}
              </Btn>
          }
        </div>
      </div>
      {logs.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 18px', background: 'rgba(0,0,0,0.5)' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: done ? '#22c55e' : running ? 'var(--accent)' : '#f87171', animation: running ? 'pulse 1s ease-in-out infinite' : 'none' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{done ? 'Completed' : running ? 'Running' : 'Stopped'}</span>
          </div>
          <div ref={logRef} style={{ maxHeight: 180, overflowY: 'auto', padding: '10px 18px', background: 'rgba(0,0,0,0.7)' }}>
            {logs.map((l, i) => (
              <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: l.level === 'err' ? '#f87171' : l.level === 'ok' ? '#4ade80' : '#a3e635', marginBottom: 3 }}>
                <span style={{ color: 'rgba(255,255,255,0.25)', marginRight: 8 }}>{l.ts}</span>{l.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScriptsPanel({ user }: { user: AuthUser }) {
  const now = () => new Date().toLocaleTimeString();
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  const importSingle = async (ytId: string, name: string, log: (e: ScriptLog) => void) => {
    log({ ts: now(), text: `Creating playlist: "${name}"…`, level: 'info' });
    const created = await callPlaylistManager({ action: 'create', player_id: PLAYER_ID, name }) as { playlist?: { id: string } };
    const playlistId = created?.playlist?.id;
    if (!playlistId) throw new Error('Server did not return playlist ID');
    log({ ts: now(), text: `✓ Created: ${playlistId}`, level: 'ok' });

    const ytUrl = `https://www.youtube.com/playlist?list=${ytId}`;
    log({ ts: now(), text: `Scraping YouTube: ${ytUrl}…`, level: 'info' });
    const result = await callPlaylistManager({ action: 'scrape', playlist_id: playlistId, url: ytUrl }) as { count?: number };
    log({ ts: now(), text: `✓ Imported ${result?.count ?? 0} videos.`, level: 'ok' });
  };

  const runImportSingle = async (input: string, log: (e: ScriptLog) => void) => {
    const [ytId, ...rest] = input.split('|').map(s => s.trim());
    const name = rest.join('|').trim() || `Playlist ${ytId}`;
    if (!ytId) throw new Error('No Playlist ID provided');
    await importSingle(ytId, name, log);
  };

  const runImportAll = async (_: string, log: (e: ScriptLog) => void) => {
    log({ ts: now(), text: `Starting import of ${PREDEFINED_PLAYLISTS.length} playlists…`, level: 'info' });
    let ok = 0, fail = 0;
    for (const { ytId, name } of PREDEFINED_PLAYLISTS) {
      try {
        log({ ts: now(), text: `Processing: ${name}`, level: 'info' });
        await importSingle(ytId, name, log);
        ok++;
        await delay(3000);
      } catch (e: unknown) {
        log({ ts: now(), text: `✗ ${name}: ${e instanceof Error ? e.message : String(e)}`, level: 'err' });
        fail++;
      }
    }
    log({ ts: now(), text: `Done. ${ok} succeeded, ${fail} failed.`, level: ok > 0 ? 'ok' : 'err' });
  };

  const runRetryFailed = async (_: string, log: (e: ScriptLog) => void) => {
    log({ ts: now(), text: 'Fetching existing playlists…', level: 'info' });
    const { data } = await supabase.from('playlists' as 'playlists').select('id,name').eq('player_id' as 'id', PLAYER_ID);
    const rows = (data || []) as { id: string; name: string }[];
    const existingNames = new Set(rows.map(p => p.name));
    const toRetry = PREDEFINED_PLAYLISTS.filter(p => existingNames.has(p.name));
    if (toRetry.length === 0) { log({ ts: now(), text: 'No matching playlists found. Run "Import All" first.', level: 'err' }); return; }
    log({ ts: now(), text: `Found ${toRetry.length} playlist(s) to retry.`, level: 'info' });
    let ok = 0, fail = 0;
    for (const p of toRetry) {
      const row = rows.find(r => r.name === p.name);
      if (!row) { fail++; continue; }
      try {
        const ytUrl = `https://www.youtube.com/playlist?list=${p.ytId}`;
        log({ ts: now(), text: `Re-scraping: ${p.name}`, level: 'info' });
        const result = await callPlaylistManager({ action: 'scrape', playlist_id: row.id, url: ytUrl }) as { count?: number };
        log({ ts: now(), text: `✓ ${p.name}: ${result?.count ?? 0} videos`, level: 'ok' });
        ok++;
        await delay(3000);
      } catch (e: unknown) { log({ ts: now(), text: `✗ ${p.name}: ${e instanceof Error ? e.message : String(e)}`, level: 'err' }); fail++; }
    }
    log({ ts: now(), text: `Done. ${ok} succeeded, ${fail} failed.`, level: ok > 0 ? 'ok' : 'err' });
  };

  const runScrapeYtScraper = async (input: string, log: (e: ScriptLog) => void) => {
    const url = input.startsWith('http') ? input : `https://www.youtube.com/playlist?list=${input}`;
    log({ ts: now(), text: `Calling youtube-scraper for: ${url}`, level: 'info' });
    const { data, error } = await supabase.functions.invoke('youtube-scraper', { body: { url } });
    if (error) throw error;
    log({ ts: now(), text: `✓ Scraped ${(data as { count?: number })?.count ?? '?'} items.`, level: 'ok' });
  };

  const runRefreshAllConnections = async (_: string, log: (e: ScriptLog) => void) => {
    log({ ts: now(), text: 'Broadcasting refresh prompt to connected admin consoles…', level: 'info' });
    const broadcast = await createAdminBroadcast({
      event_type: 'refresh_prompt',
      payload: {
        title: 'Update available',
        message: 'A newer admin console version is available. Refresh now?',
      },
      created_by: user.id,
    });
    log({ ts: now(), text: `✓ Refresh prompt sent (event #${broadcast.id}).`, level: 'ok' });
  };

  // deduplicate-all-playlists: remove items where the same media_item_id
  // appears more than once within the same playlist (keeps lowest position).
  const runDeduplicateAllPlaylists = async (_: string, log: (e: ScriptLog) => void) => {
    log({ ts: now(), text: 'Fetching playlists…', level: 'info' });
    const { data: playlists, error: plErr } = await supabase
      .from('playlists' as 'playlists')
      .select('id,name')
      .eq('player_id' as 'id', PLAYER_ID);
    if (plErr) throw plErr;
    if (!playlists?.length) { log({ ts: now(), text: 'No playlists found.', level: 'err' }); return; }

    log({ ts: now(), text: `Checking ${playlists.length} playlist(s)…`, level: 'info' });
    let totalRemoved = 0;

    for (const playlist of (playlists as { id: string; name: string }[])) {
      const { data: items, error: itemErr } = await supabase
        .from('playlist_items' as 'playlist_items')
        .select('id,media_item_id,position')
        .eq('playlist_id' as 'id', playlist.id)
        .order('position' as 'id', { ascending: true });
      if (itemErr) { log({ ts: now(), text: `  ✗ ${playlist.name}: ${itemErr.message}`, level: 'err' }); continue; }

      const rows = (items || []) as { id: string; media_item_id: string; position: number }[];
      const seen = new Set<string>();
      const toDelete: string[] = [];
      for (const row of rows) {
        if (seen.has(row.media_item_id)) toDelete.push(row.id);
        else seen.add(row.media_item_id);
      }

      if (toDelete.length === 0) {
        log({ ts: now(), text: `  ✓ ${playlist.name}: no duplicates`, level: 'ok' });
        continue;
      }

      const { error: delErr } = await supabase
        .from('playlist_items' as 'playlist_items')
        .delete()
        .in('id' as 'id', toDelete);
      if (delErr) { log({ ts: now(), text: `  ✗ ${playlist.name}: ${delErr.message}`, level: 'err' }); continue; }

      // Re-sequence positions on the survivors to close the gaps.
      const survivors = rows.filter(r => !toDelete.includes(r.id));
      for (let i = 0; i < survivors.length; i++) {
        await supabase.from('playlist_items' as 'playlist_items').update({ position: i } as never).eq('id' as 'id', survivors[i].id);
      }

      log({ ts: now(), text: `  ✓ ${playlist.name}: removed ${toDelete.length} duplicate${toDelete.length === 1 ? '' : 's'}`, level: 'ok' });
      totalRemoved += toDelete.length;
    }

    log({ ts: now(), text: `Done. ${totalRemoved} total duplicate${totalRemoved === 1 ? '' : 's'} removed across all playlists.`, level: totalRemoved > 0 ? 'ok' : 'info' });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Functions & Scripts" subtitle="Invoke server-side operations via Supabase Edge Functions" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <ScriptCard icon="📥" name="import-single-playlist" category="Playlists"
          desc="Import a single YouTube playlist. Enter the YouTube Playlist ID, optionally followed by | and a name."
          input={{ label: 'YouTube Playlist ID | Name', placeholder: 'PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH|Obie Playlist', required: true }}
          onRun={runImportSingle}
        />
        <ScriptCard icon="📦" name="import-all-playlists" category="Playlists"
          desc={`Import all ${PREDEFINED_PLAYLISTS.length} predefined Obie playlists from YouTube with a 3-second delay between each.`}
          onRun={runImportAll}
        />
        <ScriptCard icon="🔄" name="retry-failed-playlists" category="Playlists"
          desc="Re-scrape predefined playlists already in the database — useful when an import partially failed."
          onRun={runRetryFailed}
        />
        <ScriptCard icon="🧹" name="deduplicate-all-playlists" category="Playlists"
          desc="Remove duplicate tracks within each playlist (same video appearing more than once). Keeps the first occurrence (lowest position) and re-sequences positions."
          onRun={runDeduplicateAllPlaylists}
        />
        <ScriptCard icon="🔍" name="youtube-scraper" category="YouTube"
          desc="Directly invoke the youtube-scraper Edge Function with any YouTube playlist URL."
          input={{ label: 'YouTube URL or Playlist ID', placeholder: 'https://www.youtube.com/playlist?list=PL…', required: true }}
          onRun={runScrapeYtScraper}
        />
        <ScriptCard icon="🔄" name="refresh-all-connections" category="Admin"
          desc="Prompt every connected admin console instance to refresh and load the latest deployed build."
          onRun={runRefreshAllConnections}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE PREFERENCES PANEL
// ─────────────────────────────────────────────────────────────────────────────

function ConsolePrefsPanel({ prefs }: { prefs: Prefs }) {
  const { accent, setAccent, fsIdx, setFsIdx } = prefs;
  const [hexInput, setHexInput] = useState(accent.replace('#', ''));
  const [fsSaved,  setFsSaved]  = useState(false);
  const [colSaved, setColSaved] = useState(false);

  useEffect(() => { setHexInput(accent.replace('#', '')); }, [accent]);

  const applyHex = (hex: string) => { if (/^[0-9a-fA-F]{6}$/.test(hex)) setAccent('#' + hex); };

  const handleFontSize = (idx: number) => { setFsIdx(idx); setFsSaved(true); setTimeout(() => setFsSaved(false), 2000); };
  const handleColour   = (hex: string) => { setAccent(hex); setHexInput(hex.replace('#', '')); setColSaved(true); setTimeout(() => setColSaved(false), 2000); };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Console Preferences" subtitle="Appearance settings — saved automatically to this browser" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 520 }}>

          {/* Font size */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 10, paddingBottom: 7, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Text &amp; Display Size</div>
          <div style={{ padding: '16px 18px', borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#e5e5e5', flex: 1 }}>
                Interface Text Size
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', marginTop: 2 }}>Scales all text and layout proportionally</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {FS_SCALES.map((s, i) => (
                  <button key={i} onClick={() => handleFontSize(i)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '7px 9px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${fsIdx === i ? 'var(--accent-border)' : 'rgba(255,255,255,0.09)'}`,
                    background: fsIdx === i ? 'var(--accent-dim)' : 'rgba(255,255,255,0.04)' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 10 + i * 2, lineHeight: 1, color: fsIdx === i ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}>Aa</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {fsSaved && <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4ade80' }}>✓ Font size saved</div>}
          </div>

          {/* Accent colour */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 10, paddingBottom: 7, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Theme Accent Colour</div>
          <div style={{ padding: '18px', borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              {/* Colour wheel */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'conic-gradient(hsl(0,100%,50%),hsl(60,100%,50%),hsl(120,100%,50%),hsl(180,100%,50%),hsl(240,100%,50%),hsl(300,100%,50%),hsl(360,100%,50%))', border: `3px solid ${accent}60`, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
                  <input type="color" value={accent} onChange={e => { setAccent(e.target.value); setHexInput(e.target.value.replace('#','')); }} onBlur={e => handleColour(e.target.value)}
                    style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                </div>
                <div style={{ position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: '50%', background: accent, border: '2px solid #111', boxShadow: `0 0 8px ${accent}60` }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#e5e5e5' }}>Highlight Colour</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', marginTop: 2 }}>Applied to nav active state, buttons, progress bars, and glows</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>#</span>
                  <input value={hexInput}
                    onChange={e => { const v = e.target.value.replace(/[^0-9a-fA-F]/g,'').slice(0,6); setHexInput(v); applyHex(v); }}
                    onBlur={() => { if (hexInput.length === 6) handleColour('#' + hexInput); }}
                    style={{ width: 90, padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none' }} />
                  <button onClick={() => handleColour('#f59e0b')} style={{ padding: '5px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.07)', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 11 }}>Reset</button>
                </div>
              </div>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: accent, flexShrink: 0, border: '2px solid rgba(255,255,255,0.15)', boxShadow: `0 0 16px ${accent}60` }} />
            </div>

            {/* Preset swatches */}
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.28)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Quick Presets</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {PRESET_COLOURS.map(p => (
                <button key={p.hex} title={p.name} onClick={() => handleColour(p.hex)}
                  style={{ width: 30, height: 30, borderRadius: 8, background: p.hex, cursor: 'pointer',
                    border: `2px solid ${accent.toLowerCase() === p.hex.toLowerCase() ? '#fff' : 'transparent'}`,
                    transform: accent.toLowerCase() === p.hex.toLowerCase() ? 'scale(1.15)' : 'scale(1)', transition: 'transform 0.12s' }} />
              ))}
            </div>

            {/* Preview strip */}
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>PREVIEW</span>
              <div style={{ width: 3, height: 16, borderRadius: 99, background: accent, flexShrink: 0 }} />
              <div style={{ padding: '2px 8px', borderRadius: 99, background: `${accent}25`, border: `1px solid ${accent}50`, fontFamily: 'var(--font-mono)', fontSize: 9, color: accent }}>● LIVE</div>
              <div style={{ flex: 1, height: 3, borderRadius: 99, background: `linear-gradient(90deg,${accent},${accent}40)` }} />
              <div style={{ padding: '4px 10px', borderRadius: 8, background: accent, fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 700, color: isLightColour(accent) ? '#000' : '#fff' }}>Save</div>
            </div>
            {colSaved && <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4ade80' }}>✓ Colour saved</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function LogsPanel() {
  const [logs, setLogs]       = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [search, setSearch]   = useState('');

  useEffect(() => {
    const loadLogs = async () => {
      try {
        const { data } = await supabase.from('system_logs').select('*').order('timestamp', { ascending: false }).limit(200);
        setLogs((data as unknown as SystemLog[]) || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    loadLogs();
    setLoading(true);
    const channel = supabase.channel('system_logs:realtime');
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_logs' }, (payload: { new: SystemLog }) => {
      setLogs(prev => [payload.new, ...prev].slice(0, 200));
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = logs.filter(l => {
    if (filter !== 'all' && l.severity !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!l.event?.toLowerCase().includes(q) && !JSON.stringify(l.payload).toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const lStyle = (s: string) => {
    if (s === 'error') return { bg: 'rgba(239,68,68,0.1)', color: '#f87171', border: 'rgba(239,68,68,0.2)' };
    if (s === 'warn')  return { bg: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: 'rgba(251,191,36,0.2)' };
    return                   { bg: 'rgba(59,130,246,0.1)',  color: '#60a5fa', border: 'rgba(59,130,246,0.2)' };
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="System Logs" subtitle="Real-time event stream · last 200 entries"
        actions={<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 12 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, width: 130 }} />
          </div>
          {(['all','info','warn','error'] as const).map(lv => {
            const s = lStyle(lv); const active = filter === lv;
            return (
              <button key={lv} onClick={() => setFilter(lv)} style={{ padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
                border: `1px solid ${active ? s.border : 'rgba(255,255,255,0.07)'}`,
                background: active ? s.bg : 'rgba(255,255,255,0.04)',
                color: active ? s.color : 'rgba(255,255,255,0.38)' }}>{lv}</button>
            );
          })}
        </>}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
        {loading ? <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><Spinner /></div>
          : filtered.length === 0 ? <div style={{ color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center', paddingTop: 40 }}>No logs found</div>
          : filtered.map(log => {
              const s = lStyle(log.severity);
              return (
                <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', borderRadius: 10, marginBottom: 4, background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.22)', flexShrink: 0, width: 60, paddingTop: 1 }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 6px', borderRadius: 5, flexShrink: 0, textTransform: 'uppercase', background: s.bg, color: s.color, border: `1px solid ${s.border}`, marginTop: 1 }}>{log.severity}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', flexShrink: 0, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.event}</span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.55)', flex: 1, wordBreak: 'break-word' }}>
                    {log.payload?.action && <span>{log.payload.action}</span>}
                    {log.payload?.title  && <span> · {log.payload.title}</span>}
                    {log.payload?.details && <span> · {log.payload.details}</span>}
                    {!log.payload?.action && !log.payload?.title && log.payload && Object.keys(log.payload).length > 0 && (
                      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{JSON.stringify(log.payload)}</span>
                    )}
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [user, setUser]         = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView]         = useState<ViewId>('queue');
  const [queue, setQueue]       = useState<QueueItem[]>([]);
  const [status, setStatus]     = useState<PlayerStatus | null>(null);
  const [settings, setSettings] = useState<PlayerSettings | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const [isSkipping,  setIsSkipping]  = useState(false);
  const [isGeneratingRadio, setIsGeneratingRadio] = useState(false);
  const [refreshPrompt, setRefreshPrompt] = useState<AdminBroadcast | null>(null);
  const [masterOfflineWarning, setMasterOfflineWarning] = useState<string | null>(null);
  const isSkippingRef = useRef(false);
  const statusRef = useRef<PlayerStatus | null>(null);
  const adminSessionStartedAtRef = useRef(new Date().toISOString());
  const autoResetTriggeredRef = useRef(false);
  useEffect(() => { isSkippingRef.current = isSkipping; }, [isSkipping]);
  useEffect(() => { statusRef.current = status; }, [status]);

  const prefs = usePrefs();

  // Auth
  useEffect(() => {
    getCurrentUser().then(setUser).finally(() => setAuthLoading(false));
    const sub = subscribeToAuth(setUser);
    return () => sub.unsubscribe();
  }, []);

  // Realtime subscriptions — deps intentionally omit isSkipping; use ref to avoid subscription churn
  useEffect(() => {
    if (!user) return;
    const q  = subscribeToQueue(PLAYER_ID, setQueue);
    const s  = subscribeToPlayerStatus(PLAYER_ID, (ns) => {
      setStatus(ns);
      if (isSkippingRef.current && (ns.state === 'playing' || ns.state === 'loading')) setIsSkipping(false);
    });
    const ps = subscribeToPlayerSettings(PLAYER_ID, setSettings);
    return () => { q.unsubscribe(); s.unsubscribe(); ps.unsubscribe(); };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    adminSessionStartedAtRef.current = new Date().toISOString();
    const sub = subscribeToAdminBroadcasts((broadcast) => {
      if (broadcast.event_type !== 'refresh_prompt') return;
      setRefreshPrompt(broadcast);
    }, adminSessionStartedAtRef.current);
    return () => { sub.unsubscribe(); };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const evaluatePriorityHeartbeat = async () => {
      try {
        const { data, error } = await supabase
          .from('players')
          .select('id, last_heartbeat, priority_player_id, priority_endpoint_id')
          .eq('id', PLAYER_ID)
          .single();

        if (cancelled || error || !data) return;

        const player = data as Player;
        const hasPriorityAssigned = player.priority_player_id === PLAYER_ID;
        const lastHeartbeatMs = player.last_heartbeat ? new Date(player.last_heartbeat).getTime() : 0;
        const heartbeatAgeMs = Date.now() - lastHeartbeatMs;
        const masterOffline = hasPriorityAssigned && heartbeatAgeMs > 30000;
        const activeStatus = statusRef.current;
        const playbackNeedsDriver = activeStatus?.state === 'loading' || activeStatus?.state === 'playing' || activeStatus?.state === 'paused';

        const { data: endpoints } = await supabase
          .from('player_endpoints')
          .select('endpoint_id, role, status, last_seen')
          .eq('player_id', PLAYER_ID)
          .eq('status', 'connected');

        const activeEndpoints = ((endpoints as PlayerEndpoint[] | null) ?? []).filter(endpoint => {
          const lastSeen = endpoint.last_seen ? new Date(endpoint.last_seen).getTime() : 0;
          return Date.now() - lastSeen <= 45000;
        });
        const hasActiveMasterEndpoint = activeEndpoints.some(endpoint => endpoint.role === 'master' && endpoint.endpoint_id === player.priority_endpoint_id);

        if (playbackNeedsDriver && activeEndpoints.length === 0) {
          setMasterOfflineWarning('NO CONNECTED PLAYER ENDPOINT - open a Player screen and set it as master');
          autoResetTriggeredRef.current = false;
          return;
        }

        if (playbackNeedsDriver && hasPriorityAssigned && player.priority_endpoint_id && !hasActiveMasterEndpoint) {
          setMasterOfflineWarning('MASTER ENDPOINT IS STALE - set a connected player as master');
          return;
        }

        if (masterOffline) {
          setMasterOfflineWarning('MASTER PLAYER IS OFFLINE - Reassigning Priority to next PLAYER connection');
          if (!autoResetTriggeredRef.current) {
            autoResetTriggeredRef.current = true;
            try {
              await callPlayerControl({
                player_id: PLAYER_ID,
                action: 'reset_priority',
                initiator: 'admin_ui',
                reason: 'master_offline_timeout',
              });
            } catch (resetError) {
              console.error('[Admin] Failed to auto-reset priority player:', resetError);
            }
          }
          return;
        }

        setMasterOfflineWarning(null);
        if (!hasPriorityAssigned || heartbeatAgeMs <= 30000) {
          autoResetTriggeredRef.current = false;
        }
      } catch (err) {
        console.error('[Admin] Failed to evaluate player heartbeat:', err);
      }
    };

    evaluatePriorityHeartbeat();
    const interval = window.setInterval(evaluatePriorityHeartbeat, 5000);
    const sub = subscribeToTable<Player>('players', { column: 'id', value: PLAYER_ID }, () => {
      evaluatePriorityHeartbeat().catch?.(() => {});
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      sub.unsubscribe();
    };
  }, [user]);

  // ── Queue handlers ────────────────────────────────────────────────────────
  const handleRemove = async (queueId: string) => {
    // Optimistic update: remove immediately from local state.
    // Supabase Realtime DELETE events don't carry player_id (only primary key),
    // so the queue subscription filter never fires on DELETE — the UI would
    // otherwise show the stale item until the next unrelated change triggers a refetch.
    setQueue(prev => prev.filter(item => item.id !== queueId));
    try { await callQueueManager({ player_id: PLAYER_ID, action: 'remove', queue_id: queueId }); }
    catch (e) { console.error(e); }
  };

  const handleReorder = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const normalQ = queue.filter(i => i.type === 'normal' && i.media_item_id !== status?.current_media_id && i.id);
    const oldIdx  = normalQ.findIndex(i => i.id === active.id);
    const newIdx  = normalQ.findIndex(i => i.id === over.id);
    const reordered = arrayMove(normalQ, oldIdx, newIdx);
    const priority  = queue.filter(i => i.type === 'priority');
    const current   = queue.filter(i => i.media_item_id === status?.current_media_id);
    setQueue([...current, ...priority, ...reordered]); // optimistic
    try {
      const ids = Array.from(new Set(reordered.map(i => i.id)));
      await callQueueManager({ player_id: PLAYER_ID, action: 'reorder', queue_ids: ids, type: 'normal' });
    } catch (e) { console.error(e); setQueue(queue); }
  };

  const handleShuffle = async () => {
    setIsShuffling(true);
    try {
      // Guard: don't bother calling the server if there's nothing to shuffle.
      // The server-side queue_shuffle RPC handles everything atomically under
      // pg_advisory_xact_lock, eliminating the 23505 duplicate-key race that
      // necessitated the previous client-side retry loop.
      const normalQ = queue.filter(i => i.type === 'normal' && i.media_item_id !== status?.current_media_id && i.id);
      if (normalQ.length <= 1) return;
      await callQueueManager({ player_id: PLAYER_ID, action: 'shuffle', type: 'normal' });
    } catch (e) { console.error('[Shuffle] Failed:', e); }
    finally { setIsShuffling(false); }
  };

  const handlePlayPause = async () => {
    try {
      const newState = status?.state === 'playing' ? 'paused' : 'playing';
      await callPlayerControl({
        player_id: PLAYER_ID,
        state: newState,
        action: 'update',
        initiator: 'admin_ui',
        reason: newState === 'playing' ? 'admin_play_button' : 'admin_pause_button',
      });
    } catch (e) { console.error(e); }
  };

  const handleSkip = async () => {
    if (isSkipping) return;
    setIsSkipping(true);
    try {
      await callPlayerControl({
        player_id: PLAYER_ID,
        state: 'idle',
        action: 'skip',
        expected_media_id: status?.current_media_id ?? undefined,
        initiator: 'admin_ui',
        reason: 'admin_skip_button',
      });
    }
    catch (e) { console.error(e); setIsSkipping(false); }
    setTimeout(() => setIsSkipping(false), 3000); // failsafe
  };

  const handleStartRadio = async (source: 'now_playing' | 'history' | 'playlist') => {
    setIsGeneratingRadio(true);
    try {
      const result = await callRadioGenerator({
        player_id: PLAYER_ID,
        action: 'generate',
        source,
      });
      console.log('[Radio] Generated:', result);
      setView('queue');
    } catch (error) {
      console.error('[Radio] Failed:', error);
    } finally {
      setIsGeneratingRadio(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <Spinner size={36} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading…</span>
    </div>
  );

  if (!user) return <LoginForm onSignIn={setUser} />;

  const isSearchView    = view === 'search';
  const isLibraryView   = view === 'library';
  const isQueueView     = view.startsWith('queue');
  const isPlaylistView  = view.startsWith('playlists');
  const isSettingsView  = view.startsWith('settings');
  const isScriptsView   = view === 'settings-scripts';

  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Stage */}
      <NowPlayingStage
        status={status}
        queue={queue}
        settings={settings}
        onPlayPause={handlePlayPause}
        onSkip={handleSkip}
        isSkipping={isSkipping}
        onRemove={handleRemove}
        masterOfflineWarning={masterOfflineWarning}
      />

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar view={view} setView={setView} queue={queue} user={user} onSignOut={() => signOut().catch(console.error)} />

        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
          {isSearchView && <SearchPanel />}
          {isLibraryView && <BrowseLibraryPanel />}
          {isQueueView && (
            <QueuePanel queue={queue} status={status}
              onRemove={handleRemove} onReorder={handleReorder}
              onShuffle={handleShuffle} isShuffling={isShuffling}
              onStartRadio={handleStartRadio} isGeneratingRadio={isGeneratingRadio} />
          )}
          {isPlaylistView && <PlaylistsPanel view={view} />}
          {isScriptsView  && <ScriptsPanel user={user} />}
          {isSettingsView && !isScriptsView && <SettingsPanel view={view} settings={settings} prefs={prefs} />}
          {view === 'logs' && <LogsPanel />}
        </main>
      </div>

      {refreshPrompt && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => setRefreshPrompt(null)}
        >
          <div
            style={{ background: '#111', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: '28px 32px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, minWidth: 320,
              boxShadow: '0 24px 80px rgba(0,0,0,0.9)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
              {typeof refreshPrompt.payload?.title === 'string' ? refreshPrompt.payload.title : 'Update available'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.6)', textAlign: 'center', maxWidth: 360 }}>
              {typeof refreshPrompt.payload?.message === 'string' ? refreshPrompt.payload.message : 'A newer admin console version is available. Refresh now?'}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <Btn variant="ghost" onClick={() => setRefreshPrompt(null)}>Cancel</Btn>
              <Btn variant="solid" onClick={() => window.location.reload()}>Refresh Now</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
