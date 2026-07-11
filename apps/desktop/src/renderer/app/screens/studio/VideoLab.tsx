import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Film,
  ImagePlus,
  Images,
  Shuffle,
  Trash2,
  UserSquare,
  Video,
  X,
} from 'lucide-react';
import { Button, Chip, Switch } from '../../../ui';
import { cn } from '../../../lib/cn';
import { useVideoLab, estimateSeconds } from '../../../lib/videoLabStore';
import { useImageLab } from '../../../lib/imageLabStore';
import { useFaces } from '../../../lib/faceStore';
import { REALISTIC_PRESETS } from '../../../orb/faces/realistic';
import type { VideoGenHistoryEntry, VideoGenModelInfo } from '../../../lib/coreClient';

/**
 * VideoLab — text/image-to-video playground, the third view inside Avatar
 * Studio. Left: model + prompt + optional source frame + clip params. Right:
 * output pane (live job or a history pick) and the clip history. All calls go
 * through videoLabStore; progress streams over the `videogen.job` WS event.
 */

const inputCls =
  'h-9 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong';

const DURATION_PRESETS = [
  { label: '2 s', frames: 49 },
  { label: '3 s', frames: 73 },
  { label: '4 s', frames: 97 },
  { label: '5 s', frames: 121 },
];

const SIZE_PRESETS = [
  { label: 'Square 512', width: 512, height: 512 },
  { label: 'Portrait 512×768', width: 512, height: 768 },
  { label: 'Landscape 768×512', width: 768, height: 512 },
];

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

/** Pull a served/bundled image down to the data URI the generate route expects. */
async function urlToDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load that image.');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that image.'));
    reader.readAsDataURL(blob);
  });
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: VideoGenModelInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      disabled={!model.available}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-0.5 rounded-[10px] px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-surface-2 hairline-strong' : 'hairline hover:bg-surface-2',
        !model.available && 'opacity-55',
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full',
            selected ? 'text-iris' : 'text-transparent',
          )}
        >
          <Check size={12} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 truncate text-small font-medium text-ink">{model.label}</span>
        <Chip>{model.kind}</Chip>
      </span>
      <span className="pl-6 text-[12px] text-muted">{model.desc}</span>
      {model.detail && (
        <span className={cn('pl-6 text-[11px]', model.available ? 'text-faint' : 'text-danger')}>
          {model.detail}
        </span>
      )}
    </button>
  );
}

/**
 * Optional I2V source frame: drop/click a photo, or pull one from Image Lab
 * history / a face preset's base frame. Everything lands as a data URI.
 */
function SourceImageSection() {
  const imageDataUri = useVideoLab((s) => s.form.imageDataUri);
  const imageLabel = useVideoLab((s) => s.form.imageLabel);
  const setSourceImage = useVideoLab((s) => s.setSourceImage);
  const imageLabInit = useImageLab((s) => s.init);
  const renders = useImageLab((s) => s.history);
  const customPresets = useFaces((s) => s.customPresets);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<'renders' | 'presets' | null>(null);

  useEffect(() => {
    imageLabInit();
  }, [imageLabInit]);

  const presets = [...REALISTIC_PRESETS, ...customPresets];

  async function pickFile(file: File) {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setError('Use a JPEG, PNG or WebP photo.');
      return;
    }
    try {
      const uri = await fileToDataUri(file);
      setError(null);
      setPicker(null);
      setSourceImage(uri, file.name);
    } catch {
      setError('Could not read that image.');
    }
  }

  async function pickUrl(url: string, label: string) {
    try {
      const uri = await urlToDataUri(url);
      setError(null);
      setPicker(null);
      setSourceImage(uri, label);
    } catch {
      setError('Could not load that image.');
    }
  }

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h2 className="text-label font-medium uppercase tracking-wide text-muted">Source image</h2>
        <span className="text-[11px] text-faint">optional — animates the image</span>
      </div>
      <button
        aria-label="Choose source image"
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
          if (f) void pickFile(f);
        }}
        className={cn(
          'relative flex h-32 w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[10px] bg-surface-2 hairline transition-colors',
          over ? 'hairline-strong bg-surface-3' : 'hover:bg-surface-3',
          error && 'outline outline-2 outline-offset-2 outline-danger',
        )}
      >
        {imageDataUri ? (
          <>
            <img src={imageDataUri} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute bottom-1.5 left-1.5 max-w-[70%] truncate rounded-[6px] bg-surface-1/85 px-1.5 py-0.5 text-[10px] text-muted hairline">
              {imageLabel ?? 'Source frame'}
            </span>
            <span
              role="button"
              aria-label="Remove source image"
              onClick={(e) => {
                e.stopPropagation();
                setSourceImage(undefined);
              }}
              className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-surface-1/85 text-muted hairline hover:text-ink"
            >
              <X size={12} strokeWidth={1.5} />
            </span>
          </>
        ) : (
          <>
            <ImagePlus size={20} strokeWidth={1.5} className="text-muted" />
            <span className="px-2 text-center text-small text-muted">Drop or click a photo to animate</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = '';
          }}
        />
      </button>
      <div className="flex gap-2">
        <button
          onClick={() => setPicker(picker === 'renders' ? null : 'renders')}
          className={cn(
            'flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[12px] transition-colors hairline',
            picker === 'renders' ? 'bg-surface-2 text-ink hairline-strong' : 'text-muted hover:text-body',
          )}
        >
          <Images size={12} strokeWidth={1.5} />
          Image Lab render
        </button>
        <button
          onClick={() => setPicker(picker === 'presets' ? null : 'presets')}
          className={cn(
            'flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[12px] transition-colors hairline',
            picker === 'presets' ? 'bg-surface-2 text-ink hairline-strong' : 'text-muted hover:text-body',
          )}
        >
          <UserSquare size={12} strokeWidth={1.5} />
          Preset base frame
        </button>
      </div>
      {picker === 'renders' &&
        (renders.length === 0 ? (
          <p className="rounded-[10px] bg-surface-1 px-3 py-3 text-center text-[12px] text-faint hairline">
            No Image Lab renders yet — generate one in the Image Lab tab first.
          </p>
        ) : (
          <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto rounded-[10px] bg-surface-1 p-1.5 hairline">
            {renders.map((r) => (
              <button
                key={r.id}
                onClick={() => void pickUrl(r.url, 'Image Lab render')}
                aria-label={`Use render: ${r.prompt}`}
                className="aspect-square overflow-hidden rounded-[8px] bg-surface-2 hairline hover:hairline-strong"
              >
                <img src={r.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ))}
      {picker === 'presets' && (
        <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto rounded-[10px] bg-surface-1 p-1.5 hairline">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => void pickUrl(p.portrait.base, `${p.name} — base frame`)}
              aria-label={`Use ${p.name}'s base frame`}
              className="flex flex-col items-center gap-0.5 overflow-hidden rounded-[8px] p-1 hairline hover:hairline-strong"
            >
              <img src={p.portrait.base} alt="" className="aspect-square w-full rounded-[6px] object-cover" />
              <span className="w-full truncate text-center text-[10px] text-muted">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </section>
  );
}

function ProgressBar({ fraction }: { fraction: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-surface-3">
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ background: 'var(--aurora)', width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  );
}

function HistoryThumb({
  item,
  active,
  onSelect,
  onDelete,
}: {
  item: VideoGenHistoryEntry;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className={cn(
        'group relative aspect-square shrink-0 overflow-hidden rounded-[10px] bg-surface-2 hairline',
        active && 'hairline-strong outline outline-2 outline-offset-1 outline-iris/50',
      )}
    >
      <button onClick={onSelect} aria-label={`View clip: ${item.prompt}`} className="absolute inset-0">
        <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        <span className="absolute bottom-1 left-1 rounded-[6px] bg-surface-1/85 px-1 py-0.5 text-[10px] text-muted hairline">
          {Math.round(item.numFrames / item.fps)} s
        </span>
      </button>
      {confirming ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface-1/90 p-1.5">
          <span className="text-center text-[10px] text-body">Delete?</span>
          <div className="flex gap-1">
            <button
              onClick={() => setConfirming(false)}
              className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted hover:text-body"
            >
              Keep
            </button>
            <button
              onClick={onDelete}
              className="rounded-[6px] bg-danger/15 px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger/25"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button
          aria-label="Delete clip"
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
          className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-1/85 text-muted opacity-0 transition-opacity hairline hover:text-danger group-hover:opacity-100"
        >
          <Trash2 size={11} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

export function VideoLab() {
  const init = useVideoLab((s) => s.init);
  const models = useVideoLab((s) => s.models);
  const modelsLoaded = useVideoLab((s) => s.modelsLoaded);
  const form = useVideoLab((s) => s.form);
  const setForm = useVideoLab((s) => s.setForm);
  const job = useVideoLab((s) => s.job);
  const starting = useVideoLab((s) => s.starting);
  const generate = useVideoLab((s) => s.generate);
  const cancel = useVideoLab((s) => s.cancel);
  const dismissJob = useVideoLab((s) => s.dismissJob);
  const history = useVideoLab((s) => s.history);
  const historyLoaded = useVideoLab((s) => s.historyLoaded);
  const viewingHistoryId = useVideoLab((s) => s.viewingHistoryId);
  const viewHistory = useVideoLab((s) => s.viewHistory);
  const reuseSettings = useVideoLab((s) => s.reuseSettings);
  const reuseSeed = useVideoLab((s) => s.reuseSeed);
  const deleteHistory = useVideoLab((s) => s.deleteHistory);

  // Cross-busy: one GPU job at a time across faces / Image Lab / Video Lab.
  // The server 409s anyway — this just explains the disabled button.
  const faceJob = useFaces((s) => s.job);
  const imageJob = useImageLab((s) => s.job);
  const imageStarting = useImageLab((s) => s.starting);
  const facesBusy = !!faceJob && ['queued', 'generating', 'compositing'].includes(faceJob.state);
  const imagegenBusy = imageStarting || (!!imageJob && ['queued', 'running'].includes(imageJob.state));
  const crossBusy = facesBusy || imagegenBusy;

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  const selectedModel = models.find((m) => m.id === form.modelId);
  const jobLive = !!job && (job.state === 'queued' || job.state === 'running');
  const canGenerate =
    !!selectedModel && selectedModel.available && form.prompt.trim() !== '' && !jobLive && !starting && !crossBusy;

  const viewingHistory = viewingHistoryId ? history.find((h) => h.id === viewingHistoryId) : undefined;
  const liveResult = !viewingHistoryId && job?.state === 'done' ? job.result : undefined;
  const displayUrl = viewingHistory?.url ?? liveResult?.url;

  const estimate = estimateSeconds(form.width, form.height, form.numFrames);
  const clipSeconds = Math.round((form.numFrames / form.fps) * 10) / 10;

  function copySeed(seed: number) {
    void navigator.clipboard.writeText(String(seed));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-wrap gap-6 overflow-y-auto px-6 py-5">
      {/* --------------------------------- form --------------------------------- */}
      <div className="flex w-[360px] shrink-0 flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h2 className="text-label font-medium uppercase tracking-wide text-muted">Model</h2>
          {!modelsLoaded ? (
            <div className="h-14 animate-pulse rounded-[10px] bg-surface-2" />
          ) : models.length === 0 ? (
            <p className="rounded-[10px] bg-surface-1 px-3 py-4 text-center text-small text-faint hairline">
              No video models reported by core.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Model" className="flex flex-col gap-1.5">
              {models.map((m) => (
                <ModelOption
                  key={m.id}
                  model={m}
                  selected={form.modelId === m.id}
                  onSelect={() => setForm({ modelId: m.id, numFrames: m.defaultFrames, fps: m.defaultFps })}
                />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h2 className="text-label font-medium uppercase tracking-wide text-muted">Prompt</h2>
            <span className="text-[11px] text-faint">⌘Enter to generate</span>
          </div>
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ prompt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (canGenerate) void generate();
              }
            }}
            rows={4}
            placeholder="Describe the motion…"
            className="resize-none rounded-[10px] bg-surface-2 p-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
          />
        </section>

        {selectedModel?.supportsImageInput && <SourceImageSection />}

        <section className="flex flex-col gap-2.5">
          <h2 className="text-label font-medium uppercase tracking-wide text-muted">Clip</h2>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((d) => (
              <button
                key={d.frames}
                onClick={() => setForm({ numFrames: d.frames })}
                className={cn(
                  'rounded-full px-3 py-1 text-[12px] transition-colors hairline',
                  form.numFrames === d.frames ? 'bg-surface-3 text-ink hairline-strong' : 'text-muted hover:text-body',
                )}
              >
                {d.label}
              </button>
            ))}
            <span className="ml-auto self-center text-[11px] text-faint">
              {form.numFrames} frames @ {form.fps} fps
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SIZE_PRESETS.map((sz) => (
              <button
                key={sz.label}
                onClick={() => setForm({ width: sz.width, height: sz.height })}
                className={cn(
                  'rounded-full px-3 py-1 text-[12px] transition-colors hairline',
                  form.width === sz.width && form.height === sz.height
                    ? 'bg-surface-3 text-ink hairline-strong'
                    : 'text-muted hover:text-body',
                )}
              >
                {sz.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2">
              <span className="w-12 shrink-0 text-[12px] text-muted">Width</span>
              <input
                type="number"
                min={256}
                max={1024}
                step={64}
                value={form.width}
                onChange={(e) => setForm({ width: Number(e.target.value) })}
                className={cn(inputCls, 'w-full')}
              />
            </label>
            <label className="flex flex-1 items-center gap-2">
              <span className="w-12 shrink-0 text-[12px] text-muted">Height</span>
              <input
                type="number"
                min={256}
                max={1024}
                step={64}
                value={form.height}
                onChange={(e) => setForm({ height: Number(e.target.value) })}
                className={cn(inputCls, 'w-full')}
              />
            </label>
          </div>
          <p className="text-[11px] text-faint">
            ~{clipSeconds} s clip with audio · about {formatDuration(estimate)} to render locally.
          </p>
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-label font-medium uppercase tracking-wide text-muted">Seed</h2>
          <div className="flex items-center gap-3">
            <input
              type="number"
              disabled={form.randomizeSeed}
              value={form.seed ?? ''}
              placeholder="auto"
              onChange={(e) => setForm({ seed: e.target.value === '' ? null : Number(e.target.value) })}
              className={cn(inputCls, 'flex-1 disabled:opacity-50')}
            />
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <Switch
                checked={form.randomizeSeed}
                onChange={(v) => setForm({ randomizeSeed: v })}
                label="Randomize seed"
              />
              Randomize
            </span>
          </div>
        </section>

        {jobLive ? (
          <div className="flex flex-col gap-2 rounded-[10px] bg-surface-2 p-3 hairline">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-small text-body">
                {job?.detail ?? 'Starting…'}
                {job?.progress !== undefined && ` · ${Math.round(job.progress * 100)}%`}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void cancel()}>
                Cancel
              </Button>
            </div>
            <ProgressBar fraction={job?.progress ?? 0} />
            <p className="text-[11px] text-faint">Keep working — the clip renders in the background.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Button
              variant="primary"
              loading={starting}
              loadingLabel="Starting…"
              disabled={!canGenerate}
              onClick={() => void generate()}
              icon={<Video size={14} strokeWidth={1.5} />}
            >
              Generate video
            </Button>
            {crossBusy && (
              <p className="text-[11px] text-faint">
                {facesBusy ? 'A face preset is generating' : 'An Image Lab render is running'} — one generation at a
                time.
              </p>
            )}
          </div>
        )}

        {(job?.state === 'error' || job?.state === 'cancelled') && (
          <div className="flex items-start gap-2 rounded-[10px] bg-danger/10 p-3 text-small text-danger">
            <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1">
              <span>{job.state === 'cancelled' ? 'Generation cancelled.' : (job.error ?? 'Generation failed.')}</span>
              <div className="flex gap-2">
                <button onClick={() => void generate()} className="text-[12px] font-medium underline underline-offset-2">
                  Try again
                </button>
                <button onClick={dismissJob} className="text-[12px] font-medium text-faint underline underline-offset-2">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* -------------------------------- output --------------------------------- */}
      <div className="flex min-w-[320px] flex-1 flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h2 className="text-label font-medium uppercase tracking-wide text-muted">Output</h2>
          <div className="flex aspect-square w-full max-w-[520px] items-center justify-center overflow-hidden rounded-[14px] bg-surface-1 hairline">
            {displayUrl ? (
              <video
                key={displayUrl}
                src={displayUrl}
                controls
                loop
                playsInline
                className="h-full w-full object-contain"
              />
            ) : jobLive ? (
              <div className="flex w-full max-w-[300px] flex-col items-center gap-3 px-6 text-center">
                <Film size={20} strokeWidth={1.5} className="text-faint" />
                <div className="w-full">
                  <ProgressBar fraction={job?.progress ?? 0} />
                </div>
                <span className="text-small text-muted">{job?.detail ?? 'Generating…'}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 px-6 text-center">
                <Film size={22} strokeWidth={1.5} className="text-faint" />
                <span className="text-small text-faint">
                  Nothing rendered yet — describe the motion and hit Generate.
                </span>
              </div>
            )}
          </div>

          {(viewingHistory || liveResult) && (
            <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-surface-1 px-3 py-2 hairline">
              <button
                onClick={() => copySeed((viewingHistory?.seed ?? liveResult?.seedUsed)!)}
                className="flex items-center gap-1 text-[12px] text-muted hover:text-body"
              >
                {copied ? (
                  <Check size={12} strokeWidth={1.5} className="text-success" />
                ) : (
                  <Copy size={12} strokeWidth={1.5} />
                )}
                Seed {viewingHistory?.seed ?? liveResult?.seedUsed}
              </button>
              <button
                onClick={() => reuseSeed((viewingHistory?.seed ?? liveResult?.seedUsed)!)}
                className="flex items-center gap-1 text-[12px] text-muted hover:text-body"
              >
                <Shuffle size={12} strokeWidth={1.5} />
                Reuse seed
              </button>
              <span className="text-[12px] text-faint">{viewingHistory?.modelId ?? form.modelId}</span>
              {liveResult && (
                <span className="text-[12px] text-faint">{(liveResult.elapsedMs / 1000).toFixed(0)}s render</span>
              )}
              {viewingHistory && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => reuseSettings(viewingHistory)}>
                  Reuse settings
                </Button>
              )}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-label font-medium uppercase tracking-wide text-muted">History ({history.length})</h2>
          {!historyLoaded ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-[10px] bg-surface-2" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="rounded-[10px] bg-surface-1 px-3 py-4 text-center text-small text-faint hairline">
              No clips yet — your finished videos will collect here.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {history.map((item) => (
                <HistoryThumb
                  key={item.id}
                  item={item}
                  active={viewingHistoryId === item.id}
                  onSelect={() => viewHistory(item.id)}
                  onDelete={() => void deleteHistory(item.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
