import { useState, useEffect } from 'react';

/* ─── Font scales ───────────────────────────────────────────────────────────── */
const FONT_SCALES = [
  { zoom: 0.80, label: 'Smallest', pct: '80%' },
  { zoom: 0.90, label: 'Smaller', pct: '90%' },
  { zoom: 1.00, label: 'Normal', pct: '100%' },
  { zoom: 1.12, label: 'Larger', pct: '112%' },
  { zoom: 1.25, label: 'Largest', pct: '125%' },
];

/* ─── Default preferences ───────────────────────────────────────────────────── */
const DEFAULT_PREFS = {
  fontScaleIndex: 2, // Normal
  accentColor: '#f59e0b', // Amber
};

/* ─── Utility functions ─────────────────────────────────────────────────────── */
/* ─── Hex → RGB helper ── */
function hexToRgb(hex: string) {
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  const n = parseInt(hex, 16);
  return [(n>>16)&255,(n>>8)&255,n&255];
};

/* ─── Apply accent color to CSS variables ───────────────────────────────────── */
const applyAccentColor = (hex: string) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;

  const [r, g, b] = hexToRgb(hex);
  const root = document.documentElement;

  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`);
  root.style.setProperty('--accent-border', `rgba(${r},${g},${b},0.32)`);
  root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.38)`);
  root.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  root.style.setProperty('--amber', hex);
  root.style.setProperty('--amber-dim', `rgba(${r},${g},${b},0.15)`);
  root.style.setProperty('--amber-glow', `rgba(${r},${g},${b},0.38)`);
};

/* ─── Apply font scale ──────────────────────────────────────────────────────── */
const applyFontScale = (index: number) => {
  const scale = FONT_SCALES[index];
  const app = document.getElementById('root');
  if (app) {
    (app as HTMLElement).style.zoom = scale.zoom.toString();
  }
};

/* ─── Hook ─────────────────────────────────────────────────────────────────── */
export function useAdminPrefs() {
  const [fontScaleIndex, setFontScaleIndexState] = useState(DEFAULT_PREFS.fontScaleIndex);
  const [accentColor, setAccentColorState] = useState(DEFAULT_PREFS.accentColor);

  // Load preferences from localStorage on mount
  useEffect(() => {
    const savedFontScale = localStorage.getItem('obie_fontsize');
    if (savedFontScale !== null) {
      const idx = parseInt(savedFontScale, 10);
      if (idx >= 0 && idx < FONT_SCALES.length) {
        setFontScaleIndexState(idx);
        applyFontScale(idx);
      }
    }

    const savedAccent = localStorage.getItem('obie_accent');
    if (savedAccent && /^#[0-9a-fA-F]{6}$/.test(savedAccent)) {
      setAccentColorState(savedAccent);
      applyAccentColor(savedAccent);
    }
  }, []);

  // Update font scale with persistence
  const setFontScaleIndex = (index: number) => {
    if (index >= 0 && index < FONT_SCALES.length) {
      setFontScaleIndexState(index);
      applyFontScale(index);
      localStorage.setItem('obie_fontsize', index.toString());
    }
  };

  // Update accent color with persistence
  const setAccentColor = (hex: string, persist = true) => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      setAccentColorState(hex);
      applyAccentColor(hex);
      if (persist) {
        localStorage.setItem('obie_accent', hex);
      }
    }
  };

  return {
    fontScaleIndex,
    setFontScaleIndex,
    accentColor,
    setAccentColor,
    fontScales: FONT_SCALES,
  };
}
