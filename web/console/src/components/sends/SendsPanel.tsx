/**
 * Bus sends matrix panel — controls send levels from a channel to all buses.
 */

import type { ChannelState } from '@/types/console';

interface SendsPanelProps {
  channel: ChannelState;
  busNames: string[];
  onSendChange: (busIndex: number, level: number) => void;
}

export default function SendsPanel({ channel, busNames, onSendChange }: SendsPanelProps) {
  const { sends, name, color } = channel;

  function dbToDisplay(db: number): string {
    if (db <= -89) return '-inf';
    return `${db >= 0 ? '+' : ''}${db.toFixed(0)}`;
  }

  return (
    <div className="bg-console-panel rounded-lg border border-console-border p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold">{name} — Sends</span>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {sends.slice(0, 16).map((send, i) => {
          const level = send.level;
          const active = level > -89;
          return (
            <div key={i} className={`bg-console-bg rounded p-1.5 border ${active ? 'border-console-border' : 'border-console-border/30'}`}>
              <div className="text-[8px] text-console-dim text-center truncate mb-0.5">
                {busNames[i] || `Bus ${i + 1}`}
              </div>
              <input
                type="range"
                className="knob-input w-full"
                min={-90}
                max={10}
                step={1}
                value={level}
                onChange={e => onSendChange(i + 1, parseFloat(e.target.value))}
              />
              <div className={`text-[8px] text-center ${active ? 'text-console-text' : 'text-console-dim'}`}>
                {dbToDisplay(level)}
              </div>
              <div className="flex justify-center gap-1 mt-0.5">
                <button className={`text-[7px] px-1 rounded ${send.preFader ? 'bg-console-yellow/20 text-console-yellow' : 'text-console-dim'}`}>
                  PRE
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
