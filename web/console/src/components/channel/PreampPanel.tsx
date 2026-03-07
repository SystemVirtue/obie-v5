/**
 * Preamp / input controls panel: gain, phantom, phase, HPF.
 */

import type { ChannelState } from '@/types/console';

interface PreampPanelProps {
  channel: ChannelState;
  onParamChange: (param: string, value: number | boolean) => void;
}

export default function PreampPanel({ channel, onParamChange }: PreampPanelProps) {
  const { gain, phantom, phase, hpf, hpfFreq, name, color } = channel;

  return (
    <div className="bg-console-panel rounded-lg border border-console-border p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold">{name} — Input</span>
      </div>

      <div className="flex gap-3 items-end">
        {/* Gain Knob */}
        <div className="flex flex-col items-center">
          <label className="text-[8px] text-console-dim">GAIN</label>
          <input type="range" className="knob-input w-16"
            min={-12} max={60} step={0.5} value={gain}
            onChange={e => onParamChange('gain', parseFloat(e.target.value))} />
          <span className="text-[9px] text-console-text">{gain >= 0 ? '+' : ''}{gain.toFixed(1)} dB</span>
        </div>

        {/* Toggle buttons */}
        <div className="flex flex-col gap-1.5">
          <button
            className={`text-[9px] px-2 py-1 rounded font-bold border ${phantom ? 'bg-red-600/20 text-red-400 border-red-600/50' : 'bg-console-bg text-console-dim border-console-border/30'}`}
            onClick={() => onParamChange('phantom', !phantom)}
          >
            48V
          </button>
          <button
            className={`text-[9px] px-2 py-1 rounded font-bold border ${phase ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50' : 'bg-console-bg text-console-dim border-console-border/30'}`}
            onClick={() => onParamChange('phase', !phase)}
          >
            ⌀ Phase
          </button>
        </div>

        {/* HPF */}
        <div className="flex flex-col items-center">
          <button
            className={`text-[9px] px-2 py-0.5 rounded font-bold mb-1 ${hpf ? 'bg-console-yellow/20 text-console-yellow' : 'bg-console-bg text-console-dim'}`}
            onClick={() => onParamChange('hpf', !hpf)}
          >
            HPF
          </button>
          {hpf && (
            <>
              <input type="range" className="knob-input w-14"
                min={20} max={400} step={1} value={hpfFreq}
                onChange={e => onParamChange('hpfFreq', parseFloat(e.target.value))} />
              <span className="text-[9px] text-console-text">{hpfFreq} Hz</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
