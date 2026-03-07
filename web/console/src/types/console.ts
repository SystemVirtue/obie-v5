/**
 * Console state types for the web UI.
 * Mirrors the MCP server types but optimized for React rendering.
 */

export type ChannelType = 'input' | 'aux' | 'fx-return' | 'bus' | 'matrix' | 'dca' | 'main' | 'monitor';

export interface ChannelState {
  index: number;
  type: ChannelType;
  name: string;
  color: string;
  fader: number;      // dB
  muted: boolean;
  solo: boolean;
  pan: number;         // -100 to +100
  // Preamp
  gain: number;        // dB
  phantom: boolean;
  phase: boolean;
  hpf: boolean;
  hpfFreq: number;     // Hz
  // EQ
  eqEnabled: boolean;
  eqBands: EQBandState[];
  // Gate
  gateEnabled: boolean;
  gateThreshold: number;
  gateRange: number;
  gateAttack: number;
  gateRelease: number;
  // Compressor
  compEnabled: boolean;
  compThreshold: number;
  compRatio: number;
  compAttack: number;
  compRelease: number;
  compMakeup: number;
  compKnee: number;
  // Meter
  meterLevel: number;  // dB RMS
  meterPeak: number;   // dB Peak
  gainReduction: number; // dB GR
  // Sends
  sends: SendState[];
}

export interface EQBandState {
  frequency: number;
  gain: number;
  q: number;
  enabled: boolean;
  type: 'low-shelf' | 'parametric' | 'high-shelf';
}

export interface SendState {
  busIndex: number;
  level: number;      // dB
  pan: number;
  enabled: boolean;
  preFader: boolean;
}

export interface EffectState {
  index: number;
  type: string;
  name: string;
  params: Record<string, number>;
}

export interface DCAState {
  index: number;
  name: string;
  fader: number;
  muted: boolean;
  members: number[];
  color: string;
}

export interface SceneState {
  index: number;
  name: string;
  current: boolean;
}

export interface ConsoleState {
  connected: boolean;
  host: string;
  model: string;
  channels: ChannelState[];
  buses: ChannelState[];
  auxInputs: ChannelState[];
  fxReturns: ChannelState[];
  matrices: ChannelState[];
  dcas: DCAState[];
  mainLR: ChannelState | null;
  effects: EffectState[];
  scenes: SceneState[];
  soloActive: boolean;
  talkbackActive: boolean;
}

// Color palette for channel strips
export const CHANNEL_COLORS = [
  '#ff3344', '#ff8800', '#ffd000', '#00ff88',
  '#00d4ff', '#4488ff', '#aa44ff', '#ff44aa',
  '#ffffff', '#888888', '#44ffcc', '#ff6644',
];

export function createDefaultChannel(type: ChannelType, index: number): ChannelState {
  return {
    index, type, name: `${type === 'input' ? 'Ch' : type === 'bus' ? 'Bus' : type} ${index}`,
    color: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
    fader: type === 'main' ? 0 : -Infinity,
    muted: false, solo: false, pan: 0,
    gain: 0, phantom: false, phase: false, hpf: false, hpfFreq: 80,
    eqEnabled: true,
    eqBands: [
      { frequency: 100, gain: 0, q: 1.5, enabled: true, type: 'low-shelf' },
      { frequency: 500, gain: 0, q: 2, enabled: true, type: 'parametric' },
      { frequency: 2500, gain: 0, q: 2, enabled: true, type: 'parametric' },
      { frequency: 8000, gain: 0, q: 1.5, enabled: true, type: 'high-shelf' },
    ],
    gateEnabled: false, gateThreshold: -40, gateRange: 40, gateAttack: 1, gateRelease: 100,
    compEnabled: false, compThreshold: -20, compRatio: 3, compAttack: 10, compRelease: 100, compMakeup: 0, compKnee: 3,
    meterLevel: -60, meterPeak: -60, gainReduction: 0,
    sends: Array.from({ length: 16 }, (_, i) => ({
      busIndex: i + 1, level: -Infinity, pan: 0, enabled: true, preFader: false,
    })),
  };
}
