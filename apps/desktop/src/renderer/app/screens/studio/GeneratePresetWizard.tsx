import { useEffect, useRef, useState } from 'react';
import { Check, Dices, Lock, Plus, Sparkles, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Overlay, Button, Switch, RegionBox } from '../../../ui';
import { cn } from '../../../lib/cn';
import { spring } from '../../../motion/springs';
import { coreClient } from '../../../lib/coreClient';
import type {
  ExpressionGroupOrCustom,
  FaceCatalogEntry,
  FaceRegion,
  GenerateExpressionSpec,
  GenerateFacePresetInput,
  ImageGenModelInfo,
} from '../../../lib/coreClient';
import { useFaces } from '../../../lib/faceStore';

/**
 * GeneratePresetWizard — build a fully-animated preset from a text description
 * (the productized Kiki recipe): describe a character and reroll candidates via
 * the local z-image-turbo backend, pick expressions from the proven catalog
 * (plus your own), let the pipeline auto-detect composite regions or mark them
 * by hand, then watch the batch job render every frame with anti-drift
 * compositing. Every frame reuses the candidate's seed, so identity holds.
 */

const MODEL_ID = 'z-image-turbo-local';
const CANVAS = 1024;
const PREVIEW = 340;

/** Mirrors core DEFAULT_REGIONS_1024 (kiki_regions.json) — manual-mode seeds. */
const SEED_REGIONS: { mouth: FaceRegion; eyes: FaceRegion; face: FaceRegion } = {
  mouth: { x: 464, y: 392, width: 132, height: 120 },
  eyes: { x: 393, y: 262, width: 250, height: 92 },
  face: { x: 382, y: 197, width: 284, height: 350 },
};

/** Clip ids the pipeline owns — a custom expression can't take these. */
const RESERVED_IDS = new Set(['base', 'full', 'talk', 'blink', 'think', 'smile', 'annoyed', 'angry', 'surprised', 'laugh']);

const STEPS = ['Describe', 'Expressions', 'Regions', 'Generate'] as const;

const PROMPT_PLACEHOLDER =
  'Portrait of a friendly young woman with warm brown eyes and dark shoulder-length hair, soft studio light, charcoal background…';

interface Candidate {
  historyId: string;
  url: string;
  seed: number;
}

interface CustomExpr {
  uid: number;
  name: string;
  prompt: string;
  group: ExpressionGroupOrCustom;
  region: FaceRegion;
}

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

function lastLine(text: string | undefined): string | null {
  const lines = (text ?? '').trim().split('\n');
  const line = lines[lines.length - 1]?.trim();
  return line || null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GeneratePresetWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (presetId: string) => void;
}) {
  const startGenerate = useFaces((s) => s.generate);
  const job = useFaces((s) => s.job);
  const cancelJob = useFaces((s) => s.cancelJob);

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /* ------------------------------ step 0 · describe ----------------------- */
  const [model, setModel] = useState<ImageGenModelInfo | null | undefined>(undefined);
  const [characterPrompt, setCharacterPrompt] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [rollProgress, setRollProgress] = useState<string | null>(null);
  const rollJobId = useRef<string | null>(null);
  const alive = useRef(true);

  /* ---------------------------- step 1 · expressions ---------------------- */
  const [catalog, setCatalog] = useState<FaceCatalogEntry[]>([]);
  const [emotions, setEmotions] = useState<Record<string, { on: boolean; prompt: string; defaultPrompt: string }>>({});
  const [customs, setCustoms] = useState<CustomExpr[]>([]);
  const customUid = useRef(1);

  /* ------------------------------ step 2 · regions ------------------------ */
  const [manualRegions, setManualRegions] = useState(false);
  const [mouth, setMouth] = useState<FaceRegion>(SEED_REGIONS.mouth);
  const [eyes, setEyes] = useState<FaceRegion>(SEED_REGIONS.eyes);
  const [face, setFace] = useState<FaceRegion>(SEED_REGIONS.face);
  const [selectedRegion, setSelectedRegion] = useState<string>('mouth');

  /* ------------------------------ step 3 · generate ----------------------- */
  const [name, setName] = useState('');
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setModel(undefined);
    void coreClient
      .imagegenModels()
      .then((ms) => setModel(ms.find((m) => m.id === MODEL_ID) ?? null))
      .catch(() => setModel(null));
    void coreClient
      .faceCatalog()
      .then((entries) => {
        setCatalog(entries);
        setEmotions((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          const next: typeof prev = {};
          for (const e of entries) {
            if (!e.required) next[e.key] = { on: true, prompt: e.prompt, defaultPrompt: e.prompt };
          }
          return next;
        });
      })
      .catch(() => setCatalog([]));
  }, [open]);

  const reset = () => {
    setStep(0);
    setError(null);
    setCharacterPrompt('');
    setCandidates([]);
    setPickedId(null);
    setRollProgress(null);
    setEmotions({});
    setCustoms([]);
    setManualRegions(false);
    setMouth(SEED_REGIONS.mouth);
    setEyes(SEED_REGIONS.eyes);
    setFace(SEED_REGIONS.face);
    setSelectedRegion('mouth');
    setName('');
    setSubmittedJobId(null);
  };

  const close = () => {
    if (rollJobId.current) void coreClient.imagegenCancel(rollJobId.current).catch(() => undefined);
    reset();
    onClose();
  };

  /* ------------------------- candidate reroll loop ------------------------ */
  const otherJobLive = !!job && ['queued', 'generating', 'compositing'].includes(job.state) && job.jobId !== submittedJobId;

  const rollCandidate = async () => {
    if (!characterPrompt.trim() || rolling) return;
    setRolling(true);
    setError(null);
    setRollProgress('Starting…');
    try {
      const { jobId } = await coreClient.imagegenGenerate({
        modelId: MODEL_ID,
        prompt: characterPrompt.trim(),
        width: CANVAS,
        height: CANVAS,
        steps: model?.defaultSteps ?? 8,
        randomizeSeed: true,
      });
      rollJobId.current = jobId;
      for (;;) {
        await sleep(700);
        if (!alive.current) return;
        const s = await coreClient.imagegenJob(jobId);
        if (!s) throw new Error('The generation went missing — try again.');
        if (s.state === 'done' && s.result) {
          const c: Candidate = { historyId: s.result.historyId, url: s.result.url, seed: s.result.seedUsed };
          setCandidates((prev) => [...prev, c]);
          setPickedId(c.historyId);
          break;
        }
        if (s.state === 'error') {
          if (s.error === 'cancelled') return;
          throw new Error(s.error ?? 'Generation failed.');
        }
        setRollProgress(lastLine(s.progressText) ?? 'Rendering…');
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      rollJobId.current = null;
      if (alive.current) {
        setRolling(false);
        setRollProgress(null);
      }
    }
  };

  const cancelRoll = () => {
    if (rollJobId.current) void coreClient.imagegenCancel(rollJobId.current).catch(() => undefined);
  };

  const picked = candidates.find((c) => c.historyId === pickedId) ?? null;

  /* ------------------------------ custom rows ----------------------------- */
  const addCustom = () => {
    setCustoms((prev) => [
      ...prev,
      { uid: customUid.current++, name: '', prompt: '', group: 'face', region: SEED_REGIONS.face },
    ]);
  };

  const patchCustom = (uid: number, patch: Partial<CustomExpr>) => {
    setCustoms((prev) => prev.map((c) => (c.uid === uid ? { ...c, ...patch } : c)));
  };

  const customsValid = customs.every((c) => c.name.trim().length > 0 && c.prompt.trim().length > 0);
  const emotionsOn = Object.entries(emotions).filter(([, v]) => v.on);
  const frameCount = 4 + emotionsOn.length + customs.length;

  /* -------------------------------- submit -------------------------------- */
  const buildInput = (): GenerateFacePresetInput | null => {
    if (!picked) return null;
    const taken = new Set<string>();
    const expressions: GenerateExpressionSpec[] = emotionsOn.map(([key, v]) => ({
      key,
      ...(v.prompt.trim() !== v.defaultPrompt ? { prompt: v.prompt.trim() } : {}),
    }));
    for (const c of customs) {
      const id = slugify(c.name.trim(), taken);
      taken.add(id);
      expressions.push({
        id,
        name: c.name.trim(),
        prompt: c.prompt.trim(),
        group: c.group,
        ...(c.group === 'custom' ? { region: c.region } : {}),
      });
    }
    return {
      name: name.trim(),
      characterPrompt: characterPrompt.trim(),
      expressions,
      ...(manualRegions ? { regions: { mouth, eyes, face } } : {}),
      baseHistoryId: picked.historyId,
      baseSeed: picked.seed,
    };
  };

  const submit = async () => {
    const input = buildInput();
    if (!input) return;
    if (!input.name) {
      setError('Give the preset a name.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const started = await startGenerate(input);
    setSubmitting(false);
    if (started) setSubmittedJobId(started.jobId);
  };

  /* ------------------- track the submitted job to done -------------------- */
  const myJob = submittedJobId && job?.jobId === submittedJobId ? job : null;
  const myJobLive = !!myJob && ['queued', 'generating', 'compositing'].includes(myJob.state);

  useEffect(() => {
    if (!open || !myJob) return;
    if (myJob.state === 'done') {
      onCreated(myJob.presetId);
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, myJob?.state]);

  /* ------------------------------- rendering ------------------------------ */
  const scale = PREVIEW / CANVAS;
  const customRegionRows = customs.filter((c) => c.group === 'custom');

  const canNext =
    step === 0
      ? !!picked && !rolling
      : step === 1
        ? customsValid && frameCount <= 20
        : step === 2
          ? true
          : false;

  return (
    <Overlay open={open} onClose={close} width={760} align="top">
      <div className="flex max-h-[84vh] flex-col gap-4 overflow-y-auto p-5">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-h3 font-semibold text-ink">Generate a preset</h2>
            <p className="mt-0.5 text-small text-muted">
              Describe a character once — every expression frame reuses the same seed, and only its mouth, eyes, or face is
              composited onto the base, so she stays herself.
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

        {/* ------------------------------ describe ----------------------------- */}
        {step === 0 && (
          <div className="flex flex-col gap-3">
            {model === null || (model && !model.available) ? (
              <div className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 p-4 hairline">
                <span className="text-small font-medium text-ink">Local image generation isn&apos;t ready</span>
                <p className="text-small text-muted">
                  {model?.detail ?? 'The z-image-turbo backend was not found. Set it up from Image Lab, then come back.'}
                </p>
              </div>
            ) : (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="text-label font-medium uppercase tracking-wide text-muted">Character description</span>
                  <textarea
                    value={characterPrompt}
                    onChange={(e) => setCharacterPrompt(e.target.value)}
                    placeholder={PROMPT_PLACEHOLDER}
                    rows={3}
                    maxLength={2000}
                    autoFocus
                    className="resize-none rounded-[10px] bg-surface-2 px-3 py-2.5 text-small leading-relaxed text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    icon={<Dices size={14} strokeWidth={1.5} />}
                    onClick={() => void rollCandidate()}
                    loading={rolling}
                    loadingLabel="Rendering…"
                    disabled={!characterPrompt.trim() || otherJobLive}
                  >
                    {candidates.length === 0 ? 'Generate a candidate' : 'Reroll'}
                  </Button>
                  {rolling ? (
                    <>
                      <span className="max-w-[280px] truncate text-small text-faint">{rollProgress}</span>
                      <button onClick={cancelRoll} className="text-small text-muted hover:text-body">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <span className="text-small text-faint">
                      {otherJobLive ? 'Another generation is running — wait for it to finish.' : '~2 min per candidate on this Mac. New seed each roll.'}
                    </span>
                  )}
                </div>
                {candidates.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {candidates.map((c) => {
                      const active = pickedId === c.historyId;
                      return (
                        <button
                          key={c.historyId}
                          onClick={() => setPickedId(c.historyId)}
                          aria-pressed={active}
                          className="group relative"
                        >
                          <img
                            src={c.url}
                            alt={`Candidate, seed ${c.seed}`}
                            className={cn(
                              'h-32 w-32 rounded-[10px] object-cover hairline',
                              active && 'outline outline-2 outline-offset-1 outline-[var(--iris)]',
                            )}
                          />
                          <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-surface-1/90 px-1.5 py-0.5 text-[10px] font-medium text-ink">
                            {active && <Check size={9} strokeWidth={2.5} />} seed {c.seed}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {candidates.length === 0 && !rolling && (
                  <p className="rounded-[10px] bg-surface-1 px-3 py-4 text-center text-small text-faint hairline">
                    Candidates land here — reroll until one looks right, then pick her as the base.
                  </p>
                )}
                <p className="text-small text-faint">
                  Aim for a frontal, mouth-closed portrait — the whole face visible, nothing covering the mouth or eyes.
                </p>
              </>
            )}
          </div>
        )}

        {/* ---------------------------- expressions ---------------------------- */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Always included</span>
              <div className="flex flex-wrap gap-1.5">
                {catalog
                  .filter((e) => e.required)
                  .map((e) => (
                    <span
                      key={e.key}
                      className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-body hairline"
                    >
                      <Lock size={10} strokeWidth={1.5} className="text-faint" /> {e.name}
                    </span>
                  ))}
              </div>
              <p className="text-small text-faint">Three talking mouths + a blink — the lip-sync core every preset needs.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium uppercase tracking-wide text-muted">Reactions</span>
              <div className="flex flex-col gap-1.5">
                {catalog
                  .filter((e) => !e.required)
                  .map((e) => {
                    const st = emotions[e.key];
                    if (!st) return null;
                    return (
                      <div key={e.key} className="flex items-start gap-3 rounded-[10px] bg-surface-1 px-3 py-2 hairline">
                        <div className="min-w-0 flex-1">
                          <span className={cn('text-small font-medium', st.on ? 'text-ink' : 'text-muted')}>{e.name}</span>
                          {st.on && (
                            <textarea
                              value={st.prompt}
                              onChange={(ev) =>
                                setEmotions((prev) => ({ ...prev, [e.key]: { ...prev[e.key]!, prompt: ev.target.value } }))
                              }
                              rows={2}
                              maxLength={2000}
                              aria-label={`${e.name} prompt`}
                              className="mt-1 w-full resize-none rounded-[8px] bg-surface-2 px-2.5 py-1.5 text-[12px] leading-relaxed text-body outline-none hairline focus:hairline-strong"
                            />
                          )}
                        </div>
                        <Switch
                          checked={st.on}
                          onChange={(v) => setEmotions((prev) => ({ ...prev, [e.key]: { ...prev[e.key]!, on: v } }))}
                          label={`${st.on ? 'Skip' : 'Include'} ${e.name}`}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-label font-medium uppercase tracking-wide text-muted">Your own expressions</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus size={13} strokeWidth={1.5} />}
                  onClick={addCustom}
                  disabled={frameCount >= 16}
                >
                  Add expression
                </Button>
              </div>
              {customs.length === 0 ? (
                <p className="text-small text-faint">
                  Anything you can describe — “winks playfully”, “rolls her eyes”, “sticks out her tongue”.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {customs.map((c, i) => (
                    <div key={c.uid} className="flex flex-col gap-2 rounded-[10px] bg-surface-1 p-3 hairline">
                      <div className="flex items-center gap-2">
                        <input
                          value={c.name}
                          onChange={(e) => patchCustom(c.uid, { name: e.target.value })}
                          placeholder="Name (Wink, Eye-roll…)"
                          maxLength={40}
                          aria-label={`Expression ${i + 1} name`}
                          className="h-8 w-44 rounded-[8px] bg-surface-2 px-2.5 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
                        />
                        <select
                          value={c.group}
                          onChange={(e) => patchCustom(c.uid, { group: e.target.value as ExpressionGroupOrCustom })}
                          aria-label={`Expression ${i + 1} region`}
                          className="h-8 rounded-[8px] bg-surface-2 px-2 text-small text-body outline-none hairline"
                        >
                          <option value="mouth">Mouth region</option>
                          <option value="eyes">Eyes region</option>
                          <option value="face">Whole face</option>
                          <option value="custom">Custom region…</option>
                        </select>
                        <span className="flex-1" />
                        <button
                          aria-label={`Remove expression ${i + 1}`}
                          onClick={() => setCustoms((prev) => prev.filter((x) => x.uid !== c.uid))}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-[var(--danger)]"
                        >
                          <Trash2 size={12} strokeWidth={1.5} />
                        </button>
                      </div>
                      <textarea
                        value={c.prompt}
                        onChange={(e) => patchCustom(c.uid, { prompt: e.target.value })}
                        placeholder="What is she doing? e.g. Winking her left eye with a playful smile, looking at the camera."
                        rows={2}
                        maxLength={2000}
                        aria-label={`Expression ${i + 1} prompt`}
                        className="w-full resize-none rounded-[8px] bg-surface-2 px-2.5 py-1.5 text-[12px] leading-relaxed text-body outline-none hairline placeholder:text-faint focus:hairline-strong"
                      />
                      {c.group === 'custom' && (
                        <p className="text-[11px] text-faint">You&apos;ll mark its composite window in the next step.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {frameCount > 20 && (
                <p className="text-small text-[var(--danger)]">Too many expressions — 20 frames max per run.</p>
              )}
            </div>
          </div>
        )}

        {/* ------------------------------ regions ------------------------------ */}
        {step === 2 && picked && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-2 p-2.5 hairline">
              <span className="text-small text-body">
                Auto-detect regions <span className="text-faint">— the pipeline finds the mouth, eyes, and face windows from the frames themselves</span>
              </span>
              <Switch checked={!manualRegions} onChange={(v) => setManualRegions(!v)} label="Auto-detect regions" />
            </label>

            {(manualRegions || customRegionRows.length > 0) && (
              <div className="flex flex-wrap items-start justify-center gap-5">
                <div className="relative select-none overflow-hidden rounded-lg hairline" style={{ width: PREVIEW, height: PREVIEW }}>
                  <img src={picked.url} alt="Chosen candidate" draggable={false} className="h-full w-full" />
                  {manualRegions && (
                    <>
                      <RegionBox
                        label="Face"
                        region={face}
                        scale={scale}
                        selected={selectedRegion === 'face'}
                        onSelect={() => setSelectedRegion('face')}
                        onChange={setFace}
                        imgW={CANVAS}
                        imgH={CANVAS}
                      />
                      <RegionBox
                        label="Eyes"
                        region={eyes}
                        scale={scale}
                        selected={selectedRegion === 'eyes'}
                        onSelect={() => setSelectedRegion('eyes')}
                        onChange={setEyes}
                        imgW={CANVAS}
                        imgH={CANVAS}
                      />
                      <RegionBox
                        label="Mouth"
                        region={mouth}
                        scale={scale}
                        selected={selectedRegion === 'mouth'}
                        onSelect={() => setSelectedRegion('mouth')}
                        onChange={setMouth}
                        imgW={CANVAS}
                        imgH={CANVAS}
                      />
                    </>
                  )}
                  {customRegionRows.map((c) => (
                    <RegionBox
                      key={c.uid}
                      label={c.name.trim() || 'Custom'}
                      region={c.region}
                      scale={scale}
                      selected={selectedRegion === `custom-${c.uid}`}
                      onSelect={() => setSelectedRegion(`custom-${c.uid}`)}
                      onChange={(r) => patchCustom(c.uid, { region: r })}
                      imgW={CANVAS}
                      imgH={CANVAS}
                    />
                  ))}
                </div>
                <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                  <p className="text-small text-muted">
                    {manualRegions
                      ? 'Fit Mouth snugly around the lips, Eyes across both eyes including the lids, and Face over everything that moves in a reaction.'
                      : 'Auto-detect is on — only your custom expressions need a window.'}
                    {customRegionRows.length > 0 && ' Each custom expression pastes only what its box covers.'}
                  </p>
                  <p className="text-small text-faint">Drag to move, corner to resize — or arrow keys, Shift+arrows to resize.</p>
                </div>
              </div>
            )}

            {!manualRegions && customRegionRows.length === 0 && (
              <p className="rounded-[10px] bg-surface-1 px-3 py-4 text-center text-small text-faint hairline">
                Nothing to mark — the pipeline compares each frame against the base and finds the changed region itself.
                Flip the switch to place the windows by hand.
              </p>
            )}
          </div>
        )}

        {/* ------------------------------ generate ----------------------------- */}
        {step === 3 && picked && (
          <div className="flex flex-wrap items-start gap-6">
            <img src={picked.url} alt="Chosen base" className="h-40 w-40 rounded-[12px] object-cover hairline" />
            <div className="flex min-w-[280px] flex-1 flex-col gap-3">
              {!myJob && (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-label font-medium uppercase tracking-wide text-muted">Preset name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Kiki, Nova, Coach…"
                      maxLength={60}
                      autoFocus
                      className="h-9 rounded-[10px] bg-surface-2 px-3 text-small text-ink outline-none hairline placeholder:text-faint focus:hairline-strong"
                    />
                  </label>
                  <p className="text-small text-muted">
                    {frameCount} frames — the lip-sync core, {emotionsOn.length} reaction{emotionsOn.length === 1 ? '' : 's'}
                    {customs.length > 0 && `, ${customs.length} of your own`} · seed {picked.seed} ·{' '}
                    {manualRegions ? 'manual regions' : 'auto-detected regions'}.
                  </p>
                  <p className="text-small text-faint">
                    Roughly {Math.max(4, Math.round(frameCount * 2))} minutes on this Mac. The job runs in the background —
                    you can close this and watch it from the studio sidebar.
                  </p>
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
                          animate={{
                            width: `${Math.max(4, (myJob.completedFrames / Math.max(1, myJob.totalFrames)) * 100)}%`,
                          }}
                          transition={spring.smooth}
                        />
                      </div>
                      <span className="text-[11px] text-faint">
                        {myJob.completedFrames} of {myJob.totalFrames} frames
                      </span>
                    </>
                  ) : myJob.state === 'error' ? (
                    <>
                      <span className="text-[11px] text-[var(--danger)]">{myJob.error ?? 'Generation failed.'}</span>
                      <span className="text-[11px] text-faint">Retrying picks up where it stopped — finished frames are kept.</span>
                    </>
                  ) : myJob.state === 'cancelled' ? (
                    <span className="text-[11px] text-muted">Cancelled — finished frames are kept; Generate again resumes.</span>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-small text-[var(--danger)]">{error}</p>}

        <footer className="flex items-center justify-between border-t border-line pt-3">
          <Button variant="ghost" onClick={step === 0 || myJobLive ? close : () => setStep((s) => s - 1)}>
            {step === 0 ? 'Cancel' : myJobLive ? 'Continue in background' : 'Back'}
          </Button>
          {step < 3 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              {step === 0 && !picked ? 'Pick a candidate' : 'Continue'}
            </Button>
          ) : !myJob || myJob.state === 'error' || myJob.state === 'cancelled' ? (
            <Button
              variant="primary"
              icon={<Sparkles size={14} strokeWidth={1.5} />}
              onClick={() => void submit()}
              loading={submitting}
              loadingLabel="Starting…"
              disabled={otherJobLive || !name.trim()}
            >
              {myJob ? 'Generate again' : `Generate ${frameCount} frames`}
            </Button>
          ) : null}
        </footer>
      </div>
    </Overlay>
  );
}
