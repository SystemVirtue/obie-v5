// Obie Admin Console v2 — Obsidian Stage Design
// All data flows through real Supabase subscriptions and Edge Function calls.
// No mock data. No simulated anything.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  supabase,
  subscribeToQueue,
  subscribeToPlayerStatus,
  subscribeToPlayerSettings,
  callQueueManager,
  callPlayerControl,
  callPlaylistManager,
  getPlaylists,
  getPlaylistItems,
  getTotalCredits,
  updateAllCredits,
  type QueueItem,
  type PlayerStatus,
  type SystemLog,
  type Playlist,
  type PlaylistItem,
  type PlayerSettings,
  type MediaItem,
  signIn,
  signUp,
  signOut,
  getCurrentUser,
  subscribeToAuth,
  type AuthUser,
} from '@shared/supabase-client';
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
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#14b8a6', name: 'Teal' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#6366f1', name: 'Indigo' },
  { hex: '#8b5cf6', name: 'Violet' },
  { hex: '#d946ef', name: 'Fuchsia' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#a3e635', name: 'Lime' },
  { hex: '#94a3b8', name: 'Slate' },
  { hex: '#ffffff', name: 'White' },
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function darkenHex(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 - pct;
  return '#' + [r, g, b].map(v => Math.round(v * f).toString(16).padStart(2, '0')).join('');
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
  if (el) (el.style as unknown as Record<string, string>).zoom = String(zoom);
}

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
    try { localStorage.setItem('obie_accent', hex); } catch { /**/ }
  }, []);
  const setFsIdx = useCallback((idx: number) => {
    const c = Math.max(0, Math.min(FS_SCALES.length - 1, idx));
    setFsIdxState(c); applyZoom(FS_SCALES[c].zoom);
    try { localStorage.setItem('obie_fontsize', String(c)); } catch { /**/ }
  }, []);

  return { accent, setAccent, fsIdx, setFsIdx, fsScale: FS_SCALES[fsIdx] };
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL SHARED UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function fmtDuration(sec: number | null | undefined): string {
  const s = sec ?? 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="animate-spin rounded-full border-2 border-t-transparent inline-block"
      style={{ width: size, height: size, borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
    />
  );
}

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 999, flexShrink: 0,
        background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
        transition: 'background 0.2s', position: 'relative', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, border: 'none', outline: 'none',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
      }} />
    </button>
  );
}

function PanelHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 24px', flexShrink: 0,
      borderBottom: '1px solid var(--border)',
    }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{subtitle}</p>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  );
}

function Btn({
  onClick, children, variant = 'ghost', disabled, style: extraStyle,
}: {
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  variant?: 'accent' | 'solid' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const base: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', borderRadius: 10, border: 'none',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
    fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500,
    transition: 'opacity 0.15s, background 0.15s', whiteSpace: 'nowrap',
  };
  const variants: Record<string, React.CSSProperties> = {
    accent: { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' },
    solid:  { background: 'var(--accent)', color: isLightColour(document.documentElement.style.getPropertyValue('--accent') || '#f59e0b') ? '#000' : '#fff' },
    ghost:  { background: 'rgba(255,255,255,0.05)', color: 'var(--muted)', border: '1px solid rgba(255,255,255,0.1)' },
    danger: { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' },
  };
  return (
    <button disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant], ...extraStyle }}>
      {children}
    </button>
  );
}

// Accent-coloured save button with feedback state
function SaveBtn({ onSave, loading }: { onSave: () => Promise<void>; loading?: boolean }) {
  const [saved, setSaved] = useState(false);
  const handleClick = async () => {
    await onSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 24px', borderRadius: 12, border: 'none', cursor: 'pointer',
        fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600,
        background: saved ? 'rgba(34,197,94,0.18)' : 'var(--accent)',
        color: saved ? '#4ade80' : (isLightColour(document.documentElement.style.getPropertyValue('--accent') || '#f59e0b') ? '#000' : '#fff'),
        border: saved ? '1px solid rgba(34,197,94,0.4)' : 'none',
        transition: 'all 0.2s',
      }}
    >
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
  const [isSignUp, setIsSignUp] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const result = isSignUp ? await signUp(email, password) : await signIn(email, password);
      if (result.user) {
        onSignIn({ id: result.user.id, email: result.user.email || '', role: result.user.user_metadata?.role || result.user.app_metadata?.role });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Subtle radial glow */}
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(245,158,11,0.08), transparent)', pointerEvents: 'none' }} />
      <div style={{ width: 380, background: '#0e0e0e', border: '1px solid var(--border)', borderRadius: 20, padding: 36, position: 'relative', zIndex: 1 }}>
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
              <input
                type={label === 'Password' ? 'password' : 'email'}
                value={label === 'Email' ? email : password}
                onChange={e => label === 'Email' ? setEmail(e.target.value) : setPassword(e.target.value)}
                required
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none',
                }}
              />
            </div>
          ))}
          {error && <p style={{ color: '#f87171', fontSize: 12, marginBottom: 12, fontFamily: 'var(--font-mono)' }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px', borderRadius: 12, border: 'none', cursor: loading ? 'default' : 'pointer',
              background: 'var(--accent)', color: '#000', fontFamily: 'var(--font-display)',
              fontSize: 14, fontWeight: 700, opacity: loading ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {loading ? <><Spinner size={16} /> {isSignUp ? 'Signing up…' : 'Signing in…'}</> : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NOW PLAYING STAGE (top 33vh)
// ─────────────────────────────────────────────────────────────────────────────

function NowPlayingStage({
  status, queue, settings,
  onPlayPause, onSkip, isSkipping,
}: {
  status: PlayerStatus | null;
  queue: QueueItem[];
  settings: PlayerSettings | null;
  onPlayPause: () => void;
  onSkip: () => void;
  isSkipping: boolean;
}) {
  const currentMedia = (status as unknown as Record<string, unknown>)?.current_media as MediaItem | undefined;
  const thumb = currentMedia?.thumbnail || '';
  const title = (currentMedia as unknown as Record<string, string>)?.title || 'Nothing playing';
  const artist = (currentMedia as unknown as Record<string, string>)?.artist || '—';
  const isPlaying = status?.state === 'playing';
  const progressPct = Math.min(100, (status?.progress ?? 0) * 100);

  const upNext = queue.filter(q => q.type === 'normal' && q.media_item_id !== status?.current_media_id).slice(0, 2);
  const priority = queue.filter(q => q.type === 'priority');

  return (
    <div style={{ position: 'relative', height: '33vh', minHeight: 240, flexShrink: 0, overflow: 'hidden', background: '#050505' }}>
      {/* Blurred art backdrop */}
      {thumb && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <img src={thumb} alt="" style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(60px) saturate(1.4) brightness(0.3)', transform: 'scale(1.4)' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(5,5,5,0.82) 0%,rgba(5,5,5,0.2) 50%,rgba(5,5,5,0.88) 100%)' }} />
        </div>
      )}
      {/* Grain */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.12, pointerEvents: 'none', backgroundSize: '128px', backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")` }} />
      {/* Bottom amber line */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,var(--accent-border),transparent)' }} />

      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '16px 22px 0' }}>
        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          {/* Thumbnail */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 80, height: 80, borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.9),0 0 0 1px rgba(255,255,255,0.07)', background: '#111' }}>
              {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.15)', fontSize: 28 }}>♪</div>}
            </div>
            {/* Status dot */}
            <div style={{ position: 'absolute', bottom: -3, right: -3, width: 14, height: 14, borderRadius: '50%', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: isPlaying ? '#22c55e' : '#fbbf24', boxShadow: `0 0 6px ${isPlaying ? '#22c55e' : '#fbbf24'}` }} />
            </div>
          </div>

          {/* Song info */}
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 3 }}>
              ● {isPlaying ? 'Now Playing' : status?.state === 'paused' ? 'Paused' : status?.state || 'Idle'}
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, color: '#fff', letterSpacing: '-0.025em', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artist}</p>
          </div>

          {/* Up Next strip */}
          <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5 }} className="hidden-mobile">
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', marginBottom: 2 }}>Up Next</div>
            {upNext.length === 0 ? (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Queue empty</div>
            ) : upNext.map((item, i) => {
              const m = (item as unknown as Record<string, unknown>).media_item as MediaItem | undefined;
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 9, padding: '5px 9px', background: 'rgba(255,255,255,0.06)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.22)', width: 12 }}>{i + 1}</span>
                  {m?.thumbnail ? <img src={m.thumbnail} alt="" style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} /> : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(m as unknown as Record<string,string>)?.title || 'Unknown'}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(m as unknown as Record<string,string>)?.artist || ''}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>{fmtDuration(m?.duration)}</span>
                </div>
              );
            })}
          </div>

          {/* Priority requests badge */}
          {priority.length > 0 && (
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }} className="hidden-mobile">
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa', animation: 'pulse 2s ease-in-out infinite' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#60a5fa', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{priority.length} Kiosk Request{priority.length > 1 ? 's' : ''}</span>
              </div>
              {priority.slice(0, 2).map(item => {
                const m = (item as unknown as Record<string, unknown>).media_item as MediaItem | undefined;
                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 7, borderRadius: 9, padding: '5px 9px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', width: 190 }}>
                    {m?.thumbnail ? <img src={m.thumbnail} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} /> : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(m as unknown as Record<string,string>)?.title || 'Unknown'}</div>
                      <div style={{ fontSize: 10, color: '#60a5fa' }}>{item.requested_by || 'Kiosk'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ paddingBottom: 16 }}>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
              {fmtDuration((status?.progress ?? 0) * ((currentMedia as unknown as Record<string,number>)?.duration ?? 0))}
            </span>
            <div style={{ flex: 1, height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.1)', position: 'relative' }}>
              <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg,var(--accent),var(--accent-dark))', width: `${progressPct}%`, transition: 'width 0.5s linear' }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
              {fmtDuration((currentMedia as unknown as Record<string,number>)?.duration)}
            </span>
          </div>

          {/* Buttons row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={onPlayPause} style={{
              width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'var(--accent)', color: isLightColour('#f59e0b') ? '#000' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
              boxShadow: '0 4px 18px var(--accent-glow)', transition: 'transform 0.1s',
            }}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button onClick={onSkip} disabled={isSkipping} style={{
              width: 34, height: 34, borderRadius: 9, border: 'none', cursor: isSkipping ? 'default' : 'pointer',
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, opacity: isSkipping ? 0.45 : 1,
            }}>
              {isSkipping ? <Spinner size={14} /> : '⏭'}
            </button>

            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

            {/* Volume */}
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.38)' }}>🔊</span>
            <div style={{ width: 72 }}>
              <input type="range" min={0} max={100} value={settings?.volume ?? 75} readOnly title={`Volume: ${settings?.volume ?? 75}`} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', width: 22 }}>{settings?.volume ?? 75}</span>

            <div style={{ flex: 1 }} />

            {/* Status pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 99, background: isPlaying ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.07)', border: `1px solid ${isPlaying ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.1)'}` }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: isPlaying ? '#22c55e' : '#fbbf24' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: isPlaying ? '#4ade80' : '#fbbf24', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {status?.state || 'offline'}
              </span>
            </div>
            {priority.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 99, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#60a5fa', letterSpacing: '0.06em' }}>⭐ {priority.length} PRIORITY</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────

type ViewId =
  | 'queue-now' | 'queue-next' | 'queue-priority'
  | 'playlists-all' | 'playlists-import'
  | 'settings-playback' | 'settings-kiosk' | 'settings-branding'
  | 'settings-scripts' | 'settings-prefs'
  | 'logs';

const NAV: Array<{ id: string; icon: string; label: string; children: Array<{ id: ViewId; label: string; badge?: () => number }> }> = [
  { id: 'queue', icon: '🎵', label: 'Queue', children: [
    { id: 'queue-now',      label: 'Now Playing' },
    { id: 'queue-next',     label: 'Up Next' },
    { id: 'queue-priority', label: 'Priority Requests' },
  ]},
  { id: 'playlists', icon: '📋', label: 'Playlists', children: [
    { id: 'playlists-all',    label: 'All Playlists' },
    { id: 'playlists-import', label: 'Import Playlist' },
  ]},
  { id: 'settings', icon: '⚙️', label: 'Settings', children: [
    { id: 'settings-playback', label: 'Playback' },
    { id: 'settings-kiosk',    label: 'Kiosk' },
    { id: 'settings-branding', label: 'Branding' },
    { id: 'settings-scripts',  label: 'Functions & Scripts' },
    { id: 'settings-prefs',    label: 'Console Preferences' },
  ]},
  { id: 'logs', icon: '📄', label: 'Logs', children: [] },
];

function Sidebar({
  view, setView, queue, user, onSignOut,
}: { view: ViewId; setView: (v: ViewId) => void; queue: QueueItem[]; user: AuthUser; onSignOut: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [openGroup, setOpenGroup] = useState<string>('queue');

  const priorityCount = queue.filter(q => q.type === 'priority').length;

  const handleGroup = (group: typeof NAV[0]) => {
    if (group.children.length === 0) {
      setOpenGroup('');
      setView('logs');
      return;
    }
    const isOpen = openGroup === group.id;
    setOpenGroup(isOpen ? '' : group.id);
    if (!isOpen) setView(group.children[0].id);
  };

  const isGroupActive = (group: typeof NAV[0]) =>
    group.children.some(c => c.id === view) || (group.children.length === 0 && view === 'logs');

  return (
    <aside style={{
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      width: expanded ? 220 : 60, height: '100%',
      background: 'var(--surface)', borderRight: '1px solid var(--border)',
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden',
    }}>
      {/* Wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 13px', height: 54, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 14px var(--accent-glow)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: '#000' }}>O</span>
        </div>
        {expanded && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#fff', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>Obie</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Admin Console</div>
          </div>
        )}
        {expanded && (
          <button onClick={() => setExpanded(false)} style={{ marginLeft: 'auto', width: 22, height: 22, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, fontSize: 14 }}>‹</button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV.map(group => {
          const active = isGroupActive(group);
          const open = openGroup === group.id;
          return (
            <div key={group.id}>
              <button
                onClick={() => handleGroup(group)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                  padding: expanded ? '9px 13px' : '9px 0',
                  justifyContent: expanded ? 'flex-start' : 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: active ? 'var(--accent)' : 'rgba(255,255,255,0.4)',
                  position: 'relative',
                }}
              >
                {active && <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 2, height: 18, borderRadius: '0 2px 2px 0', background: 'var(--accent)' }} />}
                <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: active ? 'var(--accent-dim)' : 'transparent' }}>
                  {group.icon}
                </div>
                {expanded && (
                  <>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>{group.label}</span>
                    {group.children.length > 0 && <span style={{ fontSize: 11, opacity: 0.45, flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>›</span>}
                    {group.id === 'queue' && priorityCount > 0 && !open && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{priorityCount}</span>
                    )}
                  </>
                )}
              </button>

              {/* Submenu */}
              {expanded && open && group.children.length > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.015)', borderLeft: '1px solid rgba(255,255,255,0.06)', marginLeft: 21 }}>
                  {group.children.map(child => (
                    <button
                      key={child.id}
                      onClick={() => setView(child.id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 7,
                        padding: '7px 13px', background: 'transparent', border: 'none', cursor: 'pointer',
                        color: view === child.id ? 'var(--accent)' : 'rgba(255,255,255,0.38)',
                      }}
                    >
                      <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: view === child.id ? 'var(--accent)' : 'rgba(255,255,255,0.15)' }} />
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>{child.label}</span>
                      {child.id === 'queue-priority' && priorityCount > 0 && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{priorityCount}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      {expanded && (
        <div style={{ padding: '10px 13px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          <button onClick={onSignOut} style={{ width: '100%', padding: '6px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.08)', color: '#f87171', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 11 }}>Sign Out</button>
        </div>
      )}
      {!expanded && (
        <button onClick={() => setExpanded(true)} style={{ padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 14 }}>›</button>
      )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE PANEL
// ─────────────────────────────────────────────────────────────────────────────

function SortableQueueItem({ item, onRemove }: { item: QueueItem; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const m = (item as unknown as Record<string, unknown>).media_item as MediaItem | undefined;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 11, padding: '9px 11px', background: 'rgba(255,255,255,0.025)', marginBottom: 4, border: '1px solid rgba(255,255,255,0.04)' }}>
        <button {...attributes} {...listeners} style={{ cursor: 'grab', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.2)', padding: 2, flexShrink: 0, fontSize: 14 }}>⋮⋮</button>
        {m?.thumbnail && <img src={m.thumbnail} alt="" style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(m as unknown as Record<string,string>)?.title || 'Unknown'}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(m as unknown as Record<string,string>)?.artist || ''}</div>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{fmtDuration(m?.duration)}</span>
        <button onClick={() => onRemove(item.id)} style={{ width: 26, height: 26, borderRadius: 7, background: 'rgba(239,68,68,0.12)', border: 'none', cursor: 'pointer', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>✕</button>
      </div>
    </div>
  );
}

function QueuePanel({ view, queue, status, onRemove, onReorder }: { view: ViewId; queue: QueueItem[]; status: PlayerStatus | null; onRemove: (id: string) => void; onReorder: (event: DragEndEvent) => void }) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [isReordering, setIsReordering] = useState(false);

  const priorityQueue = queue.filter((item) => item.type === 'priority' && item.media_item_id !== status?.current_media_id);
  const normalQueue = queue.filter((item) => item.type === 'normal' && item.media_item_id !== status?.current_media_id);

  const showPriority = view === "queue-priority";
  const showNow = view === "queue-now";
  const items = showPriority ? priorityQueue : showNow ? [] : normalQueue;

  const handleDragEnd = (event: DragEndEvent) => {
    setIsReordering(false);
    onReorder(event);
  };

  const handleDragStart = () => {
    setIsReordering(true);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PanelHeader title={showPriority ? "Priority Requests" : showNow ? "Now Playing" : "Up Next Queue"} subtitle={showPriority ? `${priorityQueue.length} kiosk requests` : `${normalQueue.length} songs`} actions={
          !showPriority && !showNow ? <Btn variant="accent" onClick={() => {}}>Add Song</Btn> : undefined
        } />
        {showNow && status?.current_media_id && (
          <div style={{ margin: '16px 24px 0', borderRadius: 14, padding: 16, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src={queue.find(item => item.media_item_id === status.current_media_id)?.media_item?.thumbnail || undefined} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{queue.find(item => item.media_item_id === status.current_media_id)?.media_item?.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{queue.find(item => item.media_item_id === status.current_media_id)?.media_item?.artist}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s ease-in-out infinite' }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4ade80', letterSpacing: '0.06em', textTransform: 'uppercase' }}>PLAYING · {Math.floor(status.progress / 60)}:{String(Math.floor(status.progress % 60)).padStart(2, "0")} / {Math.floor((queue.find(item => item.media_item_id === status.current_media_id)?.media_item?.duration || 0) / 60)}:{String(Math.floor((queue.find(item => item.media_item_id === status.current_media_id)?.media_item?.duration || 0) % 60)).padStart(2, "0")}</span>
                </div>
              </div>
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {!showPriority && !showNow ? (
            <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
              {items.map((item, idx) => (
                <SortableQueueItem key={item.id} item={item} onRemove={onRemove} />
              ))}
            </SortableContext>
          ) : (
            items.map((item, idx) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 11, padding: '9px 11px', background: 'rgba(255,255,255,0.025)', marginBottom: 4, border: '1px solid rgba(255,255,255,0.04)' }}>
                {item.media_item?.thumbnail && <img src={item.media_item.thumbnail || undefined} alt="" style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.media_item?.title || 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.media_item?.artist || ''}</div>
                </div>
                {showPriority && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', borderRadius: 99, background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{item.requested_by}</span>
                    <button style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(34,197,94,0.15)', border: 'none', cursor: 'pointer', color: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>✓</button>
                    <button style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(239,68,68,0.15)', border: 'none', cursor: 'pointer', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>✕</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </DndContext>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYLISTS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function PlaylistsPanel({ playlists }: { playlists: Playlist[] }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Playlists" subtitle={`${playlists.length} playlists · ${playlists.reduce((sum, p) => sum + ((p as any).song_count || 0), 0)} total songs`} actions={
        <Btn variant="accent" onClick={() => {}}>➕ New Playlist</Btn>
      } />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          {playlists.map(playlist => (
            <div key={playlist.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playlist.name}</div>
                {playlist.description && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playlist.description}</div>}
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>{(playlist as any).song_count || 0} songs</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function SettingsPanel({ view, settings, onSave }: { view: ViewId; settings: PlayerSettings | null; onSave: (updates: Partial<PlayerSettings>) => Promise<void> }) {
  const [local, setLocal] = useState<PlayerSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);
  const [creditsLoading, setCreditsLoading] = useState(false);

  useEffect(() => { setLocal(settings); }, [settings]);

  const set = useCallback((key: keyof PlayerSettings, value: any) => {
    setLocal(prev => prev ? { ...prev, [key]: value } : null);
  }, []);

  const handleSave = async () => {
    if (!local) return;
    setSaving(true); setError(null);
    try { await onSave(local); } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const handleAddCredits = async (amount: number) => {
    setCreditsLoading(true);
    try { await updateAllCredits(PLAYER_ID, 'add', amount); setCredits(prev => prev + amount); }
    catch (e) { console.error(e); } finally { setCreditsLoading(false); }
  };
  const handleClearCredits = async () => {
    setCreditsLoading(true);
    try { await updateAllCredits(PLAYER_ID, 'clear'); setCredits(0); }
    catch (e) { console.error(e); } finally { setCreditsLoading(false); }
  };

  const handleToggle = async (field: keyof PlayerSettings) => {
    const newVal = !local?.[field];
    set(field, newVal);
    try {
      await supabase.from('player_settings')
        // @ts-expect-error
        .update({ [field]: newVal })
        .eq('player_id', PLAYER_ID);
    } catch (e) { console.error(e); set(field, !newVal); }
  };

  const handleResetPriorityPlayer = async () => {
    try { await callPlayerControl({ player_id: PLAYER_ID, action: 'reset_priority' }); }
    catch (e) { console.error(e); }
  };

  if (!local) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>;

  const wrap = (title: string, subtitle: string, content: React.ReactNode, onSave: () => Promise<void>) => (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title={title} subtitle={subtitle} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 480 }}>
          {error && <div style={{ padding: '8px 12px', borderRadius: 9, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 16 }}>{error}</div>}
          {content}
          <div style={{ marginTop: 20 }}><SaveBtn onSave={onSave} loading={saving} /></div>
        </div>
      </div>
    </div>
  );

  if (view === 'settings-playback') return wrap('Playback Settings', 'Queue and player behaviour', <>
    <SettingsRow label="Shuffle on Load" desc="Randomise queue when a playlist loads"><Toggle checked={!!local.shuffle} onChange={() => handleToggle('shuffle')} /></SettingsRow>
    <SettingsRow label="Loop Playlist" desc="Restart from beginning when queue ends"><Toggle checked={!!local.loop} onChange={() => handleToggle('loop')} /></SettingsRow>
    <SettingsRow label="Karaoke Mode" desc="Enable karaoke features on kiosk">{'karaoke_mode' in local && <Toggle checked={!!local.karaoke_mode} onChange={() => handleToggle('karaoke_mode')} />}</SettingsRow>
    <SettingsRow label={`Volume: ${local.volume ?? 75}`} desc="Default player volume">
      <input type="range" min={0} max={100} value={local.volume ?? 75} onChange={e => set('volume', Number(e.target.value))} style={{ width: 160 }} />
    </SettingsRow>
  </>, handleSave);

  if (view === 'settings-kiosk') return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Kiosk Settings" subtitle="Request and credit configuration" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 480 }}>
          {error && <div style={{ padding: '8px 12px', borderRadius: 9, background: 'rgba(239,68,68,0.1)', color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 16 }}>{error}</div>}
          <SettingsRow label="Free Play" desc="Allow requests without credits"><Toggle checked={!!local.freeplay} onChange={() => handleToggle('freeplay')} /></SettingsRow>
          <SettingsRow label="Search Enabled" desc="Allow kiosk users to search songs"><Toggle checked={!!local.search_enabled} onChange={() => handleToggle('search_enabled')} /></SettingsRow>
          <SettingsRow label="Show Virtual Coin Button" desc="Display INSERT COIN button on kiosk">{'kiosk_show_virtual_coin_button' in local && <Toggle checked={!!local.kiosk_show_virtual_coin_button} onChange={() => handleToggle('kiosk_show_virtual_coin_button' as keyof PlayerSettings)} />}</SettingsRow>
          {[{ label: 'Credits per Song', key: 'coin_per_song', desc: 'credits required per request' }, { label: 'Max Queue Size', key: 'max_queue_size', desc: 'max songs in normal queue' }, { label: 'Priority Queue Limit', key: 'priority_queue_limit', desc: 'max priority request slots' }].map(({ label, key, desc }) => (
            <SettingsRow key={key} label={label} desc={desc}>
              <input type="number" min={1} value={(local as unknown as Record<string,number>)[key] ?? 1}
                onChange={e => set(key as keyof PlayerSettings, Number(e.target.value))}
                style={{ width: 72, textAlign: 'center', padding: '7px 10px', borderRadius: 9, background: '#111', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' }} />
            </SettingsRow>
          ))}
          <div style={{ marginTop: 20 }}><SaveBtn onSave={handleSave} loading={saving} /></div>

          {/* Credits */}
          <div style={{ marginTop: 28, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Kiosk Credits</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--accent)', marginRight: 4 }}>{creditsLoading ? '…' : credits ?? 0}</div>
              <Btn variant="accent" onClick={() => handleAddCredits(1)} disabled={creditsLoading}>+1</Btn>
              <Btn variant="accent" onClick={() => handleAddCredits(3)} disabled={creditsLoading}>+3</Btn>
              <Btn variant="danger" onClick={handleClearCredits} disabled={creditsLoading}>Clear</Btn>
            </div>
          </div>

          {/* Coin acceptor */}
          <div style={{ marginTop: 16, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Coin Acceptor</div>
            {'kiosk_coin_acceptor_enabled' in local && (
              <button onClick={() => handleToggle('kiosk_coin_acceptor_enabled' as keyof PlayerSettings)} style={{
                padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
                background: local.kiosk_coin_acceptor_enabled
                  ? local.kiosk_coin_acceptor_connected ? 'rgba(34,197,94,0.18)' : 'rgba(251,191,36,0.15)'
                  : 'rgba(59,130,246,0.15)',
                color: local.kiosk_coin_acceptor_enabled
                  ? local.kiosk_coin_acceptor_connected ? '#4ade80' : '#fbbf24'
                  : '#60a5fa',
              }}>
                {local.kiosk_coin_acceptor_enabled
                  ? local.kiosk_coin_acceptor_connected ? '🟢 Coin Acceptor Connected' : '🟡 Connecting…'
                  : '🔵 Enable Coin Acceptor'}
              </button>
            )}
          </div>

          {/* Priority player reset */}
          <div style={{ marginTop: 16, padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>Priority Player</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 10 }}>Clears current priority player. The next instance to initialise will claim priority.</div>
            <Btn variant="ghost" onClick={handleResetPriorityPlayer}>🔄 Reset Priority Player</Btn>
          </div>
        </div>
      </div>
    </div>
  );

  if (view === 'settings-branding') return wrap('Branding', 'Kiosk display settings', <>
    {[{ label: 'Jukebox Name', key: 'name', ph: 'Obie Jukebox' }, { label: 'Logo URL', key: 'logo', ph: 'https://…' }].map(({ label, key, ph }) => (
      <div key={key} style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</label>
        <input value={(local.branding as unknown as Record<string,string>)?.[key] || ''}
          onChange={e => set('branding', { ...local.branding, [key]: e.target.value })}
          placeholder={ph}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-display)', fontSize: 13, outline: 'none' }} />
      </div>
    ))}
    <div>
      <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Theme</label>
      <div style={{ display: 'flex', gap: 8 }}>
        {['dark', 'light'].map(t => (
          <button key={t} onClick={() => set('branding', { ...local.branding, theme: t })}
            style={{ flex: 1, padding: '9px', borderRadius: 10, border: `1px solid ${local.branding?.theme === t ? 'var(--accent-border)' : 'rgba(255,255,255,0.08)'}`, background: local.branding?.theme === t ? 'var(--accent-dim)' : 'rgba(255,255,255,0.04)', color: local.branding?.theme === t ? 'var(--accent)' : 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-display)', fontSize: 13, cursor: 'pointer' }}>
            {t === 'dark' ? '🌙 Dark' : '☀️ Light'}
          </button>
        ))}
      </div>
    </div>
  </>, handleSaveBranding);

  // prefs fallthrough
  return <ConsolePrefsPanel prefs={prefs} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRIPTS PANEL  (real Edge Function calls)
// ─────────────────────────────────────────────────────────────────────────────

const PREDEFINED_PLAYLISTS = [
  { ytId: 'PLJ7vMjpVbhBWLWJpweVDki43Wlcqzsqdu', name: 'DJAMMMS Default Playlist' },
  { ytId: 'PLN9QqCogPsXIoSObV0F39OZ_MlRZ9tRT9', name: 'Obie Nights' },
  { ytId: 'PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH', name: 'Obie Playlist' },
  { ytId: 'PLN9QqCogPsXIkPh6xm7cxSN9yTVaEoj0j', name: 'Obie Jo' },
  { ytId: 'PLN9QqCogPsXLAtgvLQ0tvpLv820R7PQsM', name: 'Karaoke' },
  { ytId: 'PLN9QqCogPsXLsv5D5ZswnOSnRIbGU80IS', name: 'Poly' },
  { ytId: 'PLN9QqCogPsXIqfwdfe4hf3qWM1mFweAXP', name: 'Obie Johno' },
];

interface ScriptLog { ts: string; text: string; level: 'info' | 'ok' | 'err'; }

function ScriptCard({
  icon, name, desc, category,
  onRun,
  input,
}: {
  icon: string; name: string; desc: string; category: string;
  onRun: (input: string, log: (entry: ScriptLog) => void) => Promise<void>;
  input?: { label: string; placeholder: string; required?: boolean };
}) {
  const [inputVal, setInputVal] = useState('');
  const [running, setRunning]   = useState(false);
  const [logs, setLogs]         = useState<ScriptLog[]>([]);
  const [done, setDone]         = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (entry: ScriptLog) => {
    setLogs(prev => { const next = [...prev, entry]; return next; });
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50);
  };

  const handleRun = async () => {
    if (input?.required && !inputVal.trim()) return;
    setRunning(true); setDone(false); setLogs([]);
    try {
      await onRun(inputVal.trim(), addLog);
      setDone(true);
    } catch (e: unknown) {
      addLog({ ts: new Date().toLocaleTimeString(), text: `Error: ${e instanceof Error ? e.message : String(e)}`, level: 'err' });
    } finally { setRunning(false); }
  };

  const reset = () => { setLogs([]); setDone(false); setInputVal(''); };

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
            <input value={inputVal} onChange={e => setInputVal(e.target.value)} placeholder={input.placeholder}
              disabled={running}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 9, background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none' }} />
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
          {done
            ? <Btn variant="ghost" onClick={reset}>Reset</Btn>
            : <Btn variant="solid" onClick={handleRun} disabled={running || (input?.required && !inputVal.trim())}>
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
          <div ref={logRef} style={{ maxHeight: 160, overflowY: 'auto', padding: '10px 18px', background: 'rgba(0,0,0,0.6)' }}>
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

function ScriptsPanel() {
  const now = () => new Date().toLocaleTimeString();

  const importSingle = async (ytId: string, name: string, log: (e: ScriptLog) => void) => {
    log({ ts: now(), text: `Creating playlist record: "${name}"…`, level: 'info' });
    const created: unknown = await callPlaylistManager({ action: 'create', player_id: PLAYER_ID, name });
    const playlistId = (created as Record<string, Record<string, string>>)?.playlist?.id;
    if (!playlistId) throw new Error('Server did not return a playlist ID');
    log({ ts: now(), text: `Playlist created: ${playlistId}`, level: 'ok' });

    const ytUrl = `https://www.youtube.com/playlist?list=${ytId}`;
    log({ ts: now(), text: `Scraping YouTube playlist ${ytId}…`, level: 'info' });
    const result: unknown = await callPlaylistManager({ action: 'scrape', playlist_id: playlistId, url: ytUrl });
    const count = (result as Record<string, number>)?.count ?? 0;
    log({ ts: now(), text: `✓ Imported ${count} videos.`, level: 'ok' });
  };

  const runImportSingle = async (input: string, log: (e: ScriptLog) => void) => {
    const parts = input.split('|');
    const ytId  = parts[0]?.trim();
    const name  = parts[1]?.trim() || `Playlist ${ytId}`;
    if (!ytId) throw new Error('No playlist ID provided');
    await importSingle(ytId, name, log);
  };

  const runImportAll = async (_: string, log: (e: ScriptLog) => void) => {
    log({ ts: now(), text: `Importing ${PREDEFINED_PLAYLISTS.length} playlists…`, level: 'info' });
    let ok = 0, fail = 0;
    for (const { ytId, name } of PREDEFINED_PLAYLISTS) {
      try {
        log({ ts: now(), text: `Processing: ${name}`, level: 'info' });
        await importSingle(ytId, name, log);
        ok++;
        await new Promise(r => setTimeout(r, 3000)); // 3s delay between imports
      } catch (e: unknown) {
        log({ ts: now(), text: `✗ Failed: ${name} — ${e instanceof Error ? e.message : String(e)}`, level: 'err' });
        fail++;
      }
    }
    log({ ts: now(), text: `Done. ${ok} succeeded, ${fail} failed.`, level: ok > 0 ? 'ok' : 'err' });
  };

  const runRetryFailed = async (_: string, log: (e: ScriptLog) => void) => {
    log({ ts: now(), text: 'Fetching existing playlists to identify which need re-scraping…', level: 'info' });
    const existing = await (supabase as unknown as Record<string, (t: string) => { select: (s: string) => { eq: (k: string, v: string) => Promise<{ data: unknown[] | null }> } }>)
      .from('playlists').select('id,name').eq('player_id', PLAYER_ID);

    interface PlaylistRow { id: string; name: string; }
    const rows: PlaylistRow[] = ((existing as unknown as { data: PlaylistRow[] | null })?.data || []);
    const existingNames = new Set(rows.map(p => p.name));
    const toRetry = PREDEFINED_PLAYLISTS.filter(p => existingNames.has(p.name));

    if (toRetry.length === 0) {
      log({ ts: now(), text: 'No known playlists found in database to retry. Run "Import All" first.', level: 'err' });
      return;
    }

    log({ ts: now(), text: `Found ${toRetry.length} playlist(s) to retry.`, level: 'info' });
    let ok = 0, fail = 0;
    for (const p of toRetry) {
      const row = rows.find(r => r.name === p.name);
      if (!row) { fail++; continue; }
      try {
        const ytUrl = `https://www.youtube.com/playlist?list=${p.ytId}`;
        log({ ts: now(), text: `Re-scraping: ${p.name}`, level: 'info' });
        const result: unknown = await callPlaylistManager({ action: 'scrape', playlist_id: row.id, url: ytUrl });
        const count = (result as Record<string, number>)?.count ?? 0;
        log({ ts: now(), text: `✓ ${p.name}: ${count} videos`, level: 'ok' });
        ok++;
        await new Promise(r => setTimeout(r, 3000));
      } catch (e: unknown) {
        log({ ts: now(), text: `✗ ${p.name}: ${e instanceof Error ? e.message : String(e)}`, level: 'err' });
        fail++;
      }
    }
    log({ ts: now(), text: `Done. ${ok} succeeded, ${fail} failed.`, level: ok > 0 ? 'ok' : 'err' });
  };

  const runScrapeYtScraper = async (input: string, log: (e: ScriptLog) => void) => {
    const ytUrl = input.trim().startsWith('http') ? input.trim() : `https://www.youtube.com/playlist?list=${input.trim()}`;
    log({ ts: now(), text: `Calling youtube-scraper for: ${ytUrl}`, level: 'info' });
    const { data, error } = await supabase.functions.invoke('youtube-scraper', { body: { url: ytUrl } });
    if (error) throw error;
    log({ ts: now(), text: `✓ Scraped ${(data as Record<string,number>)?.count ?? '?'} items.`, level: 'ok' });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Functions & Scripts" subtitle="Invoke server-side operations via Edge Functions" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <ScriptCard icon="📥" name="import-single-playlist" category="Playlists" desc="Import a single YouTube playlist by ID. Enter the YouTube Playlist ID (and optionally a name separated by |)"
          input={{ label: 'YouTube Playlist ID | Name', placeholder: 'PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH|Obie Playlist', required: true }}
          onRun={runImportSingle}
        />
        <ScriptCard icon="📦" name="import-all-playlists" category="Playlists" desc={`Import all ${PREDEFINED_PLAYLISTS.length} predefined Obie playlists from YouTube. Each import is separated by a 3-second delay.`}
          onRun={runImportAll}
        />
        <ScriptCard icon="🔄" name="retry-failed-playlists" category="Playlists" desc="Re-scrape any predefined playlists already in the database — useful when a previous import partially failed."
          onRun={runRetryFailed}
        />
        <ScriptCard icon="🔍" name="youtube-scraper" category="YouTube" desc="Call the youtube-scraper Edge Function directly with a YouTube playlist URL."
          input={{ label: 'YouTube URL or Playlist ID', placeholder: 'https://www.youtube.com/playlist?list=PL…', required: true }}
          onRun={runScrapeYtScraper}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE PREFERENCES PANEL
// ─────────────────────────────────────────────────────────────────────────────

function ConsolePrefsPanel({ prefs }: { prefs: ReturnType<typeof usePrefs> }) {
  const { accent, setAccent, fsIdx, setFsIdx } = prefs;
  const [hexInput, setHexInput] = useState(accent.replace('#', ''));
  const [fsSaved, setFsSaved]   = useState(false);
  const [colSaved, setColSaved] = useState(false);

  useEffect(() => { setHexInput(accent.replace('#', '')); }, [accent]);

  const applyHex = (hex: string) => {
    if (/^[0-9a-fA-F]{6}$/.test(hex)) { setAccent('#' + hex); }
  };

  const handleFontSize = (idx: number) => {
    setFsIdx(idx);
    setFsSaved(true);
    setTimeout(() => setFsSaved(false), 2000);
  };

  const handleColour = (hex: string, save = true) => {
    setAccent(hex);
    if (save) { setColSaved(true); setTimeout(() => setColSaved(false), 2000); }
  };

  const row = (children: React.ReactNode) => (
    <div style={{ padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 10 }}>
      {children}
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="Console Preferences" subtitle="Appearance settings — saved automatically to this browser" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 520 }}>

          {/* Font size */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 10, paddingBottom: 7, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Text &amp; Display Size</div>
          {row(<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#e5e5e5', flex: 1 }}>
                Interface Text Size
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', marginTop: 2 }}>Scales all text and layout proportionally</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {FS_SCALES.map((s, i) => (
                  <button key={i} onClick={() => handleFontSize(i)} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    padding: '7px 9px', borderRadius: 10, border: `1px solid ${fsIdx === i ? 'var(--accent-border)' : 'rgba(255,255,255,0.09)'}`,
                    background: fsIdx === i ? 'var(--accent-dim)' : 'rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                  }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 10 + i * 2, lineHeight: 1, color: fsIdx === i ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}>Aa</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {fsSaved && <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4ade80' }}>✓ Font size saved</div>}
          </>)}

          {/* Accent colour */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', margin: '20px 0 10px', paddingBottom: 7, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Theme Accent Colour</div>
          {row(<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              {/* Colour wheel */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'conic-gradient(hsl(0,100%,50%),hsl(60,100%,50%),hsl(120,100%,50%),hsl(180,100%,50%),hsl(240,100%,50%),hsl(300,100%,50%),hsl(360,100%,50%))', border: '3px solid rgba(255,255,255,0.15)', cursor: 'pointer', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input type="color" value={accent} onChange={e => { handleColour(e.target.value, false); }} onBlur={e => handleColour(e.target.value, true)}
                    style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                </div>
                <div style={{ position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: '50%', background: accent, border: '2px solid #111', boxShadow: `0 0 8px ${accent}60` }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: '#e5e5e5' }}>Highlight Colour</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.28)', marginTop: 2 }}>Applied to active nav, buttons, progress bars, glows</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>#</span>
                  <input value={hexInput} onChange={e => { const v = e.target.value.replace(/[^0-9a-fA-F]/g,'').slice(0,6); setHexInput(v); applyHex(v); }}
                    onBlur={() => { if (hexInput.length === 6) handleColour('#' + hexInput, true); }}
                    style={{ width: 90, padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none' }} />
                  <button onClick={() => { handleColour('#f59e0b', true); setHexInput('f59e0b'); }} style={{ padding: '5px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.07)', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 11 }}>Reset</button>
                </div>
              </div>
              {/* Current swatch */}
              <div style={{ width: 40, height: 40, borderRadius: 10, background: accent, flexShrink: 0, border: '2px solid rgba(255,255,255,0.15)', boxShadow: `0 0 16px ${accent}60` }} />
            </div>

            {/* Preset swatches */}
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.28)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Quick Presets</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {PRESET_COLOURS.map(p => (
                <button key={p.hex} title={p.name} onClick={() => { handleColour(p.hex, true); setHexInput(p.hex.replace('#', '')); }}
                  style={{ width: 30, height: 30, borderRadius: 8, background: p.hex, border: `2px solid ${accent.toLowerCase() === p.hex.toLowerCase() ? '#fff' : 'transparent'}`, cursor: 'pointer', transition: 'transform 0.12s, border-color 0.12s', transform: accent.toLowerCase() === p.hex.toLowerCase() ? 'scale(1.15)' : 'scale(1)' }} />
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
          </>)}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function LogsPanel() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | SystemLog['severity']>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    supabase
      .from('system_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(200)
      .then(({ data }) => { setLogs((data as unknown as SystemLog[]) || []); })
      .catch(console.error)
      .finally(() => setLoading(false));

    const sub = subscribeToTable<SystemLog>('system_logs', null, ({ eventType, new: row }) => {
      if (eventType === 'INSERT') setLogs(prev => [row, ...prev].slice(0, 200));
    });
    return () => sub.unsubscribe();
  }, []);

  const filtered = logs.filter(l => {
    if (filter !== 'all' && l.severity !== filter) return false;
    if (search && !l.event?.toLowerCase().includes(search.toLowerCase()) && !JSON.stringify(l.payload).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const levelStyle = (s: string) => {
    if (s === 'error') return { bg: 'rgba(239,68,68,0.1)', color: '#f87171', border: 'rgba(239,68,68,0.2)' };
    if (s === 'warn')  return { bg: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: 'rgba(251,191,36,0.2)' };
    return { bg: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: 'rgba(59,130,246,0.2)' };
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader
        title="System Logs"
        subtitle="Real-time event stream"
        actions={
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 12 }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, width: 130 }} />
            </div>
            {(['all', 'info', 'warn', 'error'] as const).map(lv => {
              const s = levelStyle(lv);
              const active = filter === lv;
              return (
                <button key={lv} onClick={() => setFilter(lv)} style={{
                  padding: '5px 10px', borderRadius: 8, border: `1px solid ${active ? s.border : 'rgba(255,255,255,0.07)'}`,
                  background: active ? s.bg : 'rgba(255,255,255,0.04)',
                  color: active ? s.color : 'rgba(255,255,255,0.38)',
                  cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
                }}>{lv}</button>
              );
            })}
          </div>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center', paddingTop: 40 }}>No logs found</div>
        ) : filtered.map(log => {
          const s = levelStyle(log.severity);
          return (
            <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', borderRadius: 10, marginBottom: 4, background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.22)', flexShrink: 0, width: 60, paddingTop: 1 }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 6px', borderRadius: 5, flexShrink: 0, textTransform: 'uppercase', background: s.bg, color: s.color, border: `1px solid ${s.border}`, letterSpacing: '0.04em', marginTop: 1 }}>{log.severity}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', flexShrink: 0, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.event}</span>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.55)', flex: 1, wordBreak: 'break-word' }}>
                {log.payload?.action && <span>{log.payload.action}</span>}
                {log.payload?.title && <span> · {log.payload.title}</span>}
                {log.payload?.details && <span> · {log.payload.details}</span>}
                {!log.payload?.action && !log.payload?.title && log.payload && Object.keys(log.payload).length > 0 && (
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{JSON.stringify(log.payload)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Import the subscribeToTable helper (not exported by default in some versions, so we add it)
function subscribeToTable<T = unknown>(
  table: string,
  _filter: unknown,
  callback: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: T; old: T }) => void
) {
  const channel = supabase.channel(`${table}:realtime`);
  channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload: unknown) => {
    callback({
      eventType: (payload as Record<string,string>).eventType as 'INSERT' | 'UPDATE' | 'DELETE',
      new: (payload as Record<string,T>).new,
      old: (payload as Record<string,T>).old,
    });
  }).subscribe();
  return { unsubscribe: () => supabase.removeChannel(channel) };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView]       = useState<ViewId>('queue-next');

  // Real-time data
  const [queue, setQueue]     = useState<QueueItem[]>([]);
  const [status, setStatus]   = useState<PlayerStatus | null>(null);
  const [settings, setSettings] = useState<PlayerSettings | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const [isSkipping, setIsSkipping]   = useState(false);

  const prefs = usePrefs();

  // Auth
  useEffect(() => {
    getCurrentUser().then(setUser).finally(() => setAuthLoading(false));
    const sub = subscribeToAuth(setUser);
    return () => sub.unsubscribe();
  }, []);

  // Data subscriptions (only when authed)
  useEffect(() => {
    if (!user) return;
    const q = subscribeToQueue(PLAYER_ID, setQueue);
    const s = subscribeToPlayerStatus(PLAYER_ID, (ns) => {
      setStatus(ns);
      if (isSkipping && (ns.state === 'playing' || ns.state === 'loading')) setIsSkipping(false);
    });
    const ps = subscribeToPlayerSettings(PLAYER_ID, setSettings);
    return () => { q.unsubscribe(); s.unsubscribe(); ps.unsubscribe(); };
  }, [user, isSkipping]);

  // Queue operations
  const handleReorder = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const normalQ = queue.filter(i => i.type === 'normal' && i.media_item_id !== status?.current_media_id);
    const oldIdx = normalQ.findIndex(i => i.id === active.id);
    const newIdx = normalQ.findIndex(i => i.id === over.id);
    const reordered = arrayMove(normalQ, oldIdx, newIdx);
    const priority  = queue.filter(i => i.type === 'priority');
    const current   = queue.filter(i => i.media_item_id === status?.current_media_id);
    setQueue([...current, ...priority, ...reordered]);
  };

  const handlePlayPause = async () => {
    if (!status) return;
    try {
      await callPlayerControl({ player_id: PLAYER_ID, action: status.state === 'playing' ? 'pause' : 'play' });
    } catch (e) { console.error(e); }
  };

  const handleSkip = async () => {
    setIsSkipping(true);
    try {
      await callPlayerControl({ player_id: PLAYER_ID, action: 'skip' });
    } catch (e) { console.error(e); } finally { setTimeout(() => setIsSkipping(false), 1000); }
  };

  // Settings
  const handleSettingsSave = async (updates: Partial<PlayerSettings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...updates };
    try {
      await supabase.from('player_settings').upsert(newSettings);
      setSettings(newSettings);
    } catch (e) { console.error(e); }
  };

  // Branding
  const handleBrandingSave = async (updates: Partial<PlayerSettings['branding']>) => {
    if (!settings) return;
    const newBranding = { ...settings.branding, ...updates };
    const newSettings = { ...settings, branding: newBranding };
    try {
      await supabase.from('player_settings').upsert(newSettings);
      setSettings(newSettings);
    } catch (e) { console.error(e); }
  };

  // Playlists
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  useEffect(() => {
    if (!user) return;
    getPlaylists(PLAYER_ID).then(setPlaylists).catch(console.error);
  }, [user]);

  // Logs
  const [logs, setLogs] = useState<SystemLog[]>([]);
  useEffect(() => {
    if (!user) return;
    supabase.from('system_logs').select('*').order('timestamp', { ascending: false }).limit(200)
      .then(({ data }) => setLogs((data as unknown as SystemLog[]) || []))
      .catch(console.error);
  }, [user]);

  if (authLoading) return <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={40} /></div>;
  if (!user) return <LoginForm onSignIn={setUser} />;

  const renderMain = (view: ViewId) => {
    if (view.startsWith('queue-')) return <QueuePanel view={view} queue={queue} status={status} onRemove={handleRemove} onReorder={handleReorder} />;
    if (view.startsWith('playlists-')) return <PlaylistsPanel playlists={playlists} />;
    if (view.startsWith('settings-')) return <SettingsPanel view={view} settings={settings} onSave={handleSettingsSave} onSaveBranding={handleBrandingSave} />;
    if (view === 'logs') return <LogsPanel />;
    return <ConsolePrefsPanel prefs={prefs} />;
  };

  return (
    <div style={{ height: '100vh', background: 'var(--bg)', color: '#fff', fontFamily: 'var(--font-display)', display: 'flex' }}>
      <Sidebar view={view} setView={setView} queue={queue} user={user} onSignOut={() => { signOut(); setUser(null); }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <NowPlayingStage status={status} queue={queue} settings={settings} onPlayPause={handlePlayPause} onSkip={handleSkip} isSkipping={isSkipping} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {renderMain(view)}
        </div>
      </div>
    </div>
  );
}

export default App;