import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Clapperboard } from 'lucide-react';
import { Overlay, Button, toast } from '../../../ui';
import { cn } from '../../../lib/cn';
import { spring } from '../../../motion/springs';
import { useFaces } from '../../../lib/faceStore';
import { extractFrames, uniformIndices } from '../../../lib/videoFrames';
import type {
  AnimationClip,
  AnimationRegion,
  TriggerRule,
  VideoGenHistoryEntry,
} from '../../../lib/coreClient';

/**
 * VideoToClipDialog — "Use as avatar clip…" from the Video Lab output pane.
 * Samples the mp4's frames uniformly (all / ½ / ¼ / custom) into a sprite
 * gesture clip on a chosen custom preset. At full count 24fps reads as video;
 * the count control trades smoothness for the preset's frame budget.
 */

const RESERVED_IDS = new Set(['base', 'full', 'talk', 'blink', 'think', 'smile', 'annoyed', 'angry', 'surprised', 'laugh']);

/** Server caps (core/faces/config.ts) — mirrored so the dialog fails soft, not 422. */
const MAX_CLIP_FRAMES = 121;
const MAX_PRESET_FRAMES = 512;

function slugify(name: string, taken: Set<string>): string {
  let s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) s = 'clip';
  if (RESERVED_IDS.has(s) || taken.has(s)) {
    let n = 2;
    while (taken.has(`${s}-${n}`) || RESERVED_IDS.has(`${s}-${n}`)) n += 1;
    s = `${s}-${n}`;
  }
  return s;
}

/** Strip the served URL back to the bare art filename core stores. */
function relativizeFrame(src: string): string {
  if (src.startsWith('data:')) return src;
  const m = src.match(/\/faces\/art\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : (src.split('/').pop() ?? src);
}

type TriggerChoice = 'manual' | 'idle' | 'thinking';

export interface VideoToClipDialogProps {
  open: boolean;
  /** The video shown in the Video Lab output pane. */
  entry: VideoGenHistoryEntry | null;
  onClose: () => void;
}

export function VideoToClipDialog({ open, entry, onClose }: VideoToClipDialogProps) {
  const customs = useFaces((s) => s.customPresets);
  const saveConfig = useFaces((s) => s.saveConfig);

  const presets = useMemo(() => customs.filter((p) => p.custom && p.config), [customs]);

  const [presetId, setPresetId] = useState<string>('');
  const [name, setName] = useState('');
  const [view, setView] = useState<AnimationRegion>('portrait');
  const [pick, setPick] = useState(0);
  const [working, setWorking] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggerChoice, setTriggerChoice] = useState<TriggerChoice>('manual');

  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  const total = entry?.numFrames ?? 0;

  // Frame budget left on the chosen preset (server enforces the same cap).
  const usedFrames = useMemo(
    () => (preset?.config?.animations ?? []).reduce((n, c) => n + (c.frames?.length ?? 0), 0),
    [preset],
  );
  const budget = Math.max(0, MAX_PRESET_FRAMES - usedFrames);
  const maxPick = Math.min(total, MAX_CLIP_FRAMES, budget);

  useEffect(() => {
    if (!open || !entry) return;
    setName('');
    setError(null);
    setWorking(null);
    setTriggerChoice('manual');
    // Portrait-shaped videos default to the cameo region, tall ones to full body.
    setView(entry.height > entry.width ? 'full' : 'portrait');
    setPick(Math.min(entry.numFrames, MAX_CLIP_FRAMES));
  }, [open, entry]);

  // Re-clamp when the preset (and so its budget) changes.
  useEffect(() => {
    setPick((p) => Math.min(Math.max(2, p), Math.max(2, maxPick)));
  }, [maxPick]);

  if (!entry) return null;

  const durationSec = entry.fps > 0 ? entry.numFrames / entry.fps : 0;
  const sampled = uniformIndices(total, pick).length;
  const chips: { label: string; value: number }[] = [
    { label: `All (${Math.min(total, maxPick)})`, value: Math.min(total, maxPick) },
    { label: `½ (${Math.min(Math.ceil(total / 2), maxPick)})`, value: Math.min(Math.ceil(total / 2), maxPick) },
    { label: `¼ (${Math.min(Math.ceil(total / 4), maxPick)})`, value: Math.min(Math.ceil(total / 4), maxPick) },
  ];

  async function run() {
    if (!preset?.config || !entry) return;
    if (!name.trim()) {
      setError('Give the clip a name.');
      return;
    }
    setError(null);
    setWorking({ done: 0, total: sampled });
    try {
      const { dataUris, durationMs } = await extractFrames(entry.url, {
        totalFrames: entry.numFrames,
        fps: entry.fps,
        pick,
        onProgress: (done, t) => setWorking({ done, total: t }),
      });

      const config = preset.config;
      const taken = new Set(config.animations.map((c) => c.id));
      const clipId = slugify(name, taken);
      const clip: AnimationClip = {
        id: clipId,
        name: name.trim(),
        category: 'gesture',
        appliesTo: view,
        renderKind: 'sprite',
        track: 'main',
        frames: dataUris,
        driver: 'time',
        // durationMs keeps wall-clock speed exact at any sample count; fps is
        // the fallback if an edit ever drops the duration.
        durationMs: Math.min(60000, Math.max(30, durationMs)),
        fps: Math.min(60, Math.max(1, Math.round(dataUris.length / Math.max(0.1, durationMs / 1000)))),
        loopMode: 'once',
        priority: 30,
      };
      const trigger: TriggerRule =
        triggerChoice === 'idle'
          ? { id: `${clipId}-auto`, animationId: clipId, kind: 'randomInterval', enabled: true, minMs: 8000, maxMs: 20000 }
          : triggerChoice === 'thinking'
            ? { id: `${clipId}-auto`, animationId: clipId, kind: 'conversationEvent', enabled: true, event: 'thinking' }
            : { id: `${clipId}-manual`, animationId: clipId, kind: 'manual', enabled: true };

      const ok = await saveConfig(preset.id, {
        name: config.name,
        animations: [
          ...config.animations.map((c) => ({
            ...c,
            frames: c.frames?.map(relativizeFrame),
            thumbnail: undefined,
          })),
          clip,
        ],
        triggers: [...config.triggers, trigger],
        defaultAnimationId: config.defaultAnimationId,
      });
      setWorking(null);
      if (ok) {
        toast({
          tone: 'success',
          title: 'Motion clip added',
          description: `“${name.trim()}” now plays on ${preset.name}.`,
        });
        onClose();
      }
    } catch (e) {
      setWorking(null);
      setError(e instanceof Error ? e.message : 'Extraction failed.');
    }
  }

  return (
    <Overlay open={open} onClose={working ? () => undefined : onClose} width={560} align="top">
      <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-5">
        <header>
          <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink">
            <Clapperboard size={18} strokeWidth={1.5} className="text-faint" />
            Use as avatar clip
          </h2>
          <p className="mt-0.5 text-small text-muted">
            The video&apos;s frames become a gesture clip — full count plays as smoothly as the
            video itself; fewer frames are sampled uniformly across it.
          </p>
        </header>

        {presets.length === 0 ? (
          <p className="rounded-[10px] bg-surface-2 px-3 py-4 text-small text-muted hairline">
            No custom presets with an animation set yet — generate or create a preset first.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Preset</span>
              <select
                value={preset?.id ?? ''}
                onChange={(e) => setPresetId(e.target.value)}
                disabled={!!working}
                aria-label="Preset"
                className="h-9 w-64 rounded-[10px] bg-surface-2 px-2.5 text-small text-body outline-none hairline"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Clip name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Wave, Dance, Nod…"
                maxLength={60}
                disabled={!!working}
                className="h-9 w-64 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Plays on</span>
              <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label="Plays on" className="flex gap-1 rounded-[10px] bg-surface-2 p-1 hairline">
                  {(['portrait', 'full'] as const).map((opt) => (
                    <button
                      key={opt}
                      role="radio"
                      aria-checked={view === opt}
                      disabled={!!working}
                      onClick={() => setView(opt)}
                      className={cn(
                        'rounded-[8px] px-2.5 py-1 text-small capitalize',
                        view === opt ? 'bg-surface-3 text-ink hairline-strong' : 'text-muted hover:text-body',
                      )}
                    >
                      {opt === 'portrait' ? 'Portrait' : 'Full body'}
                    </button>
                  ))}
                </div>
                <span className="text-small text-faint">
                  {entry.width}×{entry.height} · {durationSec.toFixed(1)}s
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">
                Frames ({total} in the video)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {chips.map((c) => (
                  <button
                    key={c.label}
                    disabled={!!working || c.value < 2}
                    onClick={() => setPick(c.value)}
                    className={cn(
                      'rounded-full px-3 py-1 text-small hairline',
                      pick === c.value ? 'bg-surface-3 text-ink hairline-strong' : 'bg-surface-2 text-muted hover:text-body',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
                <input
                  type="number"
                  min={2}
                  max={Math.max(2, maxPick)}
                  value={pick}
                  disabled={!!working}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isInteger(v)) setPick(Math.min(Math.max(2, v), Math.max(2, maxPick)));
                  }}
                  aria-label="Frame count"
                  className="h-8 w-20 rounded-[10px] bg-surface-2 px-2.5 text-small text-ink outline-none hairline"
                />
              </div>
              <p className="text-small text-faint">
                Sampling is uniform — half keeps every other frame, a quarter every fourth. The
                clip always lasts {durationSec.toFixed(1)}s, lower counts just get choppier.
                {maxPick < Math.min(total, MAX_CLIP_FRAMES) && (
                  <> {preset?.name} has {budget} frames of budget left, so the count is capped there.</>
                )}
              </p>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">When should it play?</span>
              <select
                value={triggerChoice}
                onChange={(e) => setTriggerChoice(e.target.value as TriggerChoice)}
                disabled={!!working}
                aria-label="Trigger"
                className="h-9 w-64 rounded-[10px] bg-surface-2 px-2.5 text-small text-body outline-none hairline"
              >
                <option value="manual">Manually</option>
                <option value="idle">Randomly while idle</option>
                <option value="thinking">When she&apos;s thinking</option>
              </select>
            </label>

            {error && <p className="text-small text-[var(--danger)]">{error}</p>}

            {working && (
              <div className="flex flex-col gap-2 rounded-[10px] bg-surface-2 p-3 hairline">
                <span className="text-[11px] text-muted">
                  Extracting frame {working.done} of {working.total}…
                </span>
                <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'var(--aurora)' }}
                    animate={{ width: `${Math.max(4, (working.done / Math.max(1, working.total)) * 100)}%` }}
                    transition={spring.smooth}
                  />
                </div>
              </div>
            )}

            <footer className="mt-1 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={!!working} onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={!!working || maxPick < 2} onClick={() => void run()}>
                Add clip · {sampled} frames
              </Button>
            </footer>
          </>
        )}
      </div>
    </Overlay>
  );
}
