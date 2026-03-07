/**
 * Scene/snapshot management panel.
 */

import type { SceneState } from '@/types/console';
import { Save, FolderOpen } from 'lucide-react';

interface ScenePanelProps {
  scenes: SceneState[];
  onRecall: (index: number) => void;
}

export default function ScenePanel({ scenes, onRecall }: ScenePanelProps) {
  return (
    <div className="bg-console-panel rounded-lg border border-console-border p-3">
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen size={14} className="text-console-accent" />
        <span className="text-xs font-semibold">Scenes</span>
      </div>

      <div className="space-y-1">
        {scenes.map(scene => (
          <button
            key={scene.index}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[10px] transition-all ${
              scene.current
                ? 'bg-console-accent/15 border border-console-accent text-console-accent'
                : 'bg-console-bg border border-console-border/30 text-console-text hover:border-console-border'
            }`}
            onClick={() => onRecall(scene.index)}
          >
            <span className="text-console-dim w-5">{scene.index}</span>
            <span className="flex-1 font-medium">{scene.name}</span>
            {scene.current && (
              <span className="text-[8px] bg-console-accent/20 px-1 rounded">CURRENT</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mt-2">
        <button className="flex-1 flex items-center justify-center gap-1 bg-console-bg border border-console-border/30 rounded py-1.5 text-[10px] text-console-dim hover:text-console-text hover:border-console-border">
          <Save size={10} /> Save
        </button>
      </div>
    </div>
  );
}
