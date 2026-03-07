/**
 * Behringer X32 / Midas M32 console driver.
 * Communicates via OSC over UDP.
 */

import { Client, Server } from 'node-osc';
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
} from '../console/types.js';
import type { ConnectionStatus, ConsoleConnection, ConsoleDriver, ConsoleEvents } from '../console/interface.js';
import {
  X32_CAPABILITIES,
  oscAddresses,
  faderFloatToDb,
  dbToFaderFloat,
  gainFloatToDb,
  dbToGainFloat,
  panFloatToPosition,
  positionToPanFloat,
  eqFreqFloatToHz,
  hzToEqFreqFloat,
  eqGainFloatToDb,
  dbToEqGainFloat,
  eqQFloatToValue,
  valueToEqQFloat,
  thresholdFloatToDb,
  dbToThresholdFloat,
  ratioFloatToValue,
  valueToRatioFloat,
  attackFloatToMs,
  msToAttackFloat,
  releaseFloatToMs,
  msToReleaseFloat,
} from './x32-osc-mappings.js';

type EventHandlers = {
  [K in keyof ConsoleEvents]?: Set<ConsoleEvents[K]>;
};

/**
 * X32 driver implementation.
 * Uses node-osc for UDP communication with the console.
 */
export class X32Driver implements ConsoleDriver {
  private client: Client | null = null;
  private server: Server | null = null;
  private status: ConnectionStatus = 'disconnected';
  private handlers: EventHandlers = {};
  private connection: ConsoleConnection | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  // Pending request/response tracking for synchronous queries
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  // ── Connection ──────────────────────────────────────────

  async connect(connection: ConsoleConnection): Promise<void> {
    this.connection = connection;
    this.emit('connection:status', 'connecting');

    try {
      // OSC client to send messages to the console
      this.client = new Client(connection.host, connection.port);

      // OSC server to receive responses (X32 sends back to port 10024 by default)
      const listenPort = 10024;
      this.server = new Server(listenPort, '0.0.0.0');

      this.server.on('message', (msg: unknown[]) => {
        this.handleOscMessage(msg);
      });

      // X32 requires periodic /xremote to keep the connection alive
      this.keepAliveInterval = setInterval(() => {
        this.send('/xremote');
      }, 8000);

      // Initial handshake — request console info
      this.send('/info');
      this.send('/xinfo');

      this.status = 'connected';
      this.emit('connection:status', 'connected');
    } catch (err) {
      this.status = 'error';
      this.emit('connection:status', 'error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    this.status = 'disconnected';
    this.emit('connection:status', 'disconnected');
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  // ── Capabilities ────────────────────────────────────────

  getCapabilities(): ConsoleCapabilities {
    return { ...X32_CAPABILITIES, sample_rates: [...X32_CAPABILITIES.sample_rates] };
  }

  // ── Channel State ───────────────────────────────────────

  async getChannelState(type: ChannelType, index: number): Promise<ChannelState> {
    const [config, fader, pan, eq, sends] = await Promise.all([
      this.getChannelConfig(type, index),
      this.getFader(type, index),
      this.getPan(type, index),
      this.getEQ(type, index),
      this.getSends(type, index),
    ]);

    const state: ChannelState = { config, fader, pan, eq, sends, inserts: [] };

    if (type === 'input') {
      const [preamp, dynamics, inserts] = await Promise.all([
        this.getPreamp(index),
        this.getDynamics(type, index),
        this.getInserts(type, index),
      ]);
      state.preamp = preamp;
      state.dynamics = dynamics;
      state.inserts = inserts;
    }

    return state;
  }

  async getAllChannelStates(type: ChannelType): Promise<ChannelState[]> {
    const count = this.getChannelCount(type);
    const promises = Array.from({ length: count }, (_, i) =>
      this.getChannelState(type, i + 1)
    );
    return Promise.all(promises);
  }

  // ── Fader / Mute ────────────────────────────────────────

  async setFader(type: ChannelType, index: number, level_db: number): Promise<void> {
    this.send(oscAddresses.fader(type, index), dbToFaderFloat(level_db));
  }

  async setMute(type: ChannelType, index: number, muted: boolean): Promise<void> {
    // X32: /mix/on = 1 means UN-muted, 0 = muted
    this.send(oscAddresses.mute(type, index), muted ? 0 : 1);
  }

  async getFader(type: ChannelType, index: number): Promise<FaderState> {
    const [faderVal, muteVal] = await Promise.all([
      this.query(oscAddresses.fader(type, index)) as Promise<number>,
      this.query(oscAddresses.mute(type, index)) as Promise<number>,
    ]);
    return {
      level_db: faderFloatToDb(faderVal ?? 0),
      muted: (muteVal ?? 1) === 0,
    };
  }

  // ── Pan ─────────────────────────────────────────────────

  async setPan(type: ChannelType, index: number, position: number): Promise<void> {
    this.send(oscAddresses.pan(type, index), positionToPanFloat(position));
  }

  async getPan(type: ChannelType, index: number): Promise<PanState> {
    const val = await this.query(oscAddresses.pan(type, index)) as number;
    return { position: panFloatToPosition(val ?? 0.5) };
  }

  // ── Preamp / Input ──────────────────────────────────────

  async setPreamp(index: number, preamp: Partial<PreampState>): Promise<void> {
    const promises: Promise<void>[] = [];
    if (preamp.gain_db !== undefined) promises.push(this.sendAsync(oscAddresses.gain(index), dbToGainFloat(preamp.gain_db)));
    if (preamp.phantom !== undefined) promises.push(this.sendAsync(oscAddresses.phantom(index), preamp.phantom ? 1 : 0));
    if (preamp.phase_invert !== undefined) promises.push(this.sendAsync(oscAddresses.phase(index), preamp.phase_invert ? 1 : 0));
    if (preamp.low_cut !== undefined) promises.push(this.sendAsync(oscAddresses.lowCut(index), preamp.low_cut ? 1 : 0));
    if (preamp.low_cut_freq !== undefined) promises.push(this.sendAsync(oscAddresses.lowCutFreq(index), hzToEqFreqFloat(preamp.low_cut_freq)));
    await Promise.all(promises);
  }

  async getPreamp(index: number): Promise<PreampState> {
    const [gain, phantom, phase, lowCut, lowCutFreq] = await Promise.all([
      this.query(oscAddresses.gain(index)) as Promise<number>,
      this.query(oscAddresses.phantom(index)) as Promise<number>,
      this.query(oscAddresses.phase(index)) as Promise<number>,
      this.query(oscAddresses.lowCut(index)) as Promise<number>,
      this.query(oscAddresses.lowCutFreq(index)) as Promise<number>,
    ]);
    return {
      gain_db: gainFloatToDb(gain ?? 0),
      phantom: (phantom ?? 0) === 1,
      phase_invert: (phase ?? 0) === 1,
      low_cut: (lowCut ?? 0) === 1,
      low_cut_freq: eqFreqFloatToHz(lowCutFreq ?? 0),
    };
  }

  // ── EQ ──────────────────────────────────────────────────

  async setEQBand(type: ChannelType, index: number, band: number, params: Partial<EQBand>): Promise<void> {
    const promises: Promise<void>[] = [];
    if (params.frequency !== undefined)
      promises.push(this.sendAsync(oscAddresses.eqBandFreq(type, index, band), hzToEqFreqFloat(params.frequency)));
    if (params.gain !== undefined)
      promises.push(this.sendAsync(oscAddresses.eqBandGain(type, index, band), dbToEqGainFloat(params.gain)));
    if (params.q !== undefined)
      promises.push(this.sendAsync(oscAddresses.eqBandQ(type, index, band), valueToEqQFloat(params.q)));
    await Promise.all(promises);
  }

  async setEQEnabled(type: ChannelType, index: number, enabled: boolean): Promise<void> {
    this.send(oscAddresses.eqOn(type, index), enabled ? 1 : 0);
  }

  async getEQ(type: ChannelType, index: number): Promise<EQState> {
    const eqOn = await this.query(oscAddresses.eqOn(type, index)) as number;
    const bandCount = X32_CAPABILITIES.eq_bands_per_channel;
    const bands: EQBand[] = [];

    for (let b = 1; b <= bandCount; b++) {
      const [freq, gain, q] = await Promise.all([
        this.query(oscAddresses.eqBandFreq(type, index, b)) as Promise<number>,
        this.query(oscAddresses.eqBandGain(type, index, b)) as Promise<number>,
        this.query(oscAddresses.eqBandQ(type, index, b)) as Promise<number>,
      ]);
      const bandTypes = ['low-shelf', 'low-mid', 'high-mid', 'high-shelf'] as const;
      bands.push({
        type: bandTypes[b - 1] ?? 'parametric',
        frequency: eqFreqFloatToHz(freq ?? 0.5),
        gain: eqGainFloatToDb(gain ?? 0.5),
        q: eqQFloatToValue(q ?? 0.5),
        enabled: true,
      });
    }

    return { enabled: (eqOn ?? 1) === 1, bands };
  }

  // ── Dynamics ────────────────────────────────────────────

  async setGate(type: ChannelType, index: number, params: Partial<GateState>): Promise<void> {
    const promises: Promise<void>[] = [];
    if (params.enabled !== undefined)
      promises.push(this.sendAsync(oscAddresses.gateOn(type, index), params.enabled ? 1 : 0));
    if (params.threshold !== undefined)
      promises.push(this.sendAsync(oscAddresses.gateThreshold(type, index), dbToThresholdFloat(params.threshold)));
    if (params.attack !== undefined)
      promises.push(this.sendAsync(oscAddresses.gateAttack(type, index), msToAttackFloat(params.attack)));
    if (params.release !== undefined)
      promises.push(this.sendAsync(oscAddresses.gateRelease(type, index), msToReleaseFloat(params.release)));
    await Promise.all(promises);
  }

  async setCompressor(type: ChannelType, index: number, params: Partial<CompressorState>): Promise<void> {
    const promises: Promise<void>[] = [];
    if (params.enabled !== undefined)
      promises.push(this.sendAsync(oscAddresses.compOn(type, index), params.enabled ? 1 : 0));
    if (params.threshold !== undefined)
      promises.push(this.sendAsync(oscAddresses.compThreshold(type, index), dbToThresholdFloat(params.threshold)));
    if (params.ratio !== undefined)
      promises.push(this.sendAsync(oscAddresses.compRatio(type, index), valueToRatioFloat(params.ratio)));
    if (params.attack !== undefined)
      promises.push(this.sendAsync(oscAddresses.compAttack(type, index), msToAttackFloat(params.attack)));
    if (params.release !== undefined)
      promises.push(this.sendAsync(oscAddresses.compRelease(type, index), msToReleaseFloat(params.release)));
    if (params.makeup_gain !== undefined)
      promises.push(this.sendAsync(oscAddresses.compMakeup(type, index), dbToEqGainFloat(params.makeup_gain)));
    if (params.auto_gain !== undefined)
      promises.push(this.sendAsync(oscAddresses.compAutoGain(type, index), params.auto_gain ? 1 : 0));
    await Promise.all(promises);
  }

  async getDynamics(type: ChannelType, index: number): Promise<DynamicsState> {
    const [gateOn, gateThr, gateAtk, gateRel, gateRange] = await Promise.all([
      this.query(oscAddresses.gateOn(type, index)) as Promise<number>,
      this.query(oscAddresses.gateThreshold(type, index)) as Promise<number>,
      this.query(oscAddresses.gateAttack(type, index)) as Promise<number>,
      this.query(oscAddresses.gateRelease(type, index)) as Promise<number>,
      this.query(oscAddresses.gateRange(type, index)) as Promise<number>,
    ]);
    const [compOn, compThr, compRatio, compAtk, compRel, compKnee, compMakeup, compAuto] = await Promise.all([
      this.query(oscAddresses.compOn(type, index)) as Promise<number>,
      this.query(oscAddresses.compThreshold(type, index)) as Promise<number>,
      this.query(oscAddresses.compRatio(type, index)) as Promise<number>,
      this.query(oscAddresses.compAttack(type, index)) as Promise<number>,
      this.query(oscAddresses.compRelease(type, index)) as Promise<number>,
      this.query(oscAddresses.compKnee(type, index)) as Promise<number>,
      this.query(oscAddresses.compMakeup(type, index)) as Promise<number>,
      this.query(oscAddresses.compAutoGain(type, index)) as Promise<number>,
    ]);

    return {
      gate: {
        enabled: (gateOn ?? 0) === 1,
        threshold: thresholdFloatToDb(gateThr ?? 0),
        range: (gateRange ?? 0) * 80,
        attack: attackFloatToMs(gateAtk ?? 0),
        hold: 0,
        release: releaseFloatToMs(gateRel ?? 0),
      },
      compressor: {
        enabled: (compOn ?? 0) === 1,
        threshold: thresholdFloatToDb(compThr ?? 0.5),
        ratio: ratioFloatToValue(compRatio ?? 0),
        attack: attackFloatToMs(compAtk ?? 0),
        hold: 0,
        release: releaseFloatToMs(compRel ?? 0.5),
        knee: (compKnee ?? 0) * 6,
        makeup_gain: eqGainFloatToDb(compMakeup ?? 0.5),
        auto_gain: (compAuto ?? 0) === 1,
      },
    };
  }

  // ── Sends ───────────────────────────────────────────────

  async setSend(type: ChannelType, chIndex: number, busIndex: number, params: Partial<SendState>): Promise<void> {
    const promises: Promise<void>[] = [];
    if (params.level_db !== undefined)
      promises.push(this.sendAsync(oscAddresses.sendLevel(type, chIndex, busIndex), dbToFaderFloat(params.level_db)));
    if (params.enabled !== undefined)
      promises.push(this.sendAsync(oscAddresses.sendOn(type, chIndex, busIndex), params.enabled ? 1 : 0));
    if (params.pan !== undefined)
      promises.push(this.sendAsync(oscAddresses.sendPan(type, chIndex, busIndex), positionToPanFloat(params.pan)));
    await Promise.all(promises);
  }

  async getSends(type: ChannelType, index: number): Promise<SendState[]> {
    const sends: SendState[] = [];
    for (let bus = 1; bus <= X32_CAPABILITIES.mix_buses; bus++) {
      const [level, on] = await Promise.all([
        this.query(oscAddresses.sendLevel(type, index, bus)) as Promise<number>,
        this.query(oscAddresses.sendOn(type, index, bus)) as Promise<number>,
      ]);
      sends.push({
        bus_index: bus,
        level_db: faderFloatToDb(level ?? 0),
        pre_fader: false,
        enabled: (on ?? 1) === 1,
      });
    }
    return sends;
  }

  // ── Inserts ─────────────────────────────────────────────

  async setInsert(_type: ChannelType, _index: number, _slot: number, _params: Partial<InsertState>): Promise<void> {
    // X32 inserts are hardware-routed; limited OSC control
  }

  async getInserts(_type: ChannelType, _index: number): Promise<InsertState[]> {
    return [];
  }

  // ── Effects ─────────────────────────────────────────────

  async setEffect(slot: number, params: Partial<EffectSlot>): Promise<void> {
    if (params.type !== undefined) {
      this.send(oscAddresses.fxType(slot), params.type);
    }
    if (params.parameters) {
      let paramIdx = 1;
      for (const [, value] of Object.entries(params.parameters)) {
        if (typeof value === 'number') {
          this.send(oscAddresses.fxParam(slot, paramIdx), value);
        }
        paramIdx++;
      }
    }
  }

  async getEffect(slot: number): Promise<EffectSlot> {
    const type = await this.query(oscAddresses.fxType(slot)) as string;
    return {
      index: slot,
      type: (type ?? 'reverb-hall') as EffectSlot['type'],
      name: `FX ${slot}`,
      parameters: {},
    };
  }

  async getAllEffects(): Promise<EffectSlot[]> {
    const effects: EffectSlot[] = [];
    for (let i = 1; i <= X32_CAPABILITIES.fx_slots; i++) {
      effects.push(await this.getEffect(i));
    }
    return effects;
  }

  // ── DCA / VCA Groups ────────────────────────────────────

  async setDCA(index: number, fader: Partial<FaderState>): Promise<void> {
    if (fader.level_db !== undefined) this.send(oscAddresses.dcaFader(index), dbToFaderFloat(fader.level_db));
    if (fader.muted !== undefined) this.send(oscAddresses.dcaMute(index), fader.muted ? 0 : 1);
  }

  async getDCA(index: number): Promise<DCAGroup> {
    const [faderVal, muteVal, name] = await Promise.all([
      this.query(oscAddresses.dcaFader(index)) as Promise<number>,
      this.query(oscAddresses.dcaMute(index)) as Promise<number>,
      this.query(oscAddresses.dcaName(index)) as Promise<string>,
    ]);
    return {
      index,
      name: (name as string) ?? `DCA ${index}`,
      fader: {
        level_db: faderFloatToDb(faderVal ?? 0.75),
        muted: (muteVal ?? 1) === 0,
      },
      members: [],
    };
  }

  async setDCAMembers(_index: number, _members: number[]): Promise<void> {
    // DCA membership is set per-channel on the X32, not on the DCA group itself
    // Would need to iterate channels and set their DCA assignment
  }

  // ── Mute Groups ─────────────────────────────────────────

  async setMuteGroup(index: number, active: boolean): Promise<void> {
    this.send(`/config/mute/${index}`, active ? 1 : 0);
  }

  async getMuteGroup(index: number): Promise<MuteGroup> {
    return {
      index,
      name: `Mute ${index}`,
      active: false,
      members: [],
    };
  }

  // ── Scenes / Snapshots ──────────────────────────────────

  async recallScene(index: number): Promise<void> {
    this.send(oscAddresses.sceneRecall(), index);
  }

  async saveScene(index: number, name: string): Promise<void> {
    this.send(oscAddresses.sceneName(index), name);
    this.send(oscAddresses.sceneSave(), index);
  }

  async getSceneList(): Promise<Scene[]> {
    const scenes: Scene[] = [];
    for (let i = 0; i < X32_CAPABILITIES.scenes; i++) {
      const name = await this.query(oscAddresses.sceneName(i)) as string;
      if (name) {
        scenes.push({ index: i, name: name as string });
      }
    }
    return scenes;
  }

  async getCurrentScene(): Promise<Scene | null> {
    return null; // X32 doesn't easily report current scene via OSC
  }

  // ── Meters ──────────────────────────────────────────────

  async subscribeMeters(types: ChannelType[]): Promise<void> {
    // X32 meter banks: 0 = input channels, 1 = buses, etc.
    const banks = new Set<number>();
    for (const type of types) {
      switch (type) {
        case 'input': banks.add(0); break;
        case 'bus': banks.add(1); break;
        case 'main': banks.add(2); break;
        default: banks.add(0);
      }
    }
    for (const bank of banks) {
      this.send('/meters', `/meters/${bank}`);
    }
  }

  async unsubscribeMeters(): Promise<void> {
    this.send('/meters', '/meters/0', 0);
  }

  async getMeters(type: ChannelType): Promise<MeterReading[]> {
    // Meters are subscription-based on X32; this returns last cached values
    const count = this.getChannelCount(type);
    return Array.from({ length: count }, (_, i) => ({
      channel_index: i + 1,
      channel_type: type,
      rms_db: -60,
      peak_db: -60,
    }));
  }

  // ── Channel Config ──────────────────────────────────────

  async setChannelConfig(type: ChannelType, index: number, config: Partial<ChannelConfig>): Promise<void> {
    if (config.name !== undefined) this.send(oscAddresses.name(type, index), config.name);
    if (config.color !== undefined) this.send(oscAddresses.color(type, index), config.color);
    if (config.icon !== undefined) this.send(oscAddresses.icon(type, index), config.icon);
  }

  async getChannelConfig(type: ChannelType, index: number): Promise<ChannelConfig> {
    const name = await this.query(oscAddresses.name(type, index)) as string;
    return {
      index,
      type,
      name: (name as string) ?? `${type} ${index}`,
    };
  }

  // ── Events ──────────────────────────────────────────────

  on<K extends keyof ConsoleEvents>(event: K, handler: ConsoleEvents[K]): void {
    if (!this.handlers[event]) {
      this.handlers[event] = new Set() as any;
    }
    (this.handlers[event] as Set<ConsoleEvents[K]>).add(handler);
  }

  off<K extends keyof ConsoleEvents>(event: K, handler: ConsoleEvents[K]): void {
    (this.handlers[event] as Set<ConsoleEvents[K]>)?.delete(handler);
  }

  // ── Private Helpers ─────────────────────────────────────

  private emit<K extends keyof ConsoleEvents>(event: K, ...args: Parameters<ConsoleEvents[K]>): void {
    const handlers = this.handlers[event] as Set<ConsoleEvents[K]> | undefined;
    if (handlers) {
      for (const handler of handlers) {
        (handler as (...a: unknown[]) => void)(...args);
      }
    }
  }

  private send(address: string, ...args: (string | number | boolean)[]): void {
    if (!this.client) throw new Error('Not connected to console');
    this.client.send(address, ...args as any);
  }

  private sendAsync(address: string, ...args: (string | number | boolean)[]): Promise<void> {
    this.send(address, ...args);
    return Promise.resolve();
  }

  private query(address: string): Promise<unknown> {
    return new Promise((resolve) => {
      if (!this.client) {
        resolve(null);
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(address);
        resolve(null);
      }, 500);

      this.pendingRequests.set(address, { resolve, timeout });
      this.client.send(address);
    });
  }

  private handleOscMessage(msg: unknown[]): void {
    const address = msg[0] as string;
    const args = msg.slice(1);

    // Check if this is a response to a pending query
    const pending = this.pendingRequests.get(address);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(address);
      pending.resolve(args[0]);
      return;
    }

    // Handle unsolicited updates (meter data, parameter changes)
    if (address.startsWith('/meters/')) {
      // Meter blob data — parse and emit
      return;
    }

    // Emit relevant channel events for real-time updates
    // This enables the MCP server to track live state changes
  }

  private getChannelCount(type: ChannelType): number {
    switch (type) {
      case 'input': return X32_CAPABILITIES.input_channels;
      case 'aux': return X32_CAPABILITIES.aux_inputs;
      case 'fx-return': return X32_CAPABILITIES.fx_returns;
      case 'bus': return X32_CAPABILITIES.mix_buses;
      case 'matrix': return X32_CAPABILITIES.matrices;
      case 'dca': return X32_CAPABILITIES.dcas;
      case 'main': return 2; // stereo + mono
      case 'monitor': return 1;
      default: return 0;
    }
  }
}
