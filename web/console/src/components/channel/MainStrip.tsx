/**
 * Main LR output fader strip with stereo meters.
 */

import type { ChannelState } from '@/types/console';
import Fader from './Fader';
import LevelMeter from '../meters/LevelMeter';

interface MainStripProps {
  channel: ChannelState;
  onFaderChange: (value: number) => void;
  onMuteToggle: () => void;
}

export default function MainStrip({ channel, onFaderChange, onMuteToggle }: MainStripProps) {
  const { fader, muted, meterLevel, meterPeak } = channel;
  const faderDb = fader <= -89 ? '-inf' : `${fader >= 0 ? '+' : ''}${fader.toFixed(1)}`;

  return (
    <div className="flex flex-col items-center gap-1 px-2 py-2 rounded border-2 border-console-accent/30 bg-console-strip"
      style={{ minWidth: 80 }}>
      <div className="text-[10px] font-bold text-console-accent">MAIN</div>

      <div className="flex gap-1 items-end">
        <LevelMeter level={muted ? -60 : meterLevel} peak={muted ? -60 : meterPeak} width={8} height={200} showScale />
        <LevelMeter level={muted ? -60 : meterLevel + (Math.random() - 0.5) * 2} peak={muted ? -60 : meterPeak} width={8} height={200} />
        <div className="ml-1">
          <Fader value={fader} onChange={onFaderChange} height={200} color="#ffffff" />
        </div>
      </div>

      <div className="text-xs font-bold text-console-text bg-console-bg px-2 py-1 rounded text-center w-full">
        {faderDb}
      </div>

      <button
        className={`btn-mute w-full text-xs font-bold py-1 rounded border border-console-border ${muted ? 'active' : 'bg-console-panel text-console-dim hover:text-console-mute'}`}
        onClick={onMuteToggle}
      >
        MUTE
      </button>

      <div className="w-full text-center text-[10px] font-bold py-1 rounded"
        style={{ borderBottom: '2px solid #ffffff', background: 'rgba(255,255,255,0.05)' }}>
        LR
      </div>
    </div>
  );
}
