/**
 * DCA/VCA group fader strip.
 */

import type { DCAState } from '@/types/console';
import Fader from './Fader';

interface DCAStripProps {
  dca: DCAState;
  onFaderChange: (value: number) => void;
  onMuteToggle: () => void;
}

export default function DCAStrip({ dca, onFaderChange, onMuteToggle }: DCAStripProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1 py-1.5 rounded border border-console-border/50 bg-console-strip"
      style={{ minWidth: 56 }}>
      <div className="text-[8px] text-console-dim">DCA {dca.index}</div>

      <Fader value={dca.fader} onChange={onFaderChange} height={140} color={dca.color} />

      <div className="text-[9px] font-medium text-console-text bg-console-bg px-1 py-0.5 rounded text-center w-full">
        {dca.fader <= -89 ? '-inf' : `${dca.fader >= 0 ? '+' : ''}${dca.fader.toFixed(1)}`}
      </div>

      <button
        className={`btn-mute w-full text-[9px] font-bold py-0.5 rounded border border-console-border ${dca.muted ? 'active' : 'bg-console-panel text-console-dim hover:text-console-mute'}`}
        onClick={onMuteToggle}
      >
        M
      </button>

      <div
        className="w-full text-center text-[9px] font-semibold truncate px-0.5 py-0.5 rounded"
        style={{ borderBottom: `2px solid ${dca.color}`, background: `${dca.color}15` }}
      >
        {dca.name}
      </div>
    </div>
  );
}
