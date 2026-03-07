/**
 * Abstract console interface — all console drivers implement this.
 * This is the protocol-agnostic contract for controlling any digital mixer.
 */

import type {
  ChannelConfig,
  ChannelState,
  ChannelType,
  CompressorState,
  ConsoleCapabilities,
  DCAGroup,
  DynamicsState,
  EQBand,
  EQState,
  EffectSlot,
  FaderState,
  GateState,
  InsertState,
  MeterReading,
  MuteGroup,
  PanState,
  PreampState,
  Scene,
  SendState,
} from './types.js';

export interface ConsoleConnection {
  host: string;
  port: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConsoleEvents {
  'connection:status': (status: ConnectionStatus) => void;
  'channel:fader': (type: ChannelType, index: number, fader: FaderState) => void;
  'channel:eq': (type: ChannelType, index: number, eq: EQState) => void;
  'channel:dynamics': (type: ChannelType, index: number, dynamics: DynamicsState) => void;
  'meters': (readings: MeterReading[]) => void;
  'scene:recalled': (scene: Scene) => void;
  'error': (error: Error) => void;
}

/**
 * Core console driver interface.
 * Each supported console model implements this interface.
 */
export interface ConsoleDriver {
  // ── Connection ──────────────────────────────────────────
  connect(connection: ConsoleConnection): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ConnectionStatus;

  // ── Capabilities ────────────────────────────────────────
  getCapabilities(): ConsoleCapabilities;

  // ── Channel State ───────────────────────────────────────
  getChannelState(type: ChannelType, index: number): Promise<ChannelState>;
  getAllChannelStates(type: ChannelType): Promise<ChannelState[]>;

  // ── Fader / Mute ────────────────────────────────────────
  setFader(type: ChannelType, index: number, level_db: number): Promise<void>;
  setMute(type: ChannelType, index: number, muted: boolean): Promise<void>;
  getFader(type: ChannelType, index: number): Promise<FaderState>;

  // ── Pan ─────────────────────────────────────────────────
  setPan(type: ChannelType, index: number, position: number): Promise<void>;
  getPan(type: ChannelType, index: number): Promise<PanState>;

  // ── Preamp / Input ──────────────────────────────────────
  setPreamp(index: number, preamp: Partial<PreampState>): Promise<void>;
  getPreamp(index: number): Promise<PreampState>;

  // ── EQ ──────────────────────────────────────────────────
  setEQBand(type: ChannelType, index: number, band: number, params: Partial<EQBand>): Promise<void>;
  setEQEnabled(type: ChannelType, index: number, enabled: boolean): Promise<void>;
  getEQ(type: ChannelType, index: number): Promise<EQState>;

  // ── Dynamics ────────────────────────────────────────────
  setGate(type: ChannelType, index: number, params: Partial<GateState>): Promise<void>;
  setCompressor(type: ChannelType, index: number, params: Partial<CompressorState>): Promise<void>;
  getDynamics(type: ChannelType, index: number): Promise<DynamicsState>;

  // ── Sends ───────────────────────────────────────────────
  setSend(type: ChannelType, ch_index: number, bus_index: number, params: Partial<SendState>): Promise<void>;
  getSends(type: ChannelType, index: number): Promise<SendState[]>;

  // ── Inserts ─────────────────────────────────────────────
  setInsert(type: ChannelType, index: number, slot: number, params: Partial<InsertState>): Promise<void>;
  getInserts(type: ChannelType, index: number): Promise<InsertState[]>;

  // ── Effects ─────────────────────────────────────────────
  setEffect(slot: number, params: Partial<EffectSlot>): Promise<void>;
  getEffect(slot: number): Promise<EffectSlot>;
  getAllEffects(): Promise<EffectSlot[]>;

  // ── DCA / VCA Groups ────────────────────────────────────
  setDCA(index: number, fader: Partial<FaderState>): Promise<void>;
  getDCA(index: number): Promise<DCAGroup>;
  setDCAMembers(index: number, members: number[]): Promise<void>;

  // ── Mute Groups ─────────────────────────────────────────
  setMuteGroup(index: number, active: boolean): Promise<void>;
  getMuteGroup(index: number): Promise<MuteGroup>;

  // ── Scenes / Snapshots ──────────────────────────────────
  recallScene(index: number): Promise<void>;
  saveScene(index: number, name: string): Promise<void>;
  getSceneList(): Promise<Scene[]>;
  getCurrentScene(): Promise<Scene | null>;

  // ── Meters ──────────────────────────────────────────────
  subscribeMeters(types: ChannelType[]): Promise<void>;
  unsubscribeMeters(): Promise<void>;
  getMeters(type: ChannelType): Promise<MeterReading[]>;

  // ── Channel Config ──────────────────────────────────────
  setChannelConfig(type: ChannelType, index: number, config: Partial<ChannelConfig>): Promise<void>;
  getChannelConfig(type: ChannelType, index: number): Promise<ChannelConfig>;

  // ── Events ──────────────────────────────────────────────
  on<K extends keyof ConsoleEvents>(event: K, handler: ConsoleEvents[K]): void;
  off<K extends keyof ConsoleEvents>(event: K, handler: ConsoleEvents[K]): void;
}
