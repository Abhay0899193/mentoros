import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { Overlay, Button, RegionBox } from '../../../ui';
import { cn } from '../../../lib/cn';
import { spring } from '../../../motion/springs';
import { coreClient } from '../../../lib/coreClient';
import type {
  AddFaceExpressionInput,
  AnimationClip,
  AvatarConfig,
  ExpressionGroupOrCustom,
  FaceCatalogEntry,
  FacePresetId,
  FaceRegion,
} from '../../../lib/coreClient';
import { useFaces } from '../../../lib/faceStore';

/**
 * GenerateExpressionDialog — add one new expression to a generated/custom
 * preset, or regenerate an existing clip's frame. Mirrors GeneratePresetWizard's
 * idioms at 1/4 scale: same catalog suggestions, same region marking, same
 * live job card. Regeneration always resubmits a custom spec (id/name/prompt/
 * group/region) — the service folds it back onto the same clip id via
 * replaceClipId regardless of whether the clip originated from the catalog.
 */

const CANVAS = 1024;
const PREVIEW = 340;

/** Mirrors core DEFAULT_REGIONS_1024's face window — seed for a fresh custom region. */
const SEED_REGION: FaceRegion = { x: 382, y: 197, width: 284, height: 350 };

/** Clip ids the pipeline owns — a custom expression can't take these. */
const RESERVED_IDS = new Set(['base', 'full', 'talk', 'blink', 'think', 'smile', 'annoyed', 'angry', 'surprised', 'laugh']);

function slugify(name: string, taken: Set<string>): string {
  let s =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'expression';
  if (RESERVED_IDS.has(s) || taken.has(s)) {
    let n = 2;
    while (taken.has(`${s}-${n}`) || RESERVED_IDS.has(`${s}-${n}`)) n += 1;
    s = `${s}-${n}`;
  }
  return s;
}

type TriggerChoice = 'manual' | 'idle' | 'thinking';

export function GenerateExpressionDialog({
  open,
  presetId,
  presetName,
  config,
  baseFrameUrl,
  replaceClip = null,
  onClose,
}: {
  open: boolean;
  presetId: FacePresetId;
  presetName: string;
  config: AvatarConfig;
  baseFrameUrl: string;
  replaceClip?: AnimationClip | null;
  onClose: () => void;
}) {
  const startAddExpression = useFaces((s) => s.addExpression);
  const job = useFaces((s) => s.job);
  const cancelJob = useFaces((s) => s.cancelJob);

  const regenerate = !!replaceClip;
  const method = config.generation?.method ?? 'kontext-photo';

  const [catalog, setCatalog] = useState<FaceCatalogEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [defaultPrompt, setDefaultPrompt] = useState('');

  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [group, setGroup] = useState<ExpressionGroupOrCustom>('face');
  const [region, setRegion] = useState<FaceRegion>(SEED_REGION);
  const [triggerChoice, setTriggerChoice] = useState<TriggerChoice>('manual');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);

  const usedClipIds = useMemo(() => new Set(config.animations.map((c) => c.id)), [config.animations]);

  /* ------------------------------- (re)seed -------------------------------- */
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmittedJobId(null);
    setTriggerChoice('manual');
    setSelectedKey(null);
    if (regenerate && replaceClip) {
      const meta = config.generation?.expressions.find((e) => e.clipId === replaceClip.id);
      setName(replaceClip.name);
      setPrompt(meta?.prompt ?? '');
      setGroup(meta?.group ?? 'face');
      setRegion(meta?.region ?? SEED_REGION);
    } else {
      setName('');
      setPrompt('');
      setGroup('face');
      setRegion(SEED_REGION);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, replaceClip?.id]);

  useEffect(() => {
    if (!open || regenerate) return;
    void coreClient
      .faceCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [open, regenerate]);

  /* ---------------------------- suggestion chips ---------------------------- */
  // Non-required catalog keys map 1:1 to their clip id (only m1/m2/m3/blink are
  // shared across a clip, and those are required — filtered out here).
  const suggestions = catalog.filter((e) => !e.required && !usedClipIds.has(e.key));

  const pickSuggestion = (entry: FaceCatalogEntry) => {
    setSelectedKey(entry.key);
    setDefaultPrompt(entry.prompt);
    setName(entry.name);
    setPrompt(entry.prompt);
    setGroup(entry.group);
    setRegion(SEED_REGION);
  };

  const onNameChange = (v: string) => {
    setName(v);
    setSelectedKey(null); // editing the name makes it a custom expression
  };
  const onGroupChange = (v: ExpressionGroupOrCustom) => {
    setGroup(v);
    setSelectedKey(null);
  };

  /* -------------------------------- validity -------------------------------- */
  const otherJobLive = !!job && ['queued', 'generating', 'compositing'].includes(job.state) && job.jobId !== submittedJobId;
  const nameValid = regenerate || name.trim().length > 0;
  const promptValid = prompt.trim().length > 0;
  const canSubmit = nameValid && promptValid && !otherJobLive;

  /* -------------------------------- submit ---------------------------------- */
  const buildInput = (): AddFaceExpressionInput | null => {
    if (!promptValid) return null;
    const input: AddFaceExpressionInput = {};
    let clipId: string;
    if (regenerate && replaceClip) {
      clipId = replaceClip.id;
      input.replaceClipId = replaceClip.id;
      input.id = replaceClip.id;
      input.name = replaceClip.name;
      input.prompt = prompt.trim();
      input.group = group;
      if (group === 'custom') input.region = region;
    } else if (selectedKey) {
      clipId = selectedKey;
      input.key = selectedKey;
      if (prompt.trim() !== defaultPrompt) input.prompt = prompt.trim();
    } else {
      if (!nameValid) return null;
      const taken = new Set(config.animations.map((c) => c.id));
      clipId = slugify(name.trim(), taken);
      input.id = clipId;
      input.name = name.trim();
      input.prompt = prompt.trim();
      input.group = group;
      if (group === 'custom') input.region = region;
    }
    if (!regenerate) {
      if (triggerChoice === 'idle') {
        input.trigger = { id: `${clipId}-auto`, animationId: clipId, kind: 'randomInterval', enabled: true, minMs: 8000, maxMs: 20000 };
      } else if (triggerChoice === 'thinking') {
        input.trigger = { id: `${clipId}-auto`, animationId: clipId, kind: 'conversationEvent', enabled: true, event: 'thinking' };
      }
      // 'manual' → send no trigger; the service attaches an equivalent manual trigger by default.
    }
    return input;
  };

  const submit = async () => {
    const input = buildInput();
    if (!input) return;
    setError(null);
    setSubmitting(true);
    const started = await startAddExpression(presetId, input);
    setSubmitting(false);
    if (started) setSubmittedJobId(started.jobId);
  };

  /* ------------------- track the submitted job to done -------------------- */
  const myJob = submittedJobId && job?.jobId === submittedJobId ? job : null;
  const myJobLive = !!myJob && ['queued', 'generating', 'compositing'].includes(myJob.state);

  useEffect(() => {
    if (!open || !myJob) return;
    if (myJob.state === 'done') onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, myJob?.state]);

  const scale = PREVIEW / CANVAS;

  return (
    <Overlay open={open} onClose={onClose} width={620} align="top">
      <div className="flex max-h-[84vh] flex-col gap-4 overflow-y-auto p-5">
        <header>
          <h2 className="text-h3 font-semibold text-ink">
            {regenerate ? `Regenerate ${replaceClip!.name}` : 'Generate an expression'}
          </h2>
          <p className="mt-0.5 text-small text-muted">
            {regenerate
              ? `One fresh frame for ${presetName} — its trigger and place in the clip list stay the same.`
              : method === 'z-turbo-t2i'
                ? `One new frame on ${presetName} — it reuses her character prompt and a fresh seed, so she stays herself.`
                : `One new frame on ${presetName}, via a Kontext edit of her base photo, so she stays herself.`}
          </p>
        </header>

        {!myJob && (
          <>
            {!regenerate && suggestions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-label font-medium uppercase tracking-wide text-muted">Suggestions</span>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((e) => (
                    <button
                      key={e.key}
                      onClick={() => pickSuggestion(e)}
                      aria-pressed={selectedKey === e.key}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium hairline',
                        selectedKey === e.key ? 'bg-surface-3 text-ink hairline-strong' : 'bg-surface-2 text-body hover:bg-surface-3',
                      )}
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Name</span>
              <input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Wink, Eye-roll, Nod…"
                maxLength={40}
                disabled={regenerate}
                aria-label="Expression name"
                className="h-9 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong disabled:opacity-60"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Prompt</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What is she doing? e.g. Winking her left eye with a playful smile, looking at the camera."
                rows={3}
                maxLength={2000}
                aria-label="Expression prompt"
                className="resize-none rounded-[10px] bg-surface-2 px-3 py-2.5 text-small leading-relaxed text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Region</span>
              <select
                value={group}
                onChange={(e) => onGroupChange(e.target.value as ExpressionGroupOrCustom)}
                aria-label="Expression region"
                className="h-9 w-52 rounded-[10px] bg-surface-2 px-2.5 text-small text-body outline-none hairline"
              >
                <option value="mouth">Mouth region</option>
                <option value="eyes">Eyes region</option>
                <option value="face">Whole face</option>
                <option value="custom">Custom region…</option>
              </select>
            </label>

            {group === 'custom' && (
              <div className="flex flex-wrap items-start justify-center gap-5">
                <div className="relative select-none overflow-hidden rounded-lg hairline" style={{ width: PREVIEW, height: PREVIEW }}>
                  <img src={baseFrameUrl} alt="Base portrait" draggable={false} className="h-full w-full" />
                  <RegionBox
                    label="Custom"
                    region={region}
                    scale={scale}
                    selected
                    onSelect={() => undefined}
                    onChange={setRegion}
                    imgW={CANVAS}
                    imgH={CANVAS}
                  />
                </div>
                <p className="min-w-[180px] flex-1 text-small text-muted">
                  Mark exactly what this expression changes — only what&apos;s inside the box gets pasted onto the base.
                </p>
              </div>
            )}

            {!regenerate && (
              <label className="flex flex-col gap-1.5">
                <span className="text-label font-medium uppercase tracking-wide text-muted">When should it play?</span>
                <select
                  value={triggerChoice}
                  onChange={(e) => setTriggerChoice(e.target.value as TriggerChoice)}
                  aria-label="Trigger"
                  className="h-9 w-64 rounded-[10px] bg-surface-2 px-2.5 text-small text-body outline-none hairline"
                >
                  <option value="manual">Manually</option>
                  <option value="idle">Randomly while idle</option>
                  <option value="thinking">When she&apos;s thinking</option>
                </select>
              </label>
            )}

            {otherJobLive && (
              <p className="text-small text-[var(--danger)]">Another generation is running — wait for it to finish first.</p>
            )}
          </>
        )}

        {myJob && (
          <div className="flex flex-col gap-2 rounded-[10px] bg-surface-2 p-3 hairline">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-small font-medium text-ink">{myJob.name}</span>
              {myJobLive && (
                <button onClick={() => void cancelJob()} className="shrink-0 text-[11px] text-muted hover:text-body">
                  Cancel
                </button>
              )}
            </div>
            {myJobLive ? (
              <>
                <span className="text-[11px] text-muted">{myJob.step}</span>
                <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'var(--aurora)' }}
                    animate={{ width: `${Math.max(4, (myJob.completedFrames / Math.max(1, myJob.totalFrames)) * 100)}%` }}
                    transition={spring.smooth}
                  />
                </div>
              </>
            ) : myJob.state === 'error' ? (
              <>
                <span className="text-[11px] text-[var(--danger)]">{myJob.error ?? 'Generation failed.'}</span>
                <span className="text-[11px] text-faint">Retrying picks up where it stopped.</span>
              </>
            ) : myJob.state === 'cancelled' ? (
              <span className="text-[11px] text-muted">Cancelled — Generate again resumes.</span>
            ) : null}
          </div>
        )}

        {error && <p className="text-small text-[var(--danger)]">{error}</p>}

        <footer className="flex items-center justify-between border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose}>
            {myJobLive ? 'Continue in background' : 'Cancel'}
          </Button>
          {!myJob || myJob.state === 'error' || myJob.state === 'cancelled' ? (
            <Button
              variant="primary"
              icon={<Sparkles size={14} strokeWidth={1.5} />}
              onClick={() => void submit()}
              loading={submitting}
              loadingLabel="Starting…"
              disabled={!canSubmit}
            >
              {myJob ? 'Generate again' : 'Generate'}
            </Button>
          ) : null}
        </footer>
      </div>
    </Overlay>
  );
}
