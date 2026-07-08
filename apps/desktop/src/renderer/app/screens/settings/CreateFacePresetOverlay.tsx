import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { Check, ImagePlus, RefreshCw, User, Wrench } from 'lucide-react';
import { Overlay, Button, Spinner } from '../../../ui';
import { useFaces } from '../../../lib/faceStore';
import { pathForFile } from '../../../lib/nativeBridge';
import { spring } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import type { FaceRegion } from '../../../lib/coreClient';

/**
 * CreateFacePresetOverlay — turn the user's own photos into a realistic
 * mentor preset. Three steps: pick photos (with the criteria that actually
 * decide quality), mark the mouth/eye composite windows, confirm + start the
 * background generation job. The heavy lifting (4 Kontext edits on the local
 * GPU, ~45-60 min) happens core-side; progress lives on the Identity card.
 */

interface Picked {
  /** Absolute path (native bridge) sent to core. */
  path: string;
  /** Object URL for preview. */
  url: string;
  width: number;
  height: number;
  name: string;
}

const MIN_SHORT_SIDE = 768;

/** The checklist is teaching posture: these are the criteria core cannot verify. */
const PORTRAIT_CRITERIA = [
  'Face straight-on, sharp and evenly lit',
  'Mouth closed, relaxed — all speech frames derive from it',
  'Eyes open; no sunglasses, hair or hands over the face',
];
const FULL_CRITERIA = ['Standing, head to shoes in frame', 'Front-facing, plain background'];

function usePickedImage() {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback((file: File) => {
    const path = pathForFile(file);
    if (!path) {
      setError('Photos can only be added from the desktop app.');
      return;
    }
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setError('Use a JPEG, PNG or WebP photo.');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPicked((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { path, url, width: img.naturalWidth, height: img.naturalHeight, name: file.name };
      });
      setError(
        Math.min(img.naturalWidth, img.naturalHeight) < MIN_SHORT_SIDE
          ? `Too small — at least ${MIN_SHORT_SIDE}px on the short side (this one is ${img.naturalWidth}×${img.naturalHeight}).`
          : null,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('Could not read that image.');
    };
    img.src = url;
  }, []);

  const clear = useCallback(() => {
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setError(null);
  }, []);

  return { picked, error, pick, clear };
}

function PhotoDrop({
  label,
  criteria,
  picked,
  error,
  onPick,
  onClear,
  optional,
}: {
  label: string;
  criteria: string[];
  picked: Picked | null;
  error: string | null;
  onPick: (f: File) => void;
  onClear: () => void;
  optional?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="flex gap-4">
      <button
        aria-label={`Choose ${label} photo`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onPick(f);
        }}
        className={cn(
          'relative flex h-32 w-28 shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-surface-2 hairline transition-colors',
          over ? 'hairline-strong bg-surface-3' : 'hover:bg-surface-3',
          error && 'outline outline-2 outline-offset-2 outline-[var(--danger)]',
        )}
      >
        {picked ? (
          <img src={picked.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <ImagePlus size={20} strokeWidth={1.5} className="text-muted" />
            <span className="px-2 text-center text-small text-muted">Drop or click</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = '';
          }}
        />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-small font-medium text-ink">{label}</span>
          {optional && <span className="text-label uppercase tracking-wide text-faint">Optional</span>}
          {picked && (
            <button onClick={onClear} className="ml-auto text-small text-muted hover:text-body">
              Remove
            </button>
          )}
        </div>
        <ul className="flex flex-col gap-0.5">
          {criteria.map((c) => (
            <li key={c} className="flex items-start gap-1.5 text-small text-muted">
              <Check size={13} strokeWidth={2} className="mt-1 shrink-0 text-faint" />
              {c}
            </li>
          ))}
        </ul>
        {picked && !error && (
          <span className="text-small text-faint">
            {picked.name} · {picked.width}×{picked.height}
          </span>
        )}
        {error && <span className="text-small text-[var(--danger)]">{error}</span>}
      </div>
    </div>
  );
}

/* ---------------- region picker ---------------- */

type RegionKey = 'mouth' | 'eyes';

function clampRegion(r: FaceRegion, w: number, h: number): FaceRegion {
  const width = Math.min(Math.max(40, r.width), w);
  const height = Math.min(Math.max(30, r.height), h);
  return {
    width,
    height,
    x: Math.min(Math.max(0, r.x), w - width),
    y: Math.min(Math.max(0, r.y), h - height),
  };
}

function RegionBox({
  label,
  region,
  scale,
  selected,
  onSelect,
  onChange,
  imgW,
  imgH,
}: {
  label: string;
  region: FaceRegion;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (r: FaceRegion) => void;
  imgW: number;
  imgH: number;
}) {
  // Pointer drags mutate a ref and commit through onChange each move so the
  // box tracks the cursor exactly (no spring — this is a measuring tool).
  const drag = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; start: FaceRegion } | null>(null);

  const onPointerDown = (mode: 'move' | 'resize') => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: region };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    onChange(
      clampRegion(
        d.mode === 'move'
          ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy }
          : { ...d.start, width: d.start.width + dx, height: d.start.height + dy },
        imgW,
        imgH,
      ),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = 8;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    onChange(
      clampRegion(
        e.shiftKey
          ? { ...region, width: region.width + d[0], height: region.height + d[1] }
          : { ...region, x: region.x + d[0], y: region.y + d[1] },
        imgW,
        imgH,
      ),
    );
  };

  return (
    <div
      role="slider"
      aria-label={`${label} region — arrows move, shift+arrows resize`}
      aria-valuetext={`${Math.round(region.x)},${Math.round(region.y)} ${Math.round(region.width)}×${Math.round(region.height)}`}
      tabIndex={0}
      onPointerDown={onPointerDown('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        'absolute cursor-move rounded-[4px] border focus:outline-none',
        selected
          ? 'border-[var(--iris)] shadow-[0_0_0_1px_var(--iris)]'
          : 'border-white/70 hover:border-white',
      )}
      style={{
        left: region.x * scale,
        top: region.y * scale,
        width: region.width * scale,
        height: region.height * scale,
      }}
    >
      <span className="absolute -top-5 left-0 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
        {label}
      </span>
      <div
        onPointerDown={onPointerDown('resize')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          'absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white/80',
          selected ? 'bg-[var(--iris)]' : 'bg-black/60',
        )}
      />
    </div>
  );
}

/* ---------------- the overlay ---------------- */

export function CreateFacePresetOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toolchain = useFaces((s) => s.toolchain);
  const refreshToolchain = useFaces((s) => s.refreshToolchain);
  const create = useFaces((s) => s.create);
  const creating = useFaces((s) => s.creating);
  const job = useFaces((s) => s.job);

  const [step, setStep] = useState<'photos' | 'regions' | 'confirm'>('photos');
  const [name, setName] = useState('');
  const [checkingTools, setCheckingTools] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const portrait = usePickedImage();
  const full = usePickedImage();
  const [mouth, setMouth] = useState<FaceRegion | null>(null);
  const [eyes, setEyes] = useState<FaceRegion | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<RegionKey>('mouth');

  useEffect(() => {
    if (!open) return;
    setCheckingTools(true);
    void refreshToolchain().finally(() => setCheckingTools(false));
  }, [open, refreshToolchain]);

  // Seed sensible default regions once the portrait's dimensions are known.
  useEffect(() => {
    const p = portrait.picked;
    if (!p) {
      setMouth(null);
      setEyes(null);
      return;
    }
    setMouth({ x: p.width * 0.38, y: p.height * 0.55, width: p.width * 0.24, height: p.height * 0.12 });
    setEyes({ x: p.width * 0.28, y: p.height * 0.34, width: p.width * 0.44, height: p.height * 0.12 });
  }, [portrait.picked]);

  const dirty = name.trim().length > 0 || !!portrait.picked || !!full.picked;
  const closeAndReset = useCallback(() => {
    setConfirmDiscard(false);
    setStep('photos');
    setName('');
    portrait.clear();
    full.clear();
    onClose();
  }, [onClose, portrait, full]);
  const requestClose = useCallback(() => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    closeAndReset();
  }, [dirty, confirmDiscard, closeAndReset]);

  const jobLive = job && ['queued', 'generating', 'compositing'].includes(job.state);
  const photosReady = name.trim().length >= 1 && name.trim().length <= 60 && portrait.picked && !portrait.error && !full.error;

  // Region-picker display maths: fit inside 560×420.
  const display = useMemo(() => {
    const p = portrait.picked;
    if (!p) return null;
    const scale = Math.min(560 / p.width, 420 / p.height, 1);
    return { scale, w: p.width * scale, h: p.height * scale };
  }, [portrait.picked]);

  const startGeneration = async () => {
    const p = portrait.picked;
    if (!p || !mouth || !eyes) return;
    const round = (r: FaceRegion): FaceRegion => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    });
    const ok = await create({
      name: name.trim(),
      portraitPath: p.path,
      ...(full.picked ? { fullPath: full.picked.path } : {}),
      mouth: round(mouth),
      eyes: round(eyes),
    });
    // The job is running server-side now — nothing left to "discard", so skip the dirty gate.
    if (ok) closeAndReset();
  };

  return (
    <Overlay open={open} onClose={requestClose} width={640} align="center">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-h2 font-semibold text-ink">New face preset</h2>
          <span className="text-small text-muted">
            {step === 'photos' ? 'Step 1 of 3 — photos' : step === 'regions' ? 'Step 2 of 3 — mark mouth & eyes' : 'Step 3 of 3 — generate'}
          </span>
        </div>

        {checkingTools ? (
          <div className="flex items-center gap-2.5 py-8 text-small text-muted">
            <Spinner /> Checking the image toolchain…
          </div>
        ) : toolchain?.state !== 'ready' ? (
          <div className="flex flex-col items-start gap-2 rounded-lg bg-surface-2 p-4 hairline">
            <div className="flex items-center gap-2 text-body">
              <Wrench size={16} strokeWidth={1.5} className="text-muted" />
              <span className="font-medium text-ink">Image toolchain unavailable</span>
            </div>
            <p className="text-small text-muted">
              {toolchain?.detail ??
                'Preset generation uses the local mflux toolchain at ~/mentoros-imagegen, which looks absent or incomplete.'}
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setCheckingTools(true);
                void refreshToolchain().finally(() => setCheckingTools(false));
              }}
            >
              <RefreshCw size={14} strokeWidth={1.5} /> Check again
            </Button>
          </div>
        ) : jobLive ? (
          <div className="flex flex-col gap-1.5 rounded-lg bg-surface-2 p-4 hairline">
            <span className="font-medium text-ink">A preset is already generating</span>
            <p className="text-small text-muted">
              “{job.name}” is using the GPU ({job.step}). One preset generates at a time — you can
              watch or cancel it from the gallery card.
            </p>
          </div>
        ) : step === 'photos' ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.gentle}
            className="flex flex-col gap-5"
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Name</span>
              <input
                autoFocus
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Maya"
                className="h-9 w-64 rounded-[10px] bg-surface-2 px-3 text-body text-ink outline-none hairline placeholder:text-faint focus:shadow-[var(--focus)]"
              />
            </label>
            <PhotoDrop
              label="Portrait"
              criteria={PORTRAIT_CRITERIA}
              picked={portrait.picked}
              error={portrait.error}
              onPick={portrait.pick}
              onClear={portrait.clear}
            />
            <PhotoDrop
              label="Full body"
              optional
              criteria={FULL_CRITERIA}
              picked={full.picked}
              error={full.error}
              onPick={full.pick}
              onClear={full.clear}
            />
            <p className="text-small text-faint">
              One great photo beats many — the portrait becomes the preset&apos;s resting frame and
              every speech frame derives from it.
            </p>
          </motion.div>
        ) : step === 'regions' && portrait.picked && display && mouth && eyes ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.gentle}
            className="flex flex-col items-center gap-3"
          >
            <div
              className="relative select-none overflow-hidden rounded-lg hairline"
              style={{ width: display.w, height: display.h }}
            >
              <img src={portrait.picked.url} alt="" draggable={false} className="h-full w-full" />
              <RegionBox
                label="Eyes"
                region={eyes}
                scale={display.scale}
                selected={selectedRegion === 'eyes'}
                onSelect={() => setSelectedRegion('eyes')}
                onChange={setEyes}
                imgW={portrait.picked.width}
                imgH={portrait.picked.height}
              />
              <RegionBox
                label="Mouth"
                region={mouth}
                scale={display.scale}
                selected={selectedRegion === 'mouth'}
                onSelect={() => setSelectedRegion('mouth')}
                onChange={setMouth}
                imgW={portrait.picked.width}
                imgH={portrait.picked.height}
              />
            </div>
            <p className="max-w-[520px] text-center text-small text-muted">
              Fit the boxes snugly: <span className="text-body">Mouth</span> covers the lips with a
              little margin, <span className="text-body">Eyes</span> spans both eyes including the
              lids. Speech and blinking are painted only inside these windows. Drag to move, corner
              to resize — or arrow keys, Shift+arrows to resize.
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.gentle}
            className="flex flex-col gap-4"
          >
            <div className="flex items-center gap-4 rounded-lg bg-surface-2 p-4 hairline">
              {portrait.picked && (
                <img src={portrait.picked.url} alt="" className="h-16 w-16 rounded-full object-cover" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">{name.trim()}</span>
                <span className="text-small text-muted">
                  Portrait{full.picked ? ' + full body' : ''} · mouth & eyes marked
                </span>
              </div>
              <User size={18} strokeWidth={1.5} className="ml-auto text-faint" />
            </div>
            <p className="text-small text-muted">
              Your GPU will run 4 identity-preserving edits to build the speech and blink frames —
              roughly <span className="text-body">45–60 minutes</span>. It runs in the background;
              keep using MentorOS. The finished preset appears in the gallery, and only one preset
              generates at a time.
            </p>
          </motion.div>
        )}

        {toolchain?.state === 'ready' && !jobLive && !checkingTools && (
          <div className="flex items-center justify-between border-t border-[var(--line)] pt-4">
            {confirmDiscard ? (
              <div className="flex items-center gap-2.5">
                <span className="text-small text-body">Discard this preset?</span>
                <Button variant="ghost" onClick={requestClose}>
                  Discard
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={step === 'photos' ? requestClose : () => setStep(step === 'confirm' ? 'regions' : 'photos')}>
                {step === 'photos' ? 'Cancel' : 'Back'}
              </Button>
            )}
            {!confirmDiscard &&
              (step === 'confirm' ? (
                <Button onClick={() => void startGeneration()} disabled={creating}>
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <Spinner className="size-3.5" /> Starting…
                    </span>
                  ) : (
                    'Generate preset'
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => setStep(step === 'photos' ? 'regions' : 'confirm')}
                  disabled={!photosReady}
                >
                  Continue
                </Button>
              ))}
          </div>
        )}
      </div>
    </Overlay>
  );
}
