/**
 * Effects rack panel — shows all FX slots with type and basic parameters.
 */

import type { EffectState } from '@/types/console';
import { Waves } from 'lucide-react';

interface EffectsPanelProps {
  effects: EffectState[];
}

const FX_TYPE_COLORS: Record<string, string> = {
  'Plate Reverb': '#aa44ff',
  'Hall Reverb': '#6644ff',
  'Room Reverb': '#4466ff',
  'Delay': '#00d4ff',
  'Chorus': '#00ff88',
  'Graphic EQ': '#ffd000',
  'Compressor': '#ff8800',
};

export default function EffectsPanel({ effects }: EffectsPanelProps) {
  return (
    <div className="bg-console-panel rounded-lg border border-console-border p-3">
      <div className="flex items-center gap-2 mb-3">
        <Waves size={14} className="text-console-accent" />
        <span className="text-xs font-semibold">Effects Rack</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {effects.map(fx => {
          const color = FX_TYPE_COLORS[fx.type] || '#888';
          return (
            <div key={fx.index} className="bg-console-bg rounded border border-console-border/30 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-console-dim">FX {fx.index}</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ backgroundColor: `${color}20`, color }}>
                  {fx.type}
                </span>
              </div>
              <div className="text-[10px] font-semibold mb-1.5" style={{ color }}>
                {fx.name}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(fx.params).slice(0, 4).map(([key, val]) => (
                  <div key={key} className="flex flex-col items-center">
                    <span className="text-[7px] text-console-dim uppercase">{key}</span>
                    <span className="text-[9px] text-console-text">{typeof val === 'number' ? val.toFixed(val < 10 ? 1 : 0) : val}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
