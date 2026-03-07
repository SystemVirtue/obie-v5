/**
 * Console state store with simulated metering for demo mode.
 * In production, this connects via WebSocket to the MCP audio console server.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChannelState, ConsoleState, DCAState, EffectState, SceneState, ChannelType } from '@/types/console';
import { createDefaultChannel, CHANNEL_COLORS } from '@/types/console';

const DEMO_CHANNELS: Partial<ChannelState>[] = [
  { name: 'Kick', color: '#ff3344' },
  { name: 'Snare', color: '#ff3344' },
  { name: 'HiHat', color: '#ff3344' },
  { name: 'Tom 1', color: '#ff3344' },
  { name: 'Tom 2', color: '#ff3344' },
  { name: 'OH L', color: '#ff8800' },
  { name: 'OH R', color: '#ff8800' },
  { name: 'Bass', color: '#ffd000' },
  { name: 'Gtr L', color: '#00ff88' },
  { name: 'Gtr R', color: '#00ff88' },
  { name: 'Acous', color: '#00ff88' },
  { name: 'Keys L', color: '#00d4ff' },
  { name: 'Keys R', color: '#00d4ff' },
  { name: 'Pads L', color: '#00d4ff' },
  { name: 'Pads R', color: '#00d4ff' },
  { name: 'Lead V', color: '#aa44ff' },
  { name: 'BV 1', color: '#aa44ff' },
  { name: 'BV 2', color: '#aa44ff' },
  { name: 'BV 3', color: '#aa44ff' },
  { name: 'Talk', color: '#ffffff' },
  { name: 'FX L', color: '#4488ff' },
  { name: 'FX R', color: '#4488ff' },
  { name: 'Trk L', color: '#888888' },
  { name: 'Trk R', color: '#888888' },
  { name: 'Ch 25', color: '#888888' },
  { name: 'Ch 26', color: '#888888' },
  { name: 'Ch 27', color: '#888888' },
  { name: 'Ch 28', color: '#888888' },
  { name: 'Ch 29', color: '#888888' },
  { name: 'Ch 30', color: '#888888' },
  { name: 'Ch 31', color: '#888888' },
  { name: 'Ch 32', color: '#888888' },
];

const DEMO_DCAS: Partial<DCAState>[] = [
  { name: 'Drums', color: '#ff3344' },
  { name: 'Bass', color: '#ffd000' },
  { name: 'Gtrs', color: '#00ff88' },
  { name: 'Keys', color: '#00d4ff' },
  { name: 'Vocals', color: '#aa44ff' },
  { name: 'FX', color: '#4488ff' },
  { name: 'Band', color: '#ff8800' },
  { name: 'All', color: '#ffffff' },
];

const DEMO_EFFECTS: EffectState[] = [
  { index: 1, type: 'Plate Reverb', name: 'Vox Plate', params: { decay: 1.8, predelay: 30, damping: 0.6 } },
  { index: 2, type: 'Delay', name: 'Vox Delay', params: { time: 375, feedback: 0.25, mix: 0.2 } },
  { index: 3, type: 'Plate Reverb', name: 'Snr Plate', params: { decay: 1.2, predelay: 5, damping: 0.7 } },
  { index: 4, type: 'Hall Reverb', name: 'Hall', params: { decay: 2.5, predelay: 40, damping: 0.5 } },
  { index: 5, type: 'Chorus', name: 'Chorus', params: { rate: 0.8, depth: 0.5, mix: 0.3 } },
  { index: 6, type: 'Graphic EQ', name: 'GEQ L', params: {} },
  { index: 7, type: 'Graphic EQ', name: 'GEQ R', params: {} },
  { index: 8, type: 'Compressor', name: 'Bus Comp', params: { threshold: -15, ratio: 2, attack: 30 } },
];

function createInitialState(): ConsoleState {
  const channels = DEMO_CHANNELS.map((demo, i) => {
    const ch = createDefaultChannel('input', i + 1);
    ch.name = demo.name || ch.name;
    ch.color = demo.color || ch.color;
    // Give first 19 channels some fader level
    if (i < 19) ch.fader = -5 - Math.random() * 15;
    if (i < 7) { ch.gateEnabled = true; ch.compEnabled = true; }
    if (i >= 15 && i < 19) ch.compEnabled = true;
    if (i === 7) ch.compEnabled = true;
    return ch;
  });

  const buses = Array.from({ length: 16 }, (_, i) => {
    const b = createDefaultChannel('bus', i + 1);
    b.name = i < 6 ? `Mon ${i + 1}` : i < 8 ? `FX ${i - 5}` : `Bus ${i + 1}`;
    b.color = CHANNEL_COLORS[i % CHANNEL_COLORS.length];
    if (i < 8) b.fader = -10 + Math.random() * 5;
    return b;
  });

  const dcas: DCAState[] = DEMO_DCAS.map((d, i) => ({
    index: i + 1,
    name: d.name || `DCA ${i + 1}`,
    fader: 0,
    muted: false,
    members: [],
    color: d.color || '#888',
  }));

  const mainLR = createDefaultChannel('main', 1);
  mainLR.name = 'Main LR';
  mainLR.fader = 0;
  mainLR.color = '#ffffff';

  return {
    connected: false,
    host: '',
    model: 'X32 (Demo)',
    channels,
    buses,
    auxInputs: [],
    fxReturns: Array.from({ length: 8 }, (_, i) => {
      const fx = createDefaultChannel('fx-return', i + 1);
      fx.name = `FxRtn ${i + 1}`;
      return fx;
    }),
    matrices: Array.from({ length: 6 }, (_, i) => {
      const m = createDefaultChannel('matrix', i + 1);
      m.name = `Mtx ${i + 1}`;
      return m;
    }),
    dcas,
    mainLR,
    effects: DEMO_EFFECTS,
    scenes: Array.from({ length: 10 }, (_, i) => ({
      index: i, name: i === 0 ? 'Soundcheck' : i === 1 ? 'Show Start' : i === 2 ? 'Worship Set' : `Scene ${i}`,
      current: i === 1,
    })),
    soloActive: false,
    talkbackActive: false,
  };
}

export function useConsoleStore() {
  const [state, setState] = useState<ConsoleState>(createInitialState);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Simulate meter activity
  useEffect(() => {
    meterRef.current = setInterval(() => {
      setState(prev => ({
        ...prev,
        channels: prev.channels.map(ch => {
          if (ch.fader <= -89 || ch.muted) return { ...ch, meterLevel: -60, meterPeak: -60 };
          const base = ch.fader + 5;
          const level = base + (Math.random() - 0.5) * 12;
          const peak = Math.max(ch.meterPeak - 1.5, level + Math.random() * 3);
          const gr = ch.compEnabled ? Math.min(0, ch.compThreshold - level) * (1 - 1 / ch.compRatio) : 0;
          return { ...ch, meterLevel: Math.max(-60, level), meterPeak: Math.max(-60, peak), gainReduction: Math.max(-20, gr) };
        }),
        buses: prev.buses.map(b => {
          if (b.fader <= -89 || b.muted) return { ...b, meterLevel: -60, meterPeak: -60 };
          const level = b.fader + (Math.random() - 0.5) * 8;
          return { ...b, meterLevel: Math.max(-60, level), meterPeak: Math.max(-60, level + 2) };
        }),
        mainLR: prev.mainLR ? {
          ...prev.mainLR,
          meterLevel: Math.max(-60, prev.mainLR.fader + (Math.random() - 0.5) * 6),
          meterPeak: Math.max(-60, prev.mainLR.fader + Math.random() * 4),
        } : null,
      }));
    }, 80);
    return () => { if (meterRef.current) clearInterval(meterRef.current); };
  }, []);

  const setChannelParam = useCallback((type: ChannelType, index: number, param: string, value: any) => {
    setState(prev => {
      const listKey = type === 'input' ? 'channels' : type === 'bus' ? 'buses' : type === 'main' ? null : type === 'fx-return' ? 'fxReturns' : 'matrices';
      if (listKey === null && prev.mainLR) {
        return { ...prev, mainLR: { ...prev.mainLR, [param]: value } };
      }
      if (!listKey) return prev;
      return {
        ...prev,
        [listKey]: (prev[listKey as keyof ConsoleState] as ChannelState[]).map(ch =>
          ch.index === index ? { ...ch, [param]: value } : ch
        ),
      };
    });
  }, []);

  const setDCAParam = useCallback((index: number, param: string, value: any) => {
    setState(prev => ({
      ...prev,
      dcas: prev.dcas.map(d => d.index === index ? { ...d, [param]: value } : d),
    }));
  }, []);

  const setEQBand = useCallback((type: ChannelType, chIndex: number, bandIndex: number, param: string, value: number) => {
    setState(prev => {
      const listKey = type === 'input' ? 'channels' : type === 'bus' ? 'buses' : 'channels';
      return {
        ...prev,
        [listKey]: (prev[listKey] as ChannelState[]).map(ch =>
          ch.index === chIndex ? {
            ...ch,
            eqBands: ch.eqBands.map((b, i) => i === bandIndex ? { ...b, [param]: value } : b),
          } : ch
        ),
      };
    });
  }, []);

  const setSendLevel = useCallback((type: ChannelType, chIndex: number, busIndex: number, level: number) => {
    setState(prev => {
      const listKey = type === 'input' ? 'channels' : 'channels';
      return {
        ...prev,
        [listKey]: (prev[listKey] as ChannelState[]).map(ch =>
          ch.index === chIndex ? {
            ...ch,
            sends: ch.sends.map(s => s.busIndex === busIndex ? { ...s, level } : s),
          } : ch
        ),
      };
    });
  }, []);

  const recallScene = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => ({ ...s, current: s.index === index })),
    }));
  }, []);

  return {
    state,
    setChannelParam,
    setDCAParam,
    setEQBand,
    setSendLevel,
    recallScene,
  };
}
