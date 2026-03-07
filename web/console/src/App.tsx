/**
 * MCP Audio Console — Full admin control surface.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ HEADER: connection, layers, talkback, solo indicator        │
 *   ├────────────────────────────────────────┬─────────────────────┤
 *   │                                        │  SELECTED CHANNEL   │
 *   │  CHANNEL STRIPS (scrollable)           │  - Preamp/Input     │
 *   │  [1][2][3]...[16] | [DCA] | [MAIN]    │  - EQ (graphical)   │
 *   │                                        │  - Dynamics          │
 *   │                                        │  - Sends            │
 *   │                                        │  - Effects          │
 *   │                                        │  - Scenes           │
 *   └────────────────────────────────────────┴─────────────────────┘
 */

import { useState, useMemo } from 'react';
import { useConsoleStore } from '@/hooks/useConsoleStore';
import Header from '@/components/transport/Header';
import ChannelStrip from '@/components/channel/ChannelStrip';
import DCAStrip from '@/components/channel/DCAStrip';
import MainStrip from '@/components/channel/MainStrip';
import PreampPanel from '@/components/channel/PreampPanel';
import EQPanel from '@/components/eq/EQPanel';
import DynamicsPanel from '@/components/dynamics/DynamicsPanel';
import SendsPanel from '@/components/sends/SendsPanel';
import EffectsPanel from '@/components/effects/EffectsPanel';
import ScenePanel from '@/components/scenes/ScenePanel';

type Layer = 'ch1-16' | 'ch17-32' | 'bus' | 'fx-rtn' | 'matrix';
type DetailTab = 'preamp' | 'eq' | 'dynamics' | 'sends' | 'effects' | 'scenes';

export default function App() {
  const { state, setChannelParam, setDCAParam, setEQBand, setSendLevel, recallScene } = useConsoleStore();
  const [activeLayer, setActiveLayer] = useState<Layer>('ch1-16');
  const [selectedChannel, setSelectedChannel] = useState<{ type: string; index: number } | null>({ type: 'input', index: 1 });
  const [detailTab, setDetailTab] = useState<DetailTab>('eq');

  // Get channels for current layer
  const visibleChannels = useMemo(() => {
    switch (activeLayer) {
      case 'ch1-16': return state.channels.slice(0, 16);
      case 'ch17-32': return state.channels.slice(16, 32);
      case 'bus': return state.buses;
      case 'fx-rtn': return state.fxReturns;
      case 'matrix': return state.matrices;
      default: return state.channels.slice(0, 16);
    }
  }, [activeLayer, state.channels, state.buses, state.fxReturns, state.matrices]);

  const channelType = activeLayer === 'bus' ? 'bus' : activeLayer === 'fx-rtn' ? 'fx-return' : activeLayer === 'matrix' ? 'matrix' : 'input';

  // Find the selected channel object
  const selectedCh = useMemo(() => {
    if (!selectedChannel) return null;
    if (selectedChannel.type === 'input') return state.channels.find(c => c.index === selectedChannel.index) || null;
    if (selectedChannel.type === 'bus') return state.buses.find(c => c.index === selectedChannel.index) || null;
    return null;
  }, [selectedChannel, state.channels, state.buses]);

  const busNames = state.buses.map(b => b.name);

  const soloActive = state.channels.some(c => c.solo) || state.buses.some(b => b.solo);

  const DETAIL_TABS: { key: DetailTab; label: string }[] = [
    { key: 'preamp', label: 'INPUT' },
    { key: 'eq', label: 'EQ' },
    { key: 'dynamics', label: 'DYN' },
    { key: 'sends', label: 'SENDS' },
    { key: 'effects', label: 'FX' },
    { key: 'scenes', label: 'SCENES' },
  ];

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <Header
        connected={state.connected}
        model={state.model}
        host={state.host}
        soloActive={soloActive}
        talkbackActive={state.talkbackActive}
        activeLayer={activeLayer}
        onLayerChange={l => setActiveLayer(l as Layer)}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left: Channel Strips ────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-console-border">
          {/* Channel strip area */}
          <div className="flex-1 flex overflow-x-auto overflow-y-hidden p-2 gap-0.5">
            {/* Channel strips for current layer */}
            {visibleChannels.map(ch => (
              <ChannelStrip
                key={`${ch.type}-${ch.index}`}
                channel={ch}
                compact={visibleChannels.length > 12}
                selected={selectedChannel?.type === channelType && selectedChannel?.index === ch.index}
                onFaderChange={v => setChannelParam(channelType as any, ch.index, 'fader', v)}
                onMuteToggle={() => setChannelParam(channelType as any, ch.index, 'muted', !ch.muted)}
                onSoloToggle={() => setChannelParam(channelType as any, ch.index, 'solo', !ch.solo)}
                onPanChange={v => setChannelParam(channelType as any, ch.index, 'pan', v)}
                onSelect={() => setSelectedChannel({ type: channelType, index: ch.index })}
              />
            ))}

            {/* Divider */}
            <div className="w-px bg-console-border/50 mx-1 self-stretch flex-shrink-0" />

            {/* DCA strips */}
            {state.dcas.map(dca => (
              <DCAStrip
                key={`dca-${dca.index}`}
                dca={dca}
                onFaderChange={v => setDCAParam(dca.index, 'fader', v)}
                onMuteToggle={() => setDCAParam(dca.index, 'muted', !dca.muted)}
              />
            ))}

            {/* Divider */}
            <div className="w-px bg-console-border/50 mx-1 self-stretch flex-shrink-0" />

            {/* Main LR */}
            {state.mainLR && (
              <MainStrip
                channel={state.mainLR}
                onFaderChange={v => setChannelParam('main', 1, 'fader', v)}
                onMuteToggle={() => setChannelParam('main', 1, 'muted', !state.mainLR!.muted)}
              />
            )}
          </div>
        </div>

        {/* ── Right: Selected Channel Detail ──────────────────── */}
        <div className="w-[420px] flex-shrink-0 flex flex-col overflow-hidden bg-console-surface">
          {/* Detail tab bar */}
          <div className="flex border-b border-console-border">
            {DETAIL_TABS.map(tab => (
              <button
                key={tab.key}
                className={`flex-1 text-[10px] font-bold py-2 transition-all ${
                  detailTab === tab.key
                    ? 'text-console-accent border-b-2 border-console-accent bg-console-accent/5'
                    : 'text-console-dim hover:text-console-text'
                }`}
                onClick={() => setDetailTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Detail content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {selectedCh ? (
              <>
                {detailTab === 'preamp' && (
                  <PreampPanel
                    channel={selectedCh}
                    onParamChange={(param, value) => setChannelParam(selectedCh.type, selectedCh.index, param, value)}
                  />
                )}
                {detailTab === 'eq' && (
                  <EQPanel
                    channel={selectedCh}
                    onBandChange={(bandIdx, param, value) => setEQBand(selectedCh.type, selectedCh.index, bandIdx, param, value)}
                    onEQToggle={() => setChannelParam(selectedCh.type, selectedCh.index, 'eqEnabled', !selectedCh.eqEnabled)}
                  />
                )}
                {detailTab === 'dynamics' && (
                  <DynamicsPanel
                    channel={selectedCh}
                    onParamChange={(param, value) => setChannelParam(selectedCh.type, selectedCh.index, param, value)}
                  />
                )}
                {detailTab === 'sends' && (
                  <SendsPanel
                    channel={selectedCh}
                    busNames={busNames}
                    onSendChange={(busIdx, level) => setSendLevel(selectedCh.type, selectedCh.index, busIdx, level)}
                  />
                )}
                {detailTab === 'effects' && (
                  <EffectsPanel effects={state.effects} />
                )}
                {detailTab === 'scenes' && (
                  <ScenePanel scenes={state.scenes} onRecall={recallScene} />
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-console-dim text-sm">
                Select a channel to edit
              </div>
            )}
          </div>

          {/* Selected channel info bar */}
          {selectedCh && (
            <div
              className="px-3 py-2 border-t border-console-border flex items-center justify-between"
              style={{ borderTopColor: selectedCh.color }}
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: selectedCh.color }} />
                <span className="text-xs font-bold">{selectedCh.name}</span>
                <span className="text-[10px] text-console-dim">
                  {selectedCh.type} {selectedCh.index}
                </span>
              </div>
              <div className="flex gap-2 text-[9px]">
                {selectedCh.phantom && <span className="text-red-400">48V</span>}
                {selectedCh.hpf && <span className="text-yellow-400">HPF {selectedCh.hpfFreq}Hz</span>}
                {selectedCh.gateEnabled && <span className="text-green-400">GATE</span>}
                {selectedCh.compEnabled && <span className="text-blue-400">COMP</span>}
                {selectedCh.eqEnabled && <span className="text-purple-400">EQ</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
