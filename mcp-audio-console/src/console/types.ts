/**
 * Core types for digital audio console abstraction.
 * Protocol-agnostic — console drivers implement these interfaces.
 */

// ── Channel Types ──────────────────────────────────────────────

export type ChannelType =
  | 'input'      // Mic/line input channels
  | 'aux'        // Aux input (tape, USB, etc.)
  | 'fx-return'  // Effects return
  | 'bus'        // Mix bus / subgroup
  | 'matrix'     // Matrix output
  | 'dca'        // DCA / VCA group
  | 'main'       // Main LR / mono
  | 'monitor';   // Monitor output

export interface ChannelConfig {
  index: number;         // 1-based channel number
  type: ChannelType;
  name: string;
  color?: number;        // Console-specific color index
  icon?: number;         // Console-specific icon index
  source?: string;       // Input source routing (e.g., "AES50A 01")
}

// ── Fader / Level ──────────────────────────────────────────────

export interface FaderState {
  /** Fader level in dB (-inf to +10) */
  level_db: number;
  /** Mute state */
  muted: boolean;
}

// ── Panning ────────────────────────────────────────────────────

export interface PanState {
  /** Pan position: -100 (hard left) to +100 (hard right) */
  position: number;
}

// ── Input / Preamp ─────────────────────────────────────────────

export interface PreampState {
  /** Gain in dB (typically 0–60 for mic, -12–+60 for line) */
  gain_db: number;
  /** +48V phantom power */
  phantom: boolean;
  /** Phase/polarity invert */
  phase_invert: boolean;
  /** Low-cut / high-pass filter enabled */
  low_cut: boolean;
  /** Low-cut frequency in Hz */
  low_cut_freq?: number;
}

// ── EQ ─────────────────────────────────────────────────────────

export type EQBandType = 'low-shelf' | 'low-mid' | 'mid' | 'high-mid' | 'high-shelf' | 'parametric';

export interface EQBand {
  type: EQBandType;
  frequency: number;   // Hz
  gain: number;         // dB (-15 to +15 typically)
  q: number;            // Q / bandwidth (0.3–16 typically)
  enabled: boolean;
}

export interface EQState {
  enabled: boolean;
  bands: EQBand[];
}

// ── Dynamics ───────────────────────────────────────────────────

export interface GateState {
  enabled: boolean;
  threshold: number;   // dB
  range: number;       // dB
  attack: number;      // ms
  hold: number;        // ms
  release: number;     // ms
}

export interface CompressorState {
  enabled: boolean;
  threshold: number;   // dB
  ratio: number;       // x:1
  attack: number;      // ms
  hold: number;        // ms
  release: number;     // ms
  knee: number;        // dB
  makeup_gain: number; // dB
  /** Is auto-makeup-gain enabled? */
  auto_gain: boolean;
  /** Mix/parallel compression (0–100%) */
  mix?: number;
}

export interface DynamicsState {
  gate: GateState;
  compressor: CompressorState;
}

// ── Sends / Aux / Bus Routing ──────────────────────────────────

export interface SendState {
  /** Destination bus/aux index (1-based) */
  bus_index: number;
  /** Send level in dB */
  level_db: number;
  /** Pre/post fader */
  pre_fader: boolean;
  /** Send pan (-100 to +100) */
  pan?: number;
  /** Send enabled/on */
  enabled: boolean;
}

// ── Insert ─────────────────────────────────────────────────────

export interface InsertState {
  enabled: boolean;
  position: 'pre-eq' | 'post-eq' | 'pre-fader' | 'post-fader';
  /** Plugin/effect slot identifier */
  effect_id?: string;
}

// ── Effects ────────────────────────────────────────────────────

export type EffectType =
  | 'reverb-hall' | 'reverb-plate' | 'reverb-room' | 'reverb-chamber' | 'reverb-ambience'
  | 'delay-mono' | 'delay-stereo' | 'delay-ping-pong'
  | 'chorus' | 'flanger' | 'phaser'
  | 'graphic-eq' | 'parametric-eq'
  | 'compressor' | 'limiter' | 'de-esser'
  | 'pitch-shift' | 'exciter' | 'enhancer';

export interface EffectSlot {
  index: number;
  type: EffectType;
  name: string;
  parameters: Record<string, number | boolean | string>;
}

// ── DCA / VCA Group ────────────────────────────────────────────

export interface DCAGroup {
  index: number;
  name: string;
  fader: FaderState;
  /** Channel indices assigned to this DCA */
  members: number[];
}

// ── Mute Group ─────────────────────────────────────────────────

export interface MuteGroup {
  index: number;
  name: string;
  active: boolean;
  /** Channel indices in this mute group */
  members: number[];
}

// ── Scene / Snapshot ───────────────────────────────────────────

export interface Scene {
  index: number;
  name: string;
  notes?: string;
}

// ── Meters ─────────────────────────────────────────────────────

export interface MeterReading {
  channel_index: number;
  channel_type: ChannelType;
  /** Current RMS level in dB */
  rms_db: number;
  /** Current peak level in dB */
  peak_db: number;
}

// ── Full Channel State ─────────────────────────────────────────

export interface ChannelState {
  config: ChannelConfig;
  fader: FaderState;
  pan: PanState;
  preamp?: PreampState;
  eq: EQState;
  dynamics?: DynamicsState;
  sends: SendState[];
  inserts: InsertState[];
}

// ── Console Capabilities ───────────────────────────────────────

export interface ConsoleCapabilities {
  model: string;
  manufacturer: string;
  input_channels: number;
  aux_inputs: number;
  fx_returns: number;
  mix_buses: number;
  matrices: number;
  dcas: number;
  mute_groups: number;
  fx_slots: number;
  eq_bands_per_channel: number;
  has_gate: boolean;
  has_compressor: boolean;
  has_insert: boolean;
  scenes: number;
  sample_rates: number[];
}
