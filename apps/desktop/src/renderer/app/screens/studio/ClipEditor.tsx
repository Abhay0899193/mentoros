import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, X } from 'lucide-react';
import { Overlay, Button } from '../../../ui';
import { cn } from '../../../lib/cn';
import type { AnimationClip, AnimationRegion } from '../../../lib/coreClient';
import { cropToSquareWebp, decodeImageFile, revokeDecoded } from '../../../lib/imageTiles';
import { SheetSlicer } from './SheetSlicer';

/**
 * ClipEditor — create/edit one sprite clip of a custom preset. Frames accept
 * uploads (squared client-side) or sliced sheet tiles; existing frames keep
 * their art URLs (relativized on save by the screen). Procedural clips are
 * built-in-only, so the editor is sprite-only by design.
 */

const CATEGORIES = ['reaction', 'gesture', 'expression', 'idle'] as const;
const TRACKS = ['mouth', 'eyes', 'main'] as const;
const LOOPS = ['once', 'loop', 'pingpong', 'holdLast'] as const;

function slugify(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'clip';
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-label font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}

function Segments<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-surface-2 p-1 hairline">
      {options.map((opt) => (
        <button
          key={opt}
          role="radio"
          aria-checked={value === opt}
          onClick={() => onChange(opt)}
          className={cn(
            'h-7 rounded-full px-3 text-small capitalize',
            value === opt ? 'bg-surface-3 text-ink hairline-strong' : 'text-muted hover:text-body',
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export interface ClipEditorProps {
  open: boolean;
  /** Null = new clip. */
  clip: AnimationClip | null;
  /** Ids already used by the preset (uniqueness for new clips). */
  takenIds: string[];
  onSave: (clip: AnimationClip) => void;
  onClose: () => void;
}

export function ClipEditor({ open, clip, takenIds, onSave, onClose }: ClipEditorProps) {
  const editing = !!clip;
  const [name, setName] = useState(clip?.name ?? '');
  const [category, setCategory] = useState<string>(clip?.category ?? 'gesture');
  const [track, setTrack] = useState<string>(clip?.track ?? 'main');
  const [appliesTo, setAppliesTo] = useState<AnimationRegion>(clip?.appliesTo ?? 'portrait');
  const [driver, setDriver] = useState<'time' | 'envelope'>(clip?.driver ?? 'time');
  const [loopMode, setLoopMode] = useState<AnimationClip['loopMode']>(clip?.loopMode ?? 'once');
  const [fps, setFps] = useState(clip?.fps ?? 8);
  const [priority, setPriority] = useState(clip?.priority ?? 30);
  const [frames, setFrames] = useState<string[]>(clip?.frames ?? []);
  const [showSlicer, setShowSlicer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const taken = useMemo(() => new Set(takenIds.filter((id) => id !== clip?.id)), [takenIds, clip]);

  const addFiles = (files: FileList) => {
    setError(null);
    void Promise.all(
      [...files].map((f) =>
        decodeImageFile(f).then((d) => {
          const uri = cropToSquareWebp(d.img, 0, 0, d.width, d.height, 768);
          revokeDecoded(d);
          return uri;
        }),
      ),
    )
      .then((uris) => setFrames((prev) => [...prev, ...uris].slice(0, 64)))
      .catch((e: Error) => setError(e.message));
  };

  const move = (i: number, dir: -1 | 1) =>
    setFrames((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = () => {
    if (!name.trim()) {
      setError('Give the clip a name.');
      return;
    }
    if (frames.length === 0) {
      setError('A sprite clip needs at least one frame.');
      return;
    }
    const out: AnimationClip = {
      id: clip?.id ?? slugify(name, taken),
      name: name.trim(),
      category,
      appliesTo,
      renderKind: 'sprite',
      track,
      frames,
      driver,
      loopMode,
      priority: Math.round(priority),
    };
    if (driver === 'time') out.fps = fps;
    onSave(out);
  };

  return (
    <Overlay open={open} onClose={onClose} width={680} align="top">
      <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-5">
        <header>
          <h2 className="text-h3 font-semibold text-ink">{clip ? `Edit “${clip.name}”` : 'New animation clip'}</h2>
          <p className="mt-0.5 text-small text-muted">
            Frames overlay the base portrait in order — envelope clips follow the mentor's voice, timed clips play on triggers.
          </p>
        </header>

        <Row label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Wave, Nod, Wink…"
            maxLength={60}
            className="h-9 flex-1 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
          />
        </Row>
        <Row label="Category">
          <Segments options={CATEGORIES} value={category as (typeof CATEGORIES)[number]} onChange={setCategory} label="Category" />
        </Row>
        <Row label="Track">
          <div className="flex items-center gap-2">
            <Segments options={TRACKS} value={(TRACKS as readonly string[]).includes(track) ? (track as (typeof TRACKS)[number]) : 'main'} onChange={setTrack} label="Track" />
            <span className="text-small text-faint">mouth/eyes overlay the face; main takes the whole frame</span>
          </div>
        </Row>
        <Row label="Applies to">
          <Segments options={['portrait', 'full'] as const} value={appliesTo} onChange={setAppliesTo} label="Applies to" />
        </Row>
        <Row label="Driver">
          <div className="flex items-center gap-2">
            <Segments options={['time', 'envelope'] as const} value={driver} onChange={setDriver} label="Driver" />
            <span className="text-small text-faint">{driver === 'envelope' ? 'follows the voice level while she speaks' : 'plays through the frames'}</span>
          </div>
        </Row>
        {driver === 'time' && (
          <>
            <Row label="Loop">
              <Segments options={LOOPS} value={loopMode} onChange={setLoopMode} label="Loop mode" />
            </Row>
            <Row label="Speed">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={24}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  aria-label="Frames per second"
                  className="w-40 accent-[var(--iris)]"
                />
                <span className="text-small text-muted">{fps} fps</span>
              </div>
            </Row>
          </>
        )}
        <Row label="Priority">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              aria-label="Priority"
              className="h-9 w-20 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline focus:hairline-strong"
            />
            <span className="text-small text-faint">higher interrupts lower on the same track</span>
          </div>
        </Row>

        {/* frames strip */}
        <div className="flex flex-col gap-2">
          <span className="text-label font-medium uppercase tracking-wide text-muted">Frames ({frames.length})</span>
          <div className="flex flex-wrap gap-2">
            {frames.map((src, i) => (
              <div key={`${i}-${src.slice(-16)}`} className="group relative">
                <img src={src} alt={`Frame ${i + 1}`} className="h-16 w-16 rounded-[8px] object-cover hairline" />
                <span className="absolute left-1 top-1 rounded-full bg-surface-1/85 px-1.5 text-[10px] font-medium text-body">{i + 1}</span>
                <div className="absolute inset-x-0 bottom-0 flex justify-between rounded-b-[8px] bg-surface-1/85 opacity-0 transition-opacity group-hover:opacity-100">
                  <button aria-label={`Move frame ${i + 1} earlier`} onClick={() => move(i, -1)} className="p-0.5 text-muted hover:text-ink">
                    <ArrowLeft size={12} />
                  </button>
                  <button aria-label={`Remove frame ${i + 1}`} onClick={() => setFrames((p) => p.filter((_, k) => k !== i))} className="p-0.5 text-muted hover:text-[var(--danger)]">
                    <X size={12} />
                  </button>
                  <button aria-label={`Move frame ${i + 1} later`} onClick={() => move(i, 1)} className="p-0.5 text-muted hover:text-ink">
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-[8px] border border-dashed border-[var(--line-strong)] text-muted hover:bg-surface-2 hover:text-body"
            >
              <ImagePlus size={15} strokeWidth={1.5} />
              <span className="text-[10px]">Add</span>
            </button>
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
          <button onClick={() => setShowSlicer((v) => !v)} className="w-fit text-small text-muted underline-offset-2 hover:text-body hover:underline">
            {showSlicer ? 'Hide sheet slicer' : 'Slice frames from a sprite sheet…'}
          </button>
          {showSlicer && (
            <SheetSlicer
              onSlice={(tiles) => {
                setFrames((prev) => [...prev, ...tiles].slice(0, 64));
                setShowSlicer(false);
              }}
            />
          )}
        </div>

        {error && <p className="text-small text-[var(--danger)]">{error}</p>}
        <footer className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {editing ? 'Apply' : 'Add clip'}
          </Button>
        </footer>
      </div>
    </Overlay>
  );
}
