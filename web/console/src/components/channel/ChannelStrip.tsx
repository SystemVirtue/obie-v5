/**
 * Full channel strip — the core visual unit of the mixing console.
 * Includes: name, meter, fader, mute/solo, pan, gain readout.
 */

import type { ChannelState } from '@/types/console';
import Fader from './Fader';
import LevelMeter from '../meters/LevelMeter';

interface ChannelStripProps {
  channel: ChannelState;
  compact?: boolean;
  onFaderChange: (value: number) => void;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onPanChange: (value: number) => void;
  onSelect: () => void;
  selected?: boolean;
}

export default function ChannelStrip({
  channel, compact, onFaderChange, onMuteToggle, onSoloToggle, onPanChange, onSelect, selected,
}: ChannelStripProps) {
  const { name, color, fader, muted, solo, pan, meterLevel, meterPeak, gainReduction,
    phantom, hpf, compEnabled, gateEnabled, eqEnabled } = channel;

  const faderDb = fader <= -89 ? '-inf' : `${fader >= 0 ? '+' : ''}${fader.toFixed(1)}`;

  return (
    <div
      className={`
        flex flex-col items-center gap-0.5 px-1 py-1.5 rounded
        border transition-all cursor-pointer select-none
        ${selected ? 'border-console-accent bg-console-accent/5' : 'border-console-border/50 bg-console-strip hover:border-console-border'}
      `}
      style={{ minWidth: compact ? 52 : 62 }}
      onClick={onSelect}
    >
      {/* Channel number */}
      <div className="text-[8px] text-console-dim">{channel.index}</div>

      {/* Status indicators */}
      <div className="flex gap-0.5 mb-0.5">
        {phantom && <div className="w-1.5 h-1.5 rounded-full bg-red-500" title="48V" />}
        {hpf && <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" title="HPF" />}
        {gateEnabled && <div className="w-1.5 h-1.5 rounded-full bg-green-400" title="Gate" />}
        {compEnabled && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Comp" />}
        {eqEnabled && <div className="w-1.5 h-1.5 rounded-full bg-purple-400" title="EQ" />}
      </div>

      {/* Pan knob */}
      <div className="w-full px-0.5">
        <input
          type="range"
          className="knob-input w-full"
          min={-100}
          max={100}
          value={pan}
          onChange={e => onPanChange(parseInt(e.target.value))}
          onClick={e => e.stopPropagation()}
          title={`Pan: ${pan > 0 ? `R${pan}` : pan < 0 ? `L${Math.abs(pan)}` : 'C'}`}
        />
        <div className="text-[7px] text-center text-console-dim">
          {pan > 0 ? `R${pan}` : pan < 0 ? `L${Math.abs(pan)}` : 'C'}
        </div>
      </div>

      {/* Meter + Fader area */}
      <div className="flex gap-0.5 items-end" onClick={e => e.stopPropagation()}>
        <LevelMeter
          level={muted ? -60 : meterLevel}
          peak={muted ? -60 : meterPeak}
          gainReduction={gainReduction}
          width={6}
          height={compact ? 140 : 180}
        />
        <Fader
          value={fader}
          onChange={onFaderChange}
          height={compact ? 140 : 180}
          color={color}
        />
      </div>

      {/* dB readout */}
      <div className="text-[9px] font-medium text-console-text bg-console-bg px-1 py-0.5 rounded text-center w-full">
        {faderDb}
      </div>

      {/* Mute / Solo buttons */}
      <div className="flex gap-1 w-full">
        <button
          className={`btn-mute flex-1 text-[9px] font-bold py-0.5 rounded border border-console-border ${muted ? 'active' : 'bg-console-panel text-console-dim hover:text-console-mute'}`}
          onClick={e => { e.stopPropagation(); onMuteToggle(); }}
        >
          M
        </button>
        <button
          className={`btn-solo flex-1 text-[9px] font-bold py-0.5 rounded border border-console-border ${solo ? 'active' : 'bg-console-panel text-console-dim hover:text-console-solo'}`}
          onClick={e => { e.stopPropagation(); onSoloToggle(); }}
        >
          S
        </button>
      </div>

      {/* Channel name with color bar */}
      <div
        className="w-full text-center text-[9px] font-semibold truncate px-0.5 py-0.5 rounded"
        style={{ borderBottom: `2px solid ${color}`, background: `${color}15` }}
        title={name}
      >
        {name}
      </div>
    </div>
  );
}
