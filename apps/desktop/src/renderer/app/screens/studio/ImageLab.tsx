import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  Copy,
  ImagePlus,
  KeyRound,
  RefreshCw,
  Shuffle,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { Button, Chip, Switch } from '../../../ui';
import { cn } from '../../../lib/cn';
import { useImageLab } from '../../../lib/imageLabStore';
import type { ImageGenHistoryItem, ImageGenModelInfo } from '../../../lib/coreClient';

/**
 * ImageLab — text-to-image playground, the second view inside Avatar Studio.
 * Left: model + prompt + params. Right: output pane (live job or a history
 * pick) and the history strip. All calls go through imageLabStore, which
 * owns the single-flight job and its poll loop.
 */

const inputCls =
  'h-9 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong';

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: ImageGenModelInfo;
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

function FalKeyRow() {
  const falKeyState = useImageLab((s) => s.falKeyState);
  const falKeyMask = useImageLab((s) => s.falKeyMask);
  const falKeySaving = useImageLab((s) => s.falKeySaving);
  const saveFalKey = useImageLab((s) => s.saveFalKey);
  const clearFalKey = useImageLab((s) => s.clearFalKey);
  const [input, setInput] = useState('');

  async function handleSave() {
    const trimmed = input.trim();
    if (!trimmed || falKeySaving) return;
    const ok = await saveFalKey(trimmed);
    if (ok) setInput('');
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] bg-surface-2/60 p-3">
      <div className="flex items-center gap-2">
        <KeyRound size={14} strokeWidth={1.5} className="text-faint" />
        <span className="text-small font-medium text-ink">fal.ai API key</span>
        {falKeyState === 'valid' && <Chip tone="success">Valid</Chip>}
        {falKeyState === 'invalid' && <Chip tone="danger">Invalid</Chip>}
      </div>
      {falKeyState === 'valid' && falKeyMask ? (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-muted">{falKeyMask}</span>
          <button onClick={() => void clearFalKey()} className="text-[12px] font-medium text-faint hover:text-body">
            Clear
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
            placeholder="fal-…"
            className="h-9 flex-1 rounded-[10px] bg-surface-2 px-3 font-mono text-[12px] text-ink outline-none hairline focus:hairline-strong"
          />
          <Button size="sm" disabled={input.trim() === ''} loading={falKeySaving} loadingLabel="Saving…" onClick={() => void handleSave()}>
            Save
          </Button>
        </div>
      )}
      <p className="text-[12px] text-faint">Stored locally — used only to call fal.ai.</p>
    </div>
  );
}

function ReferenceDrop() {
  const referenceDataUri = useImageLab((s) => s.form.referenceDataUri);
  const setForm = useImageLab((s) => s.setForm);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setError('Use a JPEG, PNG or WebP photo.');
      return;
    }
    try {
      const uri = await fileToDataUri(file);
      setError(null);
      setForm({ referenceDataUri: uri });
    } catch {
      setError('Could not read that image.');
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label font-medium uppercase tracking-wide text-muted">Reference photo</span>
      <button
        aria-label="Choose reference photo"
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
          if (f) void pick(f);
        }}
        className={cn(
          'relative flex h-32 w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[10px] bg-surface-2 hairline transition-colors',
          over ? 'hairline-strong bg-surface-3' : 'hover:bg-surface-3',
          error && 'outline outline-2 outline-offset-2 outline-danger',
        )}
      >
        {referenceDataUri ? (
          <>
            <img src={referenceDataUri} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span
              role="button"
              aria-label="Remove reference photo"
              onClick={(e) => {
                e.stopPropagation();
                setForm({ referenceDataUri: undefined });
              }}
              className="tap-target absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-surface-1/85 text-muted hairline hover:text-ink"
            >
              <X size={12} strokeWidth={1.5} />
            </span>
          </>
        ) : (
          <>
            <ImagePlus size={20} strokeWidth={1.5} className="text-muted" />
            <span className="px-2 text-center text-small text-muted">Drop or click a photo to edit</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = '';
          }}
        />
      </button>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}

function IndeterminateBar() {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-surface-3">
      <motion.div
        className="h-full w-1/3 rounded-full"
        style={{ background: 'var(--aurora)' }}
        animate={{ x: ['-100%', '300%'] }}
        transition={{ duration: 1.3, ease: 'easeInOut', repeat: Infinity }}
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
  item: ImageGenHistoryItem;
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
      <button onClick={onSelect} aria-label={`View ${item.prompt}`} className="absolute inset-0">
        <img src={item.url} alt="" className="h-full w-full object-cover" />
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
          aria-label="Delete image"
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
          className="tap-target absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-1/85 text-muted opacity-0 coarse:opacity-100 transition-opacity hairline hover:text-danger group-hover:opacity-100"
        >
          <Trash2 size={11} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

export function ImageLab() {
  const init = useImageLab((s) => s.init);
  const models = useImageLab((s) => s.models);
  const modelsLoaded = useImageLab((s) => s.modelsLoaded);
  const form = useImageLab((s) => s.form);
  const setForm = useImageLab((s) => s.setForm);
  const selectModel = useImageLab((s) => s.selectModel);
  const job = useImageLab((s) => s.job);
  const starting = useImageLab((s) => s.starting);
  const generate = useImageLab((s) => s.generate);
  const cancel = useImageLab((s) => s.cancel);
  const dismissJob = useImageLab((s) => s.dismissJob);
  const history = useImageLab((s) => s.history);
  const historyLoaded = useImageLab((s) => s.historyLoaded);
  const viewingHistoryId = useImageLab((s) => s.viewingHistoryId);
  const viewHistory = useImageLab((s) => s.viewHistory);
  const reuseSettings = useImageLab((s) => s.reuseSettings);
  const reuseSeed = useImageLab((s) => s.reuseSeed);
  const deleteHistory = useImageLab((s) => s.deleteHistory);
  const falKeyState = useImageLab((s) => s.falKeyState);

  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    init();
  }, [init]);

  const selectedModel = models.find((m) => m.id === form.modelId);
  const jobLive = !!job && (job.state === 'queued' || job.state === 'running');
  const canGenerate =
    !!selectedModel &&
    selectedModel.available &&
    form.prompt.trim() !== '' &&
    !jobLive &&
    !starting &&
    (!selectedModel.requiresReference || !!form.referenceDataUri);

  const viewingHistory = viewingHistoryId ? history.find((h) => h.id === viewingHistoryId) : undefined;
  const liveResult = !viewingHistoryId && job?.state === 'done' ? job.result : undefined;
  const displayUrl = viewingHistory?.url ?? liveResult?.url;

  function copySeed(seed: number) {
    void navigator.clipboard.writeText(String(seed));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 md:flex-row md:flex-wrap">
      {/* --------------------------------- form --------------------------------- */}
      <div className="flex w-full flex-col gap-5 md:w-[360px] md:shrink-0">
        <section className="flex flex-col gap-2">
          <h2 className="text-label font-medium uppercase tracking-wide text-muted">Model</h2>
          {!modelsLoaded ? (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-[10px] bg-surface-2" />
              ))}
            </div>
          ) : models.length === 0 ? (
            <p className="rounded-[10px] bg-surface-1 px-3 py-4 text-center text-small text-faint hairline">
              No image models reported by core.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Model" className="flex flex-col gap-1.5">
              {models.map((m) => (
                <ModelOption key={m.id} model={m} selected={form.modelId === m.id} onSelect={() => selectModel(m.id)} />
              ))}
            </div>
          )}
        </section>

        {selectedModel?.id === 'z-image-turbo-fal' && falKeyState !== 'valid' && <FalKeyRow />}
        {selectedModel?.requiresReference && <ReferenceDrop />}

        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h2 className="text-label font-medium uppercase tracking-wide text-muted">Prompt</h2>
            <span className="text-[11px] text-faint">⌘Enter to generate</span>
          </div>
          <textarea
            ref={textareaRef}
            value={form.prompt}
            onChange={(e) => setForm({ prompt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (canGenerate) void generate();
              }
            }}
            rows={4}
            placeholder="Describe the image…"
            className="resize-none rounded-[10px] bg-surface-2 p-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
          />
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-label font-medium uppercase tracking-wide text-muted">Size &amp; steps</h2>
          <div className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2">
              <span className="w-12 shrink-0 text-[12px] text-muted">Width</span>
              <input
                type="number"
                min={512}
                max={2048}
                step={16}
                value={form.width}
                onChange={(e) => setForm({ width: Number(e.target.value) })}
                className={cn(inputCls, 'w-full')}
              />
            </label>
            <label className="flex flex-1 items-center gap-2">
              <span className="w-12 shrink-0 text-[12px] text-muted">Height</span>
              <input
                type="number"
                min={512}
                max={2048}
                step={16}
                value={form.height}
                onChange={(e) => setForm({ height: Number(e.target.value) })}
                className={cn(inputCls, 'w-full')}
              />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[12px] text-muted">Steps</span>
            <input
              type="number"
              min={1}
              max={selectedModel?.maxSteps ?? 50}
              value={form.steps}
              onChange={(e) =>
                setForm({ steps: Math.min(Number(e.target.value), selectedModel?.maxSteps ?? 50) })
              }
              className={cn(inputCls, 'w-24')}
            />
            {selectedModel && <span className="text-[11px] text-faint">max {selectedModel.maxSteps}</span>}
          </label>
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
              <span className="truncate text-small text-body">{job?.progressText ?? 'Starting…'}</span>
              <Button size="sm" variant="ghost" onClick={() => void cancel()}>
                Cancel
              </Button>
            </div>
            <IndeterminateBar />
          </div>
        ) : (
          <Button variant="primary" loading={starting} loadingLabel="Starting…" disabled={!canGenerate} onClick={() => void generate()} icon={<Wand2 size={14} strokeWidth={1.5} />}>
            Generate
          </Button>
        )}

        {job?.state === 'error' && (
          <div className="flex items-start gap-2 rounded-[10px] bg-danger/10 p-3 text-small text-danger">
            <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1">
              <span>{job.error === 'cancelled' ? 'Generation cancelled.' : (job.error ?? 'Generation failed.')}</span>
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
      <div className="flex min-w-0 flex-1 flex-col gap-4 md:min-w-[320px]">
        <section className="flex flex-col gap-2">
          <h2 className="text-label font-medium uppercase tracking-wide text-muted">Output</h2>
          <div className="flex aspect-square w-full max-w-[520px] items-center justify-center overflow-hidden rounded-[14px] bg-surface-1 hairline">
            {displayUrl ? (
              <img src={displayUrl} alt="" className="h-full w-full object-contain" />
            ) : jobLive ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <RefreshCw size={20} strokeWidth={1.5} className="animate-spin text-faint" />
                <span className="text-small text-muted">{job?.progressText ?? 'Generating…'}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 px-6 text-center">
                <ImagePlus size={22} strokeWidth={1.5} className="text-faint" />
                <span className="text-small text-faint">Nothing generated yet — describe an image and hit Generate.</span>
              </div>
            )}
          </div>

          {(viewingHistory || liveResult) && (
            <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-surface-1 px-3 py-2 hairline">
              <button
                onClick={() => copySeed((viewingHistory?.seed ?? liveResult?.seedUsed)!)}
                className="flex items-center gap-1 text-[12px] text-muted hover:text-body"
              >
                {copied ? <Check size={12} strokeWidth={1.5} className="text-success" /> : <Copy size={12} strokeWidth={1.5} />}
                Seed {viewingHistory?.seed ?? liveResult?.seedUsed}
              </button>
              <button
                onClick={() => reuseSeed((viewingHistory?.seed ?? liveResult?.seedUsed)!)}
                className="flex items-center gap-1 text-[12px] text-muted hover:text-body"
              >
                <Shuffle size={12} strokeWidth={1.5} />
                Reuse seed
              </button>
              <span className="text-[12px] text-faint">
                {viewingHistory?.modelId ?? form.modelId}
              </span>
              {liveResult && <span className="text-[12px] text-faint">{(liveResult.elapsedMs / 1000).toFixed(1)}s</span>}
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
              No generations yet — your finished images will collect here.
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
