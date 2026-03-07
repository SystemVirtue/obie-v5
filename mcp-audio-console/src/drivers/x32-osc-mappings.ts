/**
 * Behringer X32 / Midas M32 OSC address mappings.
 * Reference: X32 OSC protocol documentation (unofficial/Patrick-Gilles Maillot)
 *
 * The X32 uses a custom binary OSC variant with float values 0.0–1.0
 * mapped to the full parameter range. These utilities convert between
 * human-readable values (dB, Hz, ms) and the X32's normalized floats.
 */

import type { ChannelType } from '../console/types.js';

// ── OSC Address Prefixes ───────────────────────────────────────

export function getChannelPrefix(type: ChannelType, index: number): string {
  const idx = String(index).padStart(2, '0');
  switch (type) {
    case 'input':     return `/ch/${idx}`;
    case 'aux':       return `/auxin/${idx}`;
    case 'fx-return': return `/fxrtn/${idx}`;
    case 'bus':       return `/bus/${idx}`;
    case 'matrix':    return `/mtx/${idx}`;
    case 'main':      return index === 1 ? '/main/st' : `/main/m`;
    case 'dca':       return `/dca/${index}`;
    case 'monitor':   return `/main/m`;
    default:          throw new Error(`Unknown channel type: ${type}`);
  }
}

// ── Fader dB ↔ Float Conversion ────────────────────────────────
// X32 fader: 0.0 = -inf, ~0.75 = 0dB, 1.0 = +10dB
// Uses a piecewise linear approximation of the X32's fader law

const FADER_STEPS: [number, number][] = [
  [0.0, -90],    // -inf (represented as -90)
  [0.0625, -60],
  [0.125, -50],
  [0.1875, -40],
  [0.25, -30],
  [0.375, -20],
  [0.5, -10],
  [0.625, -5],
  [0.75, 0],
  [0.875, 5],
  [1.0, 10],
];

export function faderFloatToDb(value: number): number {
  if (value <= 0) return -Infinity;
  if (value >= 1) return 10;

  for (let i = 1; i < FADER_STEPS.length; i++) {
    const [f1, db1] = FADER_STEPS[i - 1];
    const [f2, db2] = FADER_STEPS[i];
    if (value <= f2) {
      const t = (value - f1) / (f2 - f1);
      return db1 + t * (db2 - db1);
    }
  }
  return 10;
}

export function dbToFaderFloat(db: number): number {
  if (db <= -90) return 0;
  if (db >= 10) return 1;

  for (let i = 1; i < FADER_STEPS.length; i++) {
    const [f1, db1] = FADER_STEPS[i - 1];
    const [f2, db2] = FADER_STEPS[i];
    if (db <= db2) {
      const t = (db - db1) / (db2 - db1);
      return f1 + t * (f2 - f1);
    }
  }
  return 1;
}

// ── Gain ───────────────────────────────────────────────────────
// Preamp gain: 0.0 = -12dB, 1.0 = +60dB (72dB range)

export function gainFloatToDb(value: number): number {
  return -12 + value * 72;
}

export function dbToGainFloat(db: number): number {
  return Math.max(0, Math.min(1, (db + 12) / 72));
}

// ── Pan ────────────────────────────────────────────────────────
// Pan: 0.0 = hard left (-100), 0.5 = center (0), 1.0 = hard right (+100)

export function panFloatToPosition(value: number): number {
  return Math.round((value - 0.5) * 200);
}

export function positionToPanFloat(position: number): number {
  return Math.max(0, Math.min(1, position / 200 + 0.5));
}

// ── EQ Frequency ───────────────────────────────────────────────
// Logarithmic mapping: 0.0 = 20Hz, 1.0 = 20kHz

export function eqFreqFloatToHz(value: number): number {
  return 20 * Math.pow(1000, value);
}

export function hzToEqFreqFloat(hz: number): number {
  return Math.log(hz / 20) / Math.log(1000);
}

// ── EQ Gain ────────────────────────────────────────────────────
// EQ gain: 0.0 = -15dB, 0.5 = 0dB, 1.0 = +15dB

export function eqGainFloatToDb(value: number): number {
  return (value - 0.5) * 30;
}

export function dbToEqGainFloat(db: number): number {
  return Math.max(0, Math.min(1, db / 30 + 0.5));
}

// ── EQ Q ───────────────────────────────────────────────────────
// Q: logarithmic 0.0 = 0.3, 1.0 = 16 (approximate)

export function eqQFloatToValue(value: number): number {
  return 0.3 * Math.pow(16 / 0.3, value);
}

export function valueToEqQFloat(q: number): number {
  return Math.log(q / 0.3) / Math.log(16 / 0.3);
}

// ── Dynamics Threshold ─────────────────────────────────────────
// Threshold: 0.0 = -80dB, 1.0 = 0dB

export function thresholdFloatToDb(value: number): number {
  return -80 + value * 80;
}

export function dbToThresholdFloat(db: number): number {
  return Math.max(0, Math.min(1, (db + 80) / 80));
}

// ── Dynamics Ratio ─────────────────────────────────────────────
// Discrete steps for compressor ratio on X32

const RATIO_STEPS = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 2, 2.5, 3, 3.5, 4, 5, 7, 10, 20, 100];

export function ratioFloatToValue(value: number): number {
  const idx = Math.round(value * (RATIO_STEPS.length - 1));
  return RATIO_STEPS[Math.min(idx, RATIO_STEPS.length - 1)];
}

export function valueToRatioFloat(ratio: number): number {
  let closest = 0;
  let minDiff = Infinity;
  for (let i = 0; i < RATIO_STEPS.length; i++) {
    const diff = Math.abs(RATIO_STEPS[i] - ratio);
    if (diff < minDiff) {
      minDiff = diff;
      closest = i;
    }
  }
  return closest / (RATIO_STEPS.length - 1);
}

// ── Dynamics Attack/Release ────────────────────────────────────
// Attack: 0.0 = 0ms, 1.0 = 120ms (linear)
// Release: 0.0 = 5ms, 1.0 = 4000ms (logarithmic)

export function attackFloatToMs(value: number): number {
  return value * 120;
}

export function msToAttackFloat(ms: number): number {
  return Math.max(0, Math.min(1, ms / 120));
}

export function releaseFloatToMs(value: number): number {
  return 5 * Math.pow(800, value);
}

export function msToReleaseFloat(ms: number): number {
  return Math.max(0, Math.min(1, Math.log(ms / 5) / Math.log(800)));
}

// ── OSC Address Builders ───────────────────────────────────────

export const oscAddresses = {
  // Channel
  fader: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/mix/fader`,
  mute: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/mix/on`,
  pan: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/mix/pan`,
  name: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/config/name`,
  color: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/config/color`,
  icon: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/config/icon`,
  source: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/config/source`,

  // Preamp (input channels only)
  gain: (idx: number) => `/ch/${String(idx).padStart(2, '0')}/preamp/trim`,
  phantom: (idx: number) => `/ch/${String(idx).padStart(2, '0')}/preamp/hpon`,
  phase: (idx: number) => `/ch/${String(idx).padStart(2, '0')}/preamp/invert`,
  lowCut: (idx: number) => `/ch/${String(idx).padStart(2, '0')}/preamp/hpf/on`,
  lowCutFreq: (idx: number) => `/ch/${String(idx).padStart(2, '0')}/preamp/hpf/fader`,

  // EQ
  eqOn: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/eq/on`,
  eqBandType: (type: ChannelType, idx: number, band: number) => `${getChannelPrefix(type, idx)}/eq/${band}/type`,
  eqBandFreq: (type: ChannelType, idx: number, band: number) => `${getChannelPrefix(type, idx)}/eq/${band}/f`,
  eqBandGain: (type: ChannelType, idx: number, band: number) => `${getChannelPrefix(type, idx)}/eq/${band}/g`,
  eqBandQ: (type: ChannelType, idx: number, band: number) => `${getChannelPrefix(type, idx)}/eq/${band}/q`,

  // Gate
  gateOn: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/gate/on`,
  gateThreshold: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/gate/thr`,
  gateRange: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/gate/range`,
  gateAttack: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/gate/attack`,
  gateHold: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/gate/hold`,
  gateRelease: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/gate/release`,

  // Compressor
  compOn: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/on`,
  compThreshold: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/thr`,
  compRatio: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/ratio`,
  compAttack: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/attack`,
  compHold: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/hold`,
  compRelease: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/release`,
  compKnee: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/knee`,
  compMakeup: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/mgain`,
  compAutoGain: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/auto`,
  compMix: (type: ChannelType, idx: number) => `${getChannelPrefix(type, idx)}/dyn/mix`,

  // Sends (from channel to bus)
  sendLevel: (type: ChannelType, chIdx: number, busIdx: number) =>
    `${getChannelPrefix(type, chIdx)}/mix/${String(busIdx).padStart(2, '0')}/level`,
  sendPan: (type: ChannelType, chIdx: number, busIdx: number) =>
    `${getChannelPrefix(type, chIdx)}/mix/${String(busIdx).padStart(2, '0')}/pan`,
  sendOn: (type: ChannelType, chIdx: number, busIdx: number) =>
    `${getChannelPrefix(type, chIdx)}/mix/${String(busIdx).padStart(2, '0')}/on`,
  sendPre: (type: ChannelType, chIdx: number, busIdx: number) =>
    `${getChannelPrefix(type, chIdx)}/mix/${String(busIdx).padStart(2, '0')}/grpon`,

  // Effects
  fxType: (slot: number) => `/fx/${slot}/type`,
  fxParam: (slot: number, param: number) => `/fx/${slot}/par/${String(param).padStart(2, '0')}`,

  // DCA
  dcaFader: (idx: number) => `/dca/${idx}/fader`,
  dcaMute: (idx: number) => `/dca/${idx}/on`,
  dcaName: (idx: number) => `/dca/${idx}/config/name`,

  // Scenes
  sceneRecall: () => '/-action/goscene',
  sceneSave: () => '/-action/savescene',
  sceneName: (idx: number) => `/-show/showfile/scene/${String(idx).padStart(3, '0')}/name`,

  // Meters (subscribe)
  meters: (bank: number) => `/meters/${bank}`,

  // Info
  info: () => '/info',
  xinfo: () => '/xinfo',
  status: () => '/status',
} as const;

// ── X32 Capabilities ──────────────────────────────────────────

export const X32_CAPABILITIES = {
  model: 'X32',
  manufacturer: 'Behringer',
  input_channels: 32,
  aux_inputs: 8,
  fx_returns: 8,
  mix_buses: 16,
  matrices: 6,
  dcas: 8,
  mute_groups: 6,
  fx_slots: 8,
  eq_bands_per_channel: 4,
  has_gate: true,
  has_compressor: true,
  has_insert: true,
  scenes: 100,
  sample_rates: [44100, 48000],
} as const;
