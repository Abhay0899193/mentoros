import { useMemo, useRef, useState } from 'react';
import { Check, ImagePlus, X } from 'lucide-react';
import { Overlay, Button } from '../../../ui';
import { cn } from '../../../lib/cn';
import { useFaces } from '../../../lib/faceStore';
import type { AnimationClip, AvatarConfig, TriggerRule } from '../../../lib/coreClient';
import {
  cropToSquareWebp,
  decodeImageFile,
  revokeDecoded,
  sampleAccent,
  tileId,
  toWebpMaxEdge,
} from '../../../lib/imageTiles';
import { SheetSlicer } from './SheetSlicer';
import { StudioPreview } from './StudioPreview';
import type { AnimationController } from '../../../orb/animation/controller';

/**
 * CreateFromFramesWizard — build a preset from images you already have
 * (no GPU generation): collect frames (uploads or a sliced sprite sheet),
 * assign base / talk sequence / blink, then name it and watch it live before
 * creating. Produces the same blink/talk recipe the AI pipeline emits, so a
 * hand-made preset behaves exactly like a generated one.
 */

interface Tile {
  id: string;
  uri: string; // webp data URI
}

type Target = 'base' | 'talk' | 'blink';

const STEPS = ['Frames', 'Assign', 'Preview'] as const;

function loadDataUri(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = uri;
  });
}

export function CreateFromFramesWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (presetId: string) => void;
}) {
  const createManual = useFaces((s) => s.createManual);
  const [step, setStep] = useState(0);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [target, setTarget] = useState<Target>('base');
  const [baseId, setBaseId] = useState<string | null>(null);
  const [talkIds, setTalkIds] = useState<string[]>([]);
  const [blinkId, setBlinkId] = useState<string | null>(null);
  const [fullUri, setFullUri] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fullRef = useRef<HTMLInputElement>(null);
  const previewController = useRef<AnimationController | null>(null);

  const reset = () => {
    setStep(0);
    setTiles([]);
    setTarget('base');
    setBaseId(null);
    setTalkIds([]);
    setBlinkId(null);
    setFullUri(null);
    setName('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const addFiles = (files: FileList) => {
    setError(null);
    void Promise.all(
      [...files].map((f) =>
        decodeImageFile(f).then((d) => {
          const uri = cropToSquareWebp(d.img, 0, 0, d.width, d.height, 768);
          revokeDecoded(d);
          return { id: tileId(), uri };
        }),
      ),
    )
      .then((added) => setTiles((prev) => [...prev, ...added].slice(0, 64)))
      .catch((e: Error) => setError(e.message));
  };

  const removeTile = (id: string) => {
    setTiles((prev) => prev.filter((t) => t.id !== id));
    if (baseId === id) setBaseId(null);
    if (blinkId === id) setBlinkId(null);
    setTalkIds((prev) => prev.filter((t) => t !== id));
  };

  const assign = (id: string) => {
    if (target === 'base') setBaseId((prev) => (prev === id ? null : id));
    else if (target === 'blink') setBlinkId((prev) => (prev === id ? null : id));
    else setTalkIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const uriOf = (id: string | null) => tiles.find((t) => t.id === id)?.uri;

  /** In-memory config driving the live preview (identical to what we submit). */
  const draftConfig = useMemo<AvatarConfig | null>(() => {
    const base = uriOf(baseId);
    if (!base || talkIds.length === 0) return null;
    const animations: AnimationClip[] = [
      {
        id: 'talk',
        name: 'Talk',
        category: 'idle',
        appliesTo: 'portrait',
        renderKind: 'sprite',
        track: 'mouth',
        frames: talkIds.map((id) => uriOf(id)!).filter(Boolean),
        driver: 'envelope',
        loopMode: 'loop',
        priority: 20,
      },
    ];
    const triggers: TriggerRule[] = [];
    const blink = uriOf(blinkId);
    if (blink) {
      animations.push({
        id: 'blink',
        name: 'Blink',
        category: 'idle',
        appliesTo: 'portrait',
        renderKind: 'sprite',
        track: 'eyes',
        frames: [blink],
        driver: 'time',
        durationMs: 130,
        loopMode: 'once',
        priority: 10,
      });
      triggers.push({ id: 'blink-auto', animationId: 'blink', kind: 'randomInterval', minMs: 2400, maxMs: 5200, enabled: true });
    }
    const now = new Date().toISOString();
    const cfg: AvatarConfig = {
      schemaVersion: 1,
      presetId: 'draft',
      name: name || 'New preset',
      accent: '#8a8f98',
      baseFrame: base,
      animations,
      triggers,
      createdAt: now,
      updatedAt: now,
    };
    if (fullUri) cfg.fullBase = fullUri;
    return cfg;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, baseId, talkIds, blinkId, fullUri, name]);

  const create = async () => {
    if (!draftConfig) return;
    if (!name.trim()) {
      setError('Give the preset a name.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const baseImg = await loadDataUri(draftConfig.baseFrame);
      const preset = await createManual({
        name: name.trim(),
        accent: sampleAccent(baseImg),
        baseFrame: draftConfig.baseFrame,
        fullBase: fullUri ?? undefined,
        animations: draftConfig.animations,
        triggers: draftConfig.triggers,
      });
      if (preset) {
        onCreated(preset.id);
        close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the preset.');
    } finally {
      setCreating(false);
    }
  };

  const canNext = step === 0 ? tiles.length > 0 : step === 1 ? !!baseId && talkIds.length > 0 : false;

  const badgeFor = (id: string): string | null => {
    if (baseId === id) return 'Base';
    if (blinkId === id) return 'Blink';
    const i = talkIds.indexOf(id);
    if (i >= 0) return `Talk ${i + 1}`;
    return null;
  };

  return (
    <Overlay open={open} onClose={close} width={760} align="top">
      <div className="flex max-h-[84vh] flex-col gap-4 overflow-y-auto p-5">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-h3 font-semibold text-ink">Create from frames</h2>
            <p className="mt-0.5 text-small text-muted">
              Bring your own images — a sprite sheet or individual frames. All frames should share the same framing so overlays line up.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                  i === step ? 'bg-surface-3 text-ink hairline-strong' : i < step ? 'text-body' : 'text-faint',
                )}
              >
                {i + 1} · {s}
              </span>
            ))}
          </div>
        </header>

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <SheetSlicer onSlice={(sliced) => setTiles((prev) => [...prev, ...sliced.map((uri) => ({ id: tileId(), uri }))].slice(0, 64))} />
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-[var(--line)]" />
              <span className="text-small text-faint">or add individual images</span>
              <div className="h-px flex-1 bg-[var(--line)]" />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="flex flex-wrap gap-2">
              {tiles.map((t, i) => (
                <div key={t.id} className="group relative">
                  <img src={t.uri} alt={`Frame ${i + 1}`} className="h-20 w-20 rounded-[8px] object-cover hairline" />
                  <button
                    aria-label={`Remove frame ${i + 1}`}
                    onClick={() => removeTile(t.id)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-muted opacity-0 transition-opacity hairline hover:text-ink group-hover:opacity-100"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => fileRef.current?.click()}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-[8px] border border-dashed border-[var(--line-strong)] text-muted hover:bg-surface-2 hover:text-body"
              >
                <ImagePlus size={16} strokeWidth={1.5} />
                <span className="text-[10px]">Add images</span>
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div role="radiogroup" aria-label="Assignment target" className="inline-flex rounded-full bg-surface-2 p-1 hairline">
                {(
                  [
                    { id: 'base', label: 'Base (mouth closed)' },
                    { id: 'talk', label: 'Talk (closed → wide)' },
                    { id: 'blink', label: 'Blink (eyes shut)' },
                  ] as { id: Target; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    role="radio"
                    aria-checked={target === opt.id}
                    onClick={() => setTarget(opt.id)}
                    className={cn(
                      'h-7 rounded-full px-3 text-small',
                      target === opt.id ? 'bg-surface-3 text-ink hairline-strong' : 'text-muted hover:text-body',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="text-small text-faint">pick a role, then click frames</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {tiles.map((t, i) => {
                const badge = badgeFor(t.id);
                return (
                  <button key={t.id} onClick={() => assign(t.id)} aria-label={`Assign frame ${i + 1}`} className="group relative">
                    <img
                      src={t.uri}
                      alt=""
                      className={cn(
                        'h-20 w-20 rounded-[8px] object-cover hairline transition-shadow',
                        badge && 'outline outline-2 outline-offset-1 outline-[var(--iris)]',
                      )}
                    />
                    {badge && (
                      <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-surface-1/90 px-1.5 py-0.5 text-[10px] font-medium text-ink">
                        <Check size={9} strokeWidth={2.5} /> {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 rounded-[10px] bg-surface-2 p-2.5 hairline">
              <input
                ref={fullRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    void decodeImageFile(f)
                      .then((d) => {
                        setFullUri(toWebpMaxEdge(d.img));
                        revokeDecoded(d);
                      })
                      .catch((er: Error) => setError(er.message));
                  }
                  e.target.value = '';
                }}
              />
              {fullUri ? (
                <>
                  <img src={fullUri} alt="Full body" className="h-14 w-10 rounded-[6px] object-cover hairline" />
                  <span className="flex-1 text-small text-body">Full-body still added — the “Full body” view uses it.</span>
                  <button onClick={() => setFullUri(null)} className="text-small text-muted hover:text-body">
                    Remove
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-small text-muted">Optional: a full-body still for the “Full body” view.</span>
                  <Button size="sm" onClick={() => fullRef.current?.click()}>
                    Add full-body
                  </Button>
                </>
              )}
            </div>
            {!blinkId && <p className="text-small text-faint">No blink frame? Fine — she just won't blink.</p>}
          </div>
        )}

        {step === 2 && draftConfig && (
          <div className="flex flex-wrap items-start justify-center gap-6">
            <StudioPreview config={draftConfig} stylized={null} controllerRef={previewController} size={220} />
            <div className="flex min-w-[240px] flex-1 flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-label font-medium uppercase tracking-wide text-muted">Preset name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Maya, Coach, Pixel…"
                  maxLength={60}
                  autoFocus
                  className="h-9 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
                />
              </label>
              <p className="text-small text-muted">
                {talkIds.length} talk frame{talkIds.length === 1 ? '' : 's'}
                {blinkId ? ' · auto-blink every few seconds' : ''}
                {fullUri ? ' · full-body view' : ''}. Hit Speak to audition the lip-sync; you can add clips and triggers in the studio after.
              </p>
            </div>
          </div>
        )}

        {error && <p className="text-small text-[var(--danger)]">{error}</p>}

        <footer className="flex items-center justify-between border-t border-line pt-3">
          <Button variant="ghost" onClick={step === 0 ? close : () => setStep((s) => s - 1)}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < 2 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              {step === 1 && !canNext ? 'Assign a base + talk frames' : 'Continue'}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void create()} loading={creating} loadingLabel="Creating…">
              Create preset
            </Button>
          )}
        </footer>
      </div>
    </Overlay>
  );
}
