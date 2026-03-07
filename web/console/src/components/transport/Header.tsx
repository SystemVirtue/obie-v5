/**
 * Console header bar — connection status, model info, talkback, global controls.
 */

import { Wifi, WifiOff, Mic, Monitor, Settings, Layers } from 'lucide-react';

interface HeaderProps {
  connected: boolean;
  model: string;
  host: string;
  soloActive: boolean;
  talkbackActive: boolean;
  activeLayer: string;
  onLayerChange: (layer: string) => void;
}

const LAYERS = [
  { key: 'ch1-16', label: 'CH 1-16' },
  { key: 'ch17-32', label: 'CH 17-32' },
  { key: 'bus', label: 'BUS' },
  { key: 'fx-rtn', label: 'FX RTN' },
  { key: 'matrix', label: 'MATRIX' },
];

export default function Header({ connected, model, host, soloActive, talkbackActive, activeLayer, onLayerChange }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-1.5 bg-console-surface border-b border-console-border">
      {/* Left: Logo & Connection */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Monitor size={16} className="text-console-accent" />
          <span className="text-sm font-bold tracking-wider text-console-accent">MCP AUDIO CONSOLE</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {connected ? (
            <Wifi size={12} className="text-console-green" />
          ) : (
            <WifiOff size={12} className="text-console-red" />
          )}
          <span className={connected ? 'text-console-green' : 'text-console-dim'}>
            {connected ? `${model} @ ${host}` : `${model} — Demo Mode`}
          </span>
        </div>
      </div>

      {/* Center: Layer Selection */}
      <div className="flex items-center gap-1">
        <Layers size={12} className="text-console-dim mr-1" />
        {LAYERS.map(layer => (
          <button
            key={layer.key}
            className={`text-[10px] px-2.5 py-1 rounded font-bold transition-all ${
              activeLayer === layer.key
                ? 'bg-console-accent/20 text-console-accent border border-console-accent/50'
                : 'bg-console-bg text-console-dim border border-console-border/30 hover:text-console-text hover:border-console-border'
            }`}
            onClick={() => onLayerChange(layer.key)}
          >
            {layer.label}
          </button>
        ))}
      </div>

      {/* Right: Global Status */}
      <div className="flex items-center gap-3">
        {soloActive && (
          <div className="flex items-center gap-1 text-console-solo text-xs font-bold animate-pulse">
            <span>SOLO</span>
          </div>
        )}

        <button className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold border ${
          talkbackActive
            ? 'bg-red-600/30 text-red-400 border-red-600/50'
            : 'bg-console-bg text-console-dim border-console-border/30 hover:text-console-text'
        }`}>
          <Mic size={10} />
          TALK
        </button>

        <button className="text-console-dim hover:text-console-text">
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}
