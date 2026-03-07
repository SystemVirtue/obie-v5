/**
 * Gate and Compressor controls panel.
 */

import type { ChannelState } from '@/types/console';

interface DynamicsPanelProps {
  channel: ChannelState;
  onParamChange: (param: string, value: number | boolean) => void;
}

function Knob({ label, value, min, max, step, unit, onChange, color }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string;
  onChange: (v: number) => void; color?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <label className="text-[7px] text-console-dim uppercase">{label}</label>
      <input type="range" className="knob-input w-12"
        min={min} max={max} step={step || 1} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ accentColor: color }}
      />
      <div className="text-[8px] text-console-text">{typeof value === 'number' ? value.toFixed(step && step < 1 ? 1 : 0) : value}{unit}</div>
    </div>
  );
}

export default function DynamicsPanel({ channel, onParamChange }: DynamicsPanelProps) {
  const {
    gateEnabled, gateThreshold, gateRange, gateAttack, gateRelease,
    compEnabled, compThreshold, compRatio, compAttack, compRelease, compMakeup, compKnee,
    gainReduction, name, color,
  } = channel;

  return (
    <div className="bg-console-panel rounded-lg border border-console-border p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold">{name} — Dynamics</span>
      </div>

      {/* Gate Section */}
      <div className="bg-console-bg rounded border border-console-border/30 p-2 mb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-console-green">GATE</span>
          <button
            className={`text-[9px] px-2 py-0.5 rounded font-bold ${gateEnabled ? 'bg-console-green/20 text-console-green' : 'bg-console-surface text-console-dim'}`}
            onClick={() => onParamChange('gateEnabled', !gateEnabled)}
          >
            {gateEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="flex gap-2 justify-center">
          <Knob label="Thresh" value={gateThreshold} min={-80} max={0} unit="dB" color="#00ff88"
            onChange={v => onParamChange('gateThreshold', v)} />
          <Knob label="Range" value={gateRange} min={0} max={80} unit="dB" color="#00ff88"
            onChange={v => onParamChange('gateRange', v)} />
          <Knob label="Attack" value={gateAttack} min={0} max={120} step={0.5} unit="ms" color="#00ff88"
            onChange={v => onParamChange('gateAttack', v)} />
          <Knob label="Release" value={gateRelease} min={5} max={4000} unit="ms" color="#00ff88"
            onChange={v => onParamChange('gateRelease', v)} />
        </div>
      </div>

      {/* Compressor Section */}
      <div className="bg-console-bg rounded border border-console-border/30 p-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-console-accent">COMPRESSOR</span>
          <div className="flex items-center gap-2">
            {compEnabled && gainReduction < -0.5 && (
              <span className="text-[9px] text-console-orange font-bold">
                GR: {gainReduction.toFixed(1)} dB
              </span>
            )}
            <button
              className={`text-[9px] px-2 py-0.5 rounded font-bold ${compEnabled ? 'bg-console-accent/20 text-console-accent' : 'bg-console-surface text-console-dim'}`}
              onClick={() => onParamChange('compEnabled', !compEnabled)}
            >
              {compEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
        <div className="flex gap-2 justify-center flex-wrap">
          <Knob label="Thresh" value={compThreshold} min={-80} max={0} unit="dB" color="#00d4ff"
            onChange={v => onParamChange('compThreshold', v)} />
          <Knob label="Ratio" value={compRatio} min={1} max={20} step={0.1} unit=":1" color="#00d4ff"
            onChange={v => onParamChange('compRatio', v)} />
          <Knob label="Attack" value={compAttack} min={0} max={120} step={0.5} unit="ms" color="#00d4ff"
            onChange={v => onParamChange('compAttack', v)} />
          <Knob label="Release" value={compRelease} min={5} max={4000} unit="ms" color="#00d4ff"
            onChange={v => onParamChange('compRelease', v)} />
          <Knob label="Knee" value={compKnee} min={0} max={6} step={0.5} unit="dB" color="#00d4ff"
            onChange={v => onParamChange('compKnee', v)} />
          <Knob label="Makeup" value={compMakeup} min={-15} max={15} step={0.5} unit="dB" color="#00d4ff"
            onChange={v => onParamChange('compMakeup', v)} />
        </div>

        {/* Compression curve mini-display */}
        <div className="mt-2 flex justify-center">
          <svg width={80} height={60} className="bg-console-surface rounded">
            {/* 1:1 reference line */}
            <line x1={5} y1={55} x2={75} y2={5} stroke="#333" strokeWidth={0.5} />
            {/* Compression curve */}
            <path
              d={(() => {
                const pts: string[] = [];
                for (let x = 0; x <= 70; x += 2) {
                  const inputDb = (x / 70) * 80 - 80;
                  let outputDb: number;
                  if (inputDb <= compThreshold) {
                    outputDb = inputDb;
                  } else {
                    outputDb = compThreshold + (inputDb - compThreshold) / compRatio;
                  }
                  const px = 5 + (x / 70) * 70;
                  const py = 55 - ((outputDb + 80) / 80) * 50;
                  pts.push(`${px},${Math.max(5, Math.min(55, py))}`);
                }
                return `M ${pts.join(' L ')}`;
              })()}
              fill="none" stroke="#00d4ff" strokeWidth={1.5}
            />
            {/* Threshold indicator */}
            <line
              x1={5 + ((compThreshold + 80) / 80) * 70} y1={5}
              x2={5 + ((compThreshold + 80) / 80) * 70} y2={55}
              stroke="#ff880050" strokeWidth={0.5} strokeDasharray="2,2"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
