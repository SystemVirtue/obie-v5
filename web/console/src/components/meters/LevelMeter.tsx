/**
 * Vertical LED-style level meter with peak hold.
 */

import { useMemo } from 'react';

interface LevelMeterProps {
  level: number;       // dB (-60 to +10)
  peak: number;        // dB
  width?: number;      // px
  height?: number;     // px
  showScale?: boolean;
  gainReduction?: number;
}

const SEGMENTS = 30;
const MIN_DB = -60;
const MAX_DB = 10;

function dbToPercent(db: number): number {
  return Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
}

function getSegmentColor(segIndex: number, totalSegments: number): string {
  const ratio = segIndex / totalSegments;
  if (ratio > 0.92) return '#ff2244'; // clip
  if (ratio > 0.83) return '#ff6600'; // orange
  if (ratio > 0.67) return '#ffd000'; // yellow
  return '#00ff88'; // green
}

export default function LevelMeter({ level, peak, width = 8, height = 180, showScale, gainReduction }: LevelMeterProps) {
  const activeSegments = Math.round(dbToPercent(level) * SEGMENTS);
  const peakSegment = Math.round(dbToPercent(peak) * SEGMENTS);
  const grSegments = gainReduction ? Math.round(dbToPercent(gainReduction) * 10) : 0;

  const segments = useMemo(() =>
    Array.from({ length: SEGMENTS }, (_, i) => i),
    []
  );

  const segHeight = (height - SEGMENTS + 1) / SEGMENTS;

  return (
    <div className="flex gap-0.5">
      {showScale && (
        <div className="flex flex-col justify-between text-[7px] text-console-dim pr-0.5" style={{ height }}>
          <span>+10</span>
          <span>0</span>
          <span>-10</span>
          <span>-20</span>
          <span>-40</span>
          <span>-60</span>
        </div>
      )}
      <div
        className="relative flex flex-col-reverse gap-px rounded-sm overflow-hidden"
        style={{ width, height }}
      >
        {segments.map(i => {
          const isActive = i < activeSegments;
          const isPeak = i === peakSegment - 1 && peak > MIN_DB + 5;
          const color = getSegmentColor(i, SEGMENTS);
          return (
            <div
              key={i}
              className="rounded-[1px] transition-opacity duration-75"
              style={{
                height: segHeight,
                backgroundColor: isActive || isPeak ? color : 'rgba(255,255,255,0.04)',
                opacity: isActive ? 1 : isPeak ? 0.9 : 0.3,
                boxShadow: isActive ? `0 0 4px ${color}40` : 'none',
              }}
            />
          );
        })}
      </div>
      {gainReduction !== undefined && gainReduction < -0.5 && (
        <div
          className="flex flex-col gap-px rounded-sm overflow-hidden"
          style={{ width: 4, height }}
        >
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="flex-1 rounded-[1px]"
              style={{
                backgroundColor: i < Math.abs(grSegments) ? '#ff8800' : 'rgba(255,255,255,0.04)',
                opacity: i < Math.abs(grSegments) ? 0.8 : 0.3,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
