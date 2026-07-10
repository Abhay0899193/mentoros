import { useEffect, useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { cn } from '../../../lib/cn';
import type { AvatarConfig, FaceView } from '../../../lib/coreClient';
import type { OrbState } from '../../../orb/orbState';
import type { FacePreset } from '../../../orb/faces/presets';
import { FacePortrait } from '../../../orb/faces/FacePortrait';
import { SpritePortrait } from '../../../orb/animation/SpritePortrait';
import type { AnimationController } from '../../../orb/animation/controller';

/**
 * StudioPreview — the playback sandbox. Renders the selected preset through
 * the SAME components the app uses (SpritePortrait / FacePortrait) with a
 * studio-owned controllerRef so clip rows can inject playback directly.
 * "Speak" fakes a TTS envelope so lip-sync is auditionable without the voice
 * loop; the state row lets every OrbState expression be checked in place.
 */

const STATES: OrbState[] = ['idle', 'listening', 'thinking', 'speaking'];

export interface StudioPreviewProps {
  /** Sprite-family config, display-ready frames. Null for stylized presets. */
  config: AvatarConfig | null;
  /** Stylized preset (procedural SVG family). Null for sprite presets. */
  stylized: FacePreset | null;
  controllerRef: React.MutableRefObject<AnimationController | null>;
  size?: number;
  /** Freeze while a glass overlay covers this preview — an animating portrait
   * under backdrop-blur re-composites every frame and the whole panel shimmers. */
  frozen?: boolean;
}

export function StudioPreview({ config, stylized, controllerRef, size = 240, frozen = false }: StudioPreviewProps) {
  const [state, setState] = useState<OrbState>('idle');
  const [view, setView] = useState<FaceView>('cameo');
  const [speaking, setSpeaking] = useState(false);
  const levelRef = useRef(0);

  // Fake speech envelope: syllable-ish bursts while the Speak toggle is on.
  useEffect(() => {
    if (!speaking) {
      levelRef.current = 0;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const s = (t - t0) / 1000;
      const syllable = Math.max(0, Math.sin(s * 7.3)) * (0.55 + 0.45 * Math.sin(s * 1.7));
      levelRef.current = Math.min(1, syllable * (0.7 + 0.3 * Math.random()));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  const effectiveState: OrbState = speaking ? 'speaking' : state;
  const hasFull = !!config?.fullBase;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="flex items-center justify-center rounded-[14px] bg-surface-2 hairline"
        style={{ width: size + 32, height: size + 32 }}
      >
        {config ? (
          <SpritePortrait
            key={`${config.presetId}-${view}`}
            config={config}
            state={effectiveState}
            levelRef={levelRef}
            size={size}
            view={hasFull ? view : 'cameo'}
            frozen={frozen}
            reactive={false}
            controllerRef={controllerRef}
          />
        ) : stylized ? (
          <FacePortrait
            preset={stylized}
            glam="polished"
            maturity="balanced"
            state={effectiveState}
            levelRef={levelRef}
            size={size}
            frozen={frozen}
            reactive={false}
            controllerRef={controllerRef}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <div role="radiogroup" aria-label="Preview state" className="inline-flex rounded-full bg-surface-2 p-1 hairline">
          {STATES.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={state === s && !speaking}
              onClick={() => {
                setSpeaking(false);
                setState(s);
              }}
              className={cn(
                'h-7 rounded-full px-3 text-small capitalize',
                state === s && !speaking ? 'bg-surface-3 text-ink hairline-strong' : 'text-muted hover:text-body',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => setSpeaking((v) => !v)}
          aria-pressed={speaking}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-full px-3.5 text-small font-medium hairline',
            speaking ? 'bg-surface-3 text-ink hairline-strong' : 'bg-surface-2 text-muted hover:text-body',
          )}
        >
          <AudioLines size={14} strokeWidth={1.5} />
          {speaking ? 'Stop' : 'Speak'}
        </button>
        {hasFull && (
          <div role="radiogroup" aria-label="Preview view" className="inline-flex rounded-full bg-surface-2 p-1 hairline">
            {(['cameo', 'full'] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'h-7 rounded-full px-3 text-small capitalize',
                  view === v ? 'bg-surface-3 text-ink hairline-strong' : 'text-muted hover:text-body',
                )}
              >
                {v === 'cameo' ? 'Cameo' : 'Full body'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
