/**
 * Parametric EQ editor panel with visual frequency curve.
 */

import { useMemo } from 'react';
import type { ChannelState, EQBandState } from '@/types/console';

interface EQPanelProps {
  channel: ChannelState;
  onBandChange: (bandIndex: number, param: string, value: number) => void;
  onEQToggle: () => void;
}

const BAND_COLORS = ['#ff6644', '#ffd000', '#00d4ff', '#aa44ff'];
const BAND_LABELS = ['LOW', 'LO-MID', 'HI-MID', 'HIGH'];

function frequencyToX(freq: number, width: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return ((Math.log10(freq) - minLog) / (maxLog - minLog)) * width;
}

function generateEQCurve(bands: EQBandState[], width: number, height: number): string {
  const points: string[] = [];
  const midY = height / 2;
  const dbScale = height / 30; // -15 to +15 dB

  for (let x = 0; x <= width; x += 2) {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    const freq = Math.pow(10, minLog + (x / width) * (maxLog - minLog));

    let totalGain = 0;
    for (const band of bands) {
      if (!band.enabled) continue;
      const f0 = band.frequency;
      const octaves = Math.log2(freq / f0);
      const response = band.gain * Math.exp(-0.5 * Math.pow(octaves * band.q * 1.5, 2));
      totalGain += response;
    }

    const y = midY - totalGain * dbScale;
    points.push(`${x},${Math.max(0, Math.min(height, y))}`);
  }

  return `M ${points.join(' L ')}`;
}

export default function EQPanel({ channel, onBandChange, onEQToggle }: EQPanelProps) {
  const { eqBands, eqEnabled, name, color } = channel;
  const curveWidth = 400;
  const curveHeight = 120;

  const curvePath = useMemo(
    () => generateEQCurve(eqBands, curveWidth, curveHeight),
    [eqBands]
  );

  const freqLabels = [20, 50, 100, 200, 500, '1k', '2k', '5k', '10k', '20k'];

  return (
    <div className="bg-console-panel rounded-lg border border-console-border p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs font-semibold">{name} — EQ</span>
        </div>
        <button
          className={`text-[10px] px-2 py-0.5 rounded font-bold ${eqEnabled ? 'bg-console-green/20 text-console-green' : 'bg-console-bg text-console-dim'}`}
          onClick={onEQToggle}
        >
          {eqEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* EQ Curve Display */}
      <div className="relative bg-console-bg rounded border border-console-border/50 mb-3 panel-inset overflow-hidden">
        <svg width={curveWidth} height={curveHeight} className="w-full" viewBox={`0 0 ${curveWidth} ${curveHeight}`}>
          {/* Grid lines */}
          {[0, 6, -6, 12, -12].map(db => {
            const y = curveHeight / 2 - db * (curveHeight / 30);
            return (
              <line key={db} x1={0} y1={y} x2={curveWidth} y2={y}
                stroke={db === 0 ? '#333' : '#1a1a25'} strokeWidth={db === 0 ? 1 : 0.5} />
            );
          })}
          {freqLabels.map((label, i) => {
            const freq = typeof label === 'string' ? parseFloat(label) * 1000 : label;
            const x = frequencyToX(freq, curveWidth);
            return (
              <line key={i} x1={x} y1={0} x2={x} y2={curveHeight}
                stroke="#1a1a25" strokeWidth={0.5} />
            );
          })}

          {/* EQ curve */}
          <path d={curvePath} fill="none" stroke="#00d4ff" strokeWidth={2} opacity={eqEnabled ? 1 : 0.3} />
          <path d={`${curvePath} L ${curveWidth},${curveHeight / 2} L 0,${curveHeight / 2} Z`}
            fill="#00d4ff" opacity={eqEnabled ? 0.08 : 0.02} />

          {/* Band frequency markers */}
          {eqBands.map((band, i) => {
            const x = frequencyToX(band.frequency, curveWidth);
            const y = curveHeight / 2 - band.gain * (curveHeight / 30);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={5} fill={BAND_COLORS[i]} opacity={0.8} />
                <circle cx={x} cy={y} r={3} fill="white" opacity={0.6} />
              </g>
            );
          })}
        </svg>

        {/* Frequency labels */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1">
          {freqLabels.map((label, i) => (
            <span key={i} className="text-[7px] text-console-dim">{label}</span>
          ))}
        </div>
      </div>

      {/* Band Controls */}
      <div className="grid grid-cols-4 gap-2">
        {eqBands.map((band, i) => (
          <div key={i} className="bg-console-bg rounded p-1.5 border border-console-border/30">
            <div className="text-[8px] font-bold text-center mb-1" style={{ color: BAND_COLORS[i] }}>
              {BAND_LABELS[i]}
            </div>

            {/* Frequency */}
            <label className="text-[7px] text-console-dim block">FREQ</label>
            <input type="range" className="knob-input w-full"
              min={20} max={20000} value={band.frequency}
              onChange={e => onBandChange(i, 'frequency', parseFloat(e.target.value))}
              style={{ accentColor: BAND_COLORS[i] }}
            />
            <div className="text-[8px] text-center text-console-text">
              {band.frequency >= 1000 ? `${(band.frequency / 1000).toFixed(1)}k` : `${Math.round(band.frequency)}`}
            </div>

            {/* Gain */}
            <label className="text-[7px] text-console-dim block mt-1">GAIN</label>
            <input type="range" className="knob-input w-full"
              min={-15} max={15} step={0.5} value={band.gain}
              onChange={e => onBandChange(i, 'gain', parseFloat(e.target.value))}
            />
            <div className="text-[8px] text-center text-console-text">
              {band.gain > 0 ? '+' : ''}{band.gain.toFixed(1)} dB
            </div>

            {/* Q */}
            <label className="text-[7px] text-console-dim block mt-1">Q</label>
            <input type="range" className="knob-input w-full"
              min={0.3} max={16} step={0.1} value={band.q}
              onChange={e => onBandChange(i, 'q', parseFloat(e.target.value))}
            />
            <div className="text-[8px] text-center text-console-text">
              {band.q.toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
