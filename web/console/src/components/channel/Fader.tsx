/**
 * Vertical fader control with dB markings.
 */

interface FaderProps {
  value: number;        // dB (-90 to +10)
  onChange: (value: number) => void;
  height?: number;
  color?: string;
}

const DB_MARKS = [10, 5, 0, -5, -10, -20, -30, -40, -60];

function dbToSlider(db: number): number {
  if (db <= -90) return 0;
  if (db >= 10) return 100;
  // Fader law: logarithmic-ish
  if (db >= 0) return 75 + (db / 10) * 25;
  if (db >= -10) return 50 + (db + 10) / 10 * 25;
  if (db >= -30) return 25 + (db + 30) / 20 * 25;
  return ((db + 90) / 60) * 25;
}

function sliderToDb(val: number): number {
  if (val <= 0) return -90;
  if (val >= 100) return 10;
  if (val >= 75) return (val - 75) / 25 * 10;
  if (val >= 50) return (val - 50) / 25 * 10 - 10;
  if (val >= 25) return (val - 25) / 25 * 20 - 30;
  return (val / 25) * 60 - 90;
}

export default function Fader({ value, onChange, height = 180, color }: FaderProps) {
  const sliderVal = dbToSlider(value);

  return (
    <div className="relative flex items-center gap-1" style={{ height }}>
      {/* dB Scale */}
      <div className="relative h-full w-5 flex-shrink-0">
        {DB_MARKS.map(db => {
          const pos = 100 - dbToSlider(db);
          return (
            <div
              key={db}
              className="absolute right-0 flex items-center"
              style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}
            >
              <span className="text-[7px] text-console-dim mr-0.5">
                {db > 0 ? `+${db}` : db}
              </span>
              <div className="w-1.5 h-px bg-console-border" />
            </div>
          );
        })}
      </div>

      {/* Fader track + thumb */}
      <div className="relative h-full flex items-center">
        {/* Track background with fill */}
        <div className="absolute left-1/2 -translate-x-1/2 w-1 h-full rounded bg-console-border overflow-hidden">
          <div
            className="absolute bottom-0 w-full rounded transition-all duration-75"
            style={{
              height: `${sliderVal}%`,
              background: `linear-gradient(to top, ${color || '#00d4ff'}40, ${color || '#00d4ff'}10)`,
            }}
          />
          {/* Unity (0dB) mark */}
          <div
            className="absolute w-full h-px bg-console-text opacity-30"
            style={{ bottom: `${dbToSlider(0)}%` }}
          />
        </div>

        <input
          type="range"
          className="fader-input"
          min={0}
          max={100}
          step={0.5}
          value={sliderVal}
          onChange={e => onChange(sliderToDb(parseFloat(e.target.value)))}
          style={{ height }}
        />
      </div>
    </div>
  );
}
