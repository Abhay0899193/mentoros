import { randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AnimationClip,
  AvatarConfig,
  AddFaceExpressionInput,
  CoreEvents,
  CreateFacePresetInput,
  CreateManualFacePresetInput,
  CustomFacePreset,
  ExpressionGroupOrCustom,
  FaceJobStatus,
  FaceRegion,
  FaceToolchainStatus,
  GenerateFacePresetInput,
  PresetGenerationMeta,
  TriggerRule,
  UpdateAvatarConfigInput,
} from "../types.js";
import { computeCrop } from "./crop.js";
import type { FaceOps } from "./ops.js";
import { presetDir, SAFE_ART_FILE, workDir } from "./paths.js";
import { runFaceJob, TOTAL_FRAMES } from "./runner.js";
import {
  runAddExpressionJob,
  runGeneratePresetJob,
  resolveGenerateExpressions,
  type AddExprSpec,
  type GenerateProgress,
} from "./generateRunner.js";
import {
  BUILTIN_FACE_IDS,
  FaceBusyError,
  FaceForbiddenError,
  FaceNotFoundError,
  FaceStore,
  jobRowToStatus,
  serializePreset,
  type JobRow,
  type PresetRow,
} from "./store.js";
import { clipIdForSpec, parseConfig } from "./config.js";
import { catalogEntry, DEFAULT_REGIONS_1024, reactionClip } from "./catalog.js";
import { FaceValidationError } from "./validate.js";
import { FaceAbortError } from "./ops.js";
import {
  evaluateGenerateToolchain,
  evaluateToolchain,
  type GenerateToolchainProbe,
  type ToolchainProbe,
} from "./toolchain.js";
import type { ImageDims } from "./validate.js";

/**
 * Owns the one-at-a-time generation lifecycle: validation-passed inputs come in,
 * a background job runs (streaming `face.job`), and a finished preset is
 * persisted + broadcast (`faces.changed`). A cancel kills the child; a restart
 * marks any interrupted job 'error' (no auto-resume — the user re-submits).
 */

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

/** The slice of settings the delete path touches (reset active mentorFace). */
export interface ActiveFaceSettings {
  get(): { mentorFace: string };
  patch(input: { mentorFace: string }): unknown;
}

const RESTART_ERROR = "interrupted by restart — start again to resume";

interface RunningJob {
  jobId: string;
  abort: AbortController;
}

export interface FaceServiceDeps {
  dataDir: string;
  store: FaceStore;
  ops: FaceOps;
  broadcast: Broadcast;
  /** Photo/Kontext toolchain probe (POST /faces/custom). */
  toolchainProbe: ToolchainProbe;
  /** z-image-turbo toolchain probe (POST /faces/custom/generate + expressions). */
  generateProbe?: GenerateToolchainProbe;
  /** Resolve an Image Lab history id → the base candidate PNG path (Preset Generator). */
  resolveHistoryImage?: (historyId: string) => string | null;
  settings?: ActiveFaceSettings;
}

export class FaceService {
  private running: RunningJob | null = null;
  /** Late-bound Image Lab history resolver (imagegen is built after faces). */
  private historyResolver?: (historyId: string) => string | null;

  constructor(private readonly deps: FaceServiceDeps) {
    this.historyResolver = deps.resolveHistoryImage;
    // Any job left live by a crash/quit can never auto-resume — mark it errored.
    this.deps.store.sweepLiveJobs(RESTART_ERROR);
  }

  /** Inject the Image Lab history→base-path resolver (server wires this post-build). */
  setHistoryResolver(resolve: (historyId: string) => string | null): void {
    this.historyResolver = resolve;
  }

  toolchain(): FaceToolchainStatus {
    return evaluateToolchain(this.deps.toolchainProbe);
  }

  /** z-image-turbo toolchain (gates generate + add-expression). */
  generateToolchain(): FaceToolchainStatus {
    return this.deps.generateProbe
      ? evaluateGenerateToolchain(this.deps.generateProbe)
      : { state: "missing", detail: "z-image-turbo toolchain unavailable" };
  }

  isReady(): boolean {
    return this.toolchain().state === "ready";
  }

  generateReady(): boolean {
    return this.generateToolchain().state === "ready";
  }

  isBusy(): boolean {
    return this.running !== null;
  }

  listCustom(): CustomFacePreset[] {
    return this.deps.store.listCustom();
  }

  activeJob(): FaceJobStatus | null {
    const row = this.deps.store.latestJob();
    return row ? jobRowToStatus(row) : null;
  }

  /**
   * Start a generation job for validated input. Throws {@link FaceBusyError}
   * when one is already running. Returns the queued status immediately; progress
   * arrives via `face.job`.
   */
  start(input: CreateFacePresetInput, portraitDims: ImageDims): FaceJobStatus {
    if (this.running) throw new FaceBusyError();

    const presetId = this.deps.store.uniqueId(input.name);
    const crop = computeCrop(portraitDims.width, portraitDims.height, input.mouth, input.eyes);
    const seed = seedFor(presetId);
    this.prepareWorkDir(presetId, input);

    const status: FaceJobStatus = {
      jobId: randomUUID(),
      presetId,
      name: input.name,
      kind: "photo",
      state: "queued",
      step: "Queued",
      completedFrames: 0,
      totalFrames: TOTAL_FRAMES,
      startedAt: new Date().toISOString(),
    };
    this.deps.store.insertJob(statusToRow(status));
    this.deps.broadcast("face.job", { ...status });
    // Snapshot the queued status for the caller: run() begins synchronously and
    // mutates `status`, so returning the live object would already read 'generating'.
    const queued: FaceJobStatus = { ...status };

    const abort = new AbortController();
    this.running = { jobId: status.jobId, abort };
    void this.run(status, input, crop, seed, abort.signal);
    return queued;
  }

  /**
   * Start a Preset-Generator (t2i) job for validated input. Throws
   * {@link FaceBusyError} when one is already running, {@link FaceValidationError}
   * when the base candidate can't be resolved. Progress via `face.job`.
   */
  startGenerate(input: GenerateFacePresetInput): FaceJobStatus {
    if (this.running) throw new FaceBusyError();
    const presetId = this.deps.store.uniqueId(input.name);
    const baseSeed = input.baseSeed ?? seedFor(presetId);
    const expressions = resolveGenerateExpressions(input, baseSeed);
    const baseImagePath = this.prepareGenerateWorkDir(presetId, input, baseSeed);

    const status: FaceJobStatus = {
      jobId: randomUUID(),
      presetId,
      name: input.name,
      kind: "generate",
      state: "queued",
      step: "Queued",
      completedFrames: 0,
      totalFrames: expressions.length,
      startedAt: new Date().toISOString(),
    };
    this.deps.store.insertJob(statusToRow(status));
    this.deps.broadcast("face.job", { ...status });
    const queued: FaceJobStatus = { ...status };

    const abort = new AbortController();
    this.running = { jobId: status.jobId, abort };
    void this.runGenerate(status, input, baseSeed, expressions, baseImagePath, abort.signal);
    return queued;
  }

  /**
   * Start an add/regenerate-expression job for a custom preset. Throws
   * {@link FaceBusyError} / {@link FaceNotFoundError} / {@link FaceForbiddenError}.
   */
  startAddExpression(id: string, input: AddFaceExpressionInput): FaceJobStatus {
    if (this.running) throw new FaceBusyError();
    if (BUILTIN_FACE_IDS.has(id)) throw new FaceForbiddenError();
    const row = this.deps.store.get(id);
    if (!row) throw new FaceNotFoundError();
    const config = parseConfig(row);
    const method: PresetGenerationMeta["method"] = config.generation?.method ?? "kontext-photo";
    const resolved = resolveAddExpression(input, config, method);

    const status: FaceJobStatus = {
      jobId: randomUUID(),
      presetId: id,
      name: row.name,
      kind: "expression",
      state: "queued",
      step: "Queued",
      completedFrames: 0,
      totalFrames: 1,
      startedAt: new Date().toISOString(),
    };
    this.deps.store.insertJob(statusToRow(status));
    this.deps.broadcast("face.job", { ...status });
    const queued: FaceJobStatus = { ...status };

    const abort = new AbortController();
    this.running = { jobId: status.jobId, abort };
    void this.runAddExpression(status, id, config, method, resolved, abort.signal);
    return queued;
  }

  cancel(jobId: string): void {
    if (this.running && this.running.jobId === jobId) {
      this.running.abort.abort();
    }
  }

  /** Delete a custom preset: rows + art dir, reset active mentorFace to 'aura'. */
  deletePreset(id: string): { mentorFaceReset: boolean } {
    if (BUILTIN_FACE_IDS.has(id)) throw new FaceForbiddenError();
    if (!this.deps.store.deletePresetRow(id)) throw new FaceNotFoundError();
    rmSync(presetDir(this.deps.dataDir, id), { recursive: true, force: true });
    let mentorFaceReset = false;
    if (this.deps.settings && this.deps.settings.get().mentorFace === id) {
      this.deps.settings.patch({ mentorFace: "aura" });
      mentorFaceReset = true;
    }
    return { mentorFaceReset };
  }

  /* ------------------------- manual create / edit ------------------------- */

  /**
   * Create a preset from client-encoded webp frames (Avatar Studio). Fully
   * synchronous — no GPU/job machinery, no toolchain requirement. Decoded frames
   * are written under the preset dir and the built config is persisted.
   */
  createManual(input: CreateManualFacePresetInput): CustomFacePreset {
    const presetId = this.deps.store.uniqueId(input.name);
    const dir = presetDir(this.deps.dataDir, presetId);
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();

    writeFileSync(join(dir, "portrait-base.webp"), decodeDataUri(input.baseFrame));
    if (input.fullBase) writeFileSync(join(dir, "full.webp"), decodeDataUri(input.fullBase));

    const animations: AnimationClip[] = input.animations.map((clip) => {
      if (!clip.frames) return { ...clip };
      const frames = clip.frames.map((frame, idx) => {
        const file = `anim-${clip.id}-${idx}.webp`;
        writeFileSync(join(dir, file), decodeDataUri(frame));
        return file;
      });
      return { ...clip, frames };
    });

    const config: AvatarConfig = {
      schemaVersion: 1,
      presetId,
      name: input.name,
      accent: input.accent,
      baseFrame: "portrait-base.webp",
      ...(input.fullBase ? { fullBase: "full.webp" } : {}),
      animations,
      triggers: input.triggers,
      ...(input.defaultAnimationId ? { defaultAnimationId: input.defaultAnimationId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const row: PresetRow = {
      id: presetId,
      name: input.name,
      accent: input.accent,
      hasFull: !!input.fullBase,
      createdAt: now,
      configJson: JSON.stringify(config),
    };
    this.deps.store.insertPreset(row);
    return serializePreset(row);
  }

  /**
   * Frames-only editor save. Base frames + createdAt are preserved; clip frames
   * that arrive as data URIs are written as new `anim-<clipId>-<n>.webp` files,
   * frames that arrive as filenames must already exist on disk.
   */
  updateConfig(id: string, input: UpdateAvatarConfigInput): CustomFacePreset {
    if (BUILTIN_FACE_IDS.has(id)) throw new FaceForbiddenError();
    const row = this.deps.store.get(id);
    if (!row) throw new FaceNotFoundError();
    const dir = presetDir(this.deps.dataDir, id);
    const existing = parseConfig(row);

    const animations: AnimationClip[] = input.animations.map((clip) => {
      if (!clip.frames) return { ...clip };
      const frames = clip.frames.map((frame) => {
        if (isDataUri(frame)) {
          const file = nextAnimFile(dir, clip.id);
          writeFileSync(join(dir, file), decodeDataUri(frame));
          return file;
        }
        if (!SAFE_ART_FILE.test(frame) || !existsSync(join(dir, frame))) {
          throw new FaceValidationError(`unknown frame file: ${frame}`);
        }
        return frame;
      });
      return { ...clip, frames };
    });

    const now = new Date().toISOString();
    const name = input.name ?? row.name;
    const accent = input.accent ?? row.accent;
    const config: AvatarConfig = {
      schemaVersion: 1,
      presetId: id,
      name,
      accent,
      baseFrame: existing.baseFrame,
      ...(existing.fullBase ? { fullBase: existing.fullBase } : {}),
      animations,
      triggers: input.triggers,
      ...(input.defaultAnimationId ? { defaultAnimationId: input.defaultAnimationId } : {}),
      // Preserve Preset-Generator provenance so editor saves don't drop it (it
      // drives add-expression on generated presets).
      ...(existing.generation ? { generation: existing.generation } : {}),
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    const updated: PresetRow = {
      id,
      name,
      accent,
      hasFull: !!existing.fullBase,
      createdAt: row.createdAt,
      configJson: JSON.stringify(config),
    };
    this.deps.store.insertPreset(updated);
    return serializePreset(updated);
  }

  /* --------------------------------- run ---------------------------------- */

  private async run(
    status: FaceJobStatus,
    input: CreateFacePresetInput,
    crop: ReturnType<typeof computeCrop>,
    seed: number,
    signal: AbortSignal,
  ): Promise<void> {
    const emit = (): void => {
      this.deps.store.updateJob(status.jobId, {
        state: status.state,
        step: status.step,
        completedFrames: status.completedFrames,
        error: status.error ?? null,
      });
      this.deps.broadcast("face.job", { ...status });
    };
    try {
      const result = await runFaceJob({
        ops: this.deps.ops,
        crop,
        input,
        artDir: presetDir(this.deps.dataDir, status.presetId),
        workDir: workDir(this.deps.dataDir, status.presetId),
        seed,
        signal,
        report: (p) => {
          status.state = p.state;
          status.step = p.step;
          status.completedFrames = p.completedFrames;
          emit();
        },
      });

      this.deps.store.insertPreset({
        id: status.presetId,
        name: input.name,
        accent: result.accent,
        hasFull: result.hasFull,
        createdAt: new Date().toISOString(),
        configJson: null, // AI-generated: legacy config synthesized on read
      });
      status.state = "done";
      status.step = "Ready";
      status.completedFrames = TOTAL_FRAMES;
      emit();
      this.deps.broadcast("faces.changed", { presets: this.deps.store.listCustom() });
    } catch (err) {
      if (err instanceof FaceAbortError || signal.aborted) {
        status.state = "cancelled";
        status.step = "Cancelled";
      } else {
        status.state = "error";
        status.step = "Failed";
        status.error = err instanceof Error ? err.message : "generation failed";
      }
      emit();
    } finally {
      if (this.running && this.running.jobId === status.jobId) this.running = null;
    }
  }

  /* ----------------------------- generate run ----------------------------- */

  private async runGenerate(
    status: FaceJobStatus,
    input: GenerateFacePresetInput,
    baseSeed: number,
    expressions: ReturnType<typeof resolveGenerateExpressions>,
    baseImagePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    const emit = this.emitFor(status);
    try {
      const now = new Date().toISOString();
      const result = await runGeneratePresetJob({
        ops: this.deps.ops,
        presetId: status.presetId,
        name: input.name,
        characterPrompt: input.characterPrompt,
        baseSeed,
        baseImagePath,
        ...(input.regions ? { manualRegions: input.regions } : {}),
        expressions,
        artDir: presetDir(this.deps.dataDir, status.presetId),
        workDir: workDir(this.deps.dataDir, status.presetId),
        now,
        signal,
        report: (p: GenerateProgress) => {
          status.state = p.state;
          status.step = p.step;
          status.completedFrames = p.completedFrames;
          emit();
        },
      });

      this.deps.store.insertPreset({
        id: status.presetId,
        name: input.name,
        accent: result.accent,
        hasFull: false,
        createdAt: now,
        configJson: JSON.stringify(result.config),
      });
      status.state = "done";
      status.step = "Ready";
      status.completedFrames = expressions.length;
      emit();
      this.deps.broadcast("faces.changed", { presets: this.deps.store.listCustom() });
    } catch (err) {
      this.markFailure(status, err, signal);
      emit();
    } finally {
      if (this.running && this.running.jobId === status.jobId) this.running = null;
    }
  }

  /* -------------------------- add expression run -------------------------- */

  private async runAddExpression(
    status: FaceJobStatus,
    id: string,
    config: AvatarConfig,
    method: PresetGenerationMeta["method"],
    resolved: ResolvedAddExpression,
    signal: AbortSignal,
  ): Promise<void> {
    const emit = this.emitFor(status);
    try {
      const dir = presetDir(this.deps.dataDir, id);
      const result = await runAddExpressionJob({
        ops: this.deps.ops,
        method,
        ...(config.generation?.characterPrompt ? { characterPrompt: config.generation.characterPrompt } : {}),
        spec: resolved.spec,
        ...(config.generation?.regions ? { regionsMeta: config.generation.regions } : {}),
        baseFramePath: join(dir, config.baseFrame),
        artDir: dir,
        workDir: workDir(this.deps.dataDir, id),
        signal,
        report: (p: GenerateProgress) => {
          status.state = p.state;
          status.step = p.step;
          status.completedFrames = p.completedFrames;
          emit();
        },
      });

      const row = this.deps.store.get(id);
      if (!row) throw new FaceNotFoundError();
      const updated = applyAddExpression(config, method, resolved, result);
      this.deps.store.insertPreset({
        id,
        name: row.name,
        accent: row.accent,
        hasFull: row.hasFull,
        createdAt: row.createdAt,
        configJson: JSON.stringify(updated),
      });
      status.state = "done";
      status.step = "Ready";
      status.completedFrames = 1;
      emit();
      this.deps.broadcast("faces.changed", { presets: this.deps.store.listCustom() });
    } catch (err) {
      this.markFailure(status, err, signal);
      emit();
    } finally {
      if (this.running && this.running.jobId === status.jobId) this.running = null;
    }
  }

  /** Shared job-status persister + broadcaster. */
  private emitFor(status: FaceJobStatus): () => void {
    return (): void => {
      this.deps.store.updateJob(status.jobId, {
        state: status.state,
        step: status.step,
        completedFrames: status.completedFrames,
        error: status.error ?? null,
      });
      this.deps.broadcast("face.job", { ...status });
    };
  }

  /** Map a thrown error to the terminal cancelled/error status. */
  private markFailure(status: FaceJobStatus, err: unknown, signal: AbortSignal): void {
    if (err instanceof FaceAbortError || signal.aborted) {
      status.state = "cancelled";
      status.step = "Cancelled";
    } else {
      status.state = "error";
      status.step = "Failed";
      status.error = err instanceof Error ? err.message : "generation failed";
    }
  }

  /** Wipe the work dir when the source changed; otherwise keep it (resume). */
  private prepareGenerateWorkDir(
    presetId: string,
    input: GenerateFacePresetInput,
    baseSeed: number,
  ): string {
    const dir = workDir(this.deps.dataDir, presetId);
    let historyPath: string | undefined;
    if (input.baseHistoryId) {
      const p = this.historyResolver?.(input.baseHistoryId);
      if (!p) throw new FaceValidationError("base image not found in Image Lab history");
      historyPath = p;
    }
    const sig = JSON.stringify({
      characterPrompt: input.characterPrompt,
      baseSeed,
      expressions: input.expressions,
      regions: input.regions ?? null,
      base: historyPath
        ? { history: input.baseHistoryId, stat: statSig(historyPath) }
        : { dataUri: hashString(input.baseDataUri ?? "") },
    });
    const sigPath = join(dir, "source.json");
    if (existsSync(sigPath)) {
      let prev = "";
      try {
        prev = readFileSync(sigPath, "utf8");
      } catch {
        prev = "";
      }
      if (prev !== sig) rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(dir, { recursive: true });
    let baseImagePath: string;
    if (historyPath) {
      baseImagePath = historyPath;
    } else {
      baseImagePath = join(dir, "base-src");
      if (!existsSync(baseImagePath)) writeFileSync(baseImagePath, decodeImageDataUri(input.baseDataUri!));
    }
    writeFileSync(sigPath, sig);
    return baseImagePath;
  }

  /** Wipe the work dir when the source changed; otherwise keep it (resume). */
  private prepareWorkDir(presetId: string, input: CreateFacePresetInput): void {
    const dir = workDir(this.deps.dataDir, presetId);
    const sig = sourceSignature(input);
    const sigPath = join(dir, "source.json");
    if (existsSync(sigPath)) {
      let prev = "";
      try {
        prev = readFileSync(sigPath, "utf8");
      } catch {
        prev = "";
      }
      if (prev !== sig) rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(sigPath, sig);
  }
}

const WEBP_DATA_URI = "data:image/webp;base64,";
function isDataUri(value: string): boolean {
  return value.startsWith(WEBP_DATA_URI);
}
/** Decode a (pre-validated) webp data URI to its raw bytes. */
function decodeDataUri(value: string): Buffer {
  return Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
}
/** First free `anim-<clipId>-<n>.webp` (past any files already on disk). */
function nextAnimFile(dir: string, clipId: string): string {
  for (let n = 0; ; n += 1) {
    const file = `anim-${clipId}-${n}.webp`;
    if (!existsSync(join(dir, file))) return file;
  }
}

function statSig(path: string): string {
  try {
    const s = statSync(path);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "0:0";
  }
}

function sourceSignature(input: CreateFacePresetInput): string {
  return JSON.stringify({
    portrait: statSig(input.portraitPath),
    full: input.fullPath ? statSig(input.fullPath) : null,
    mouth: input.mouth,
    eyes: input.eyes,
  });
}

function seedFor(presetId: string): number {
  let h = 2166136261;
  for (let i = 0; i < presetId.length; i += 1) {
    h ^= presetId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 99999) + 1;
}

function statusToRow(s: FaceJobStatus): JobRow {
  return {
    id: s.jobId,
    presetId: s.presetId,
    name: s.name,
    kind: s.kind,
    state: s.state,
    step: s.step,
    completedFrames: s.completedFrames,
    totalFrames: s.totalFrames,
    error: s.error ?? null,
    startedAt: s.startedAt,
  };
}

/** djb2 hash of a string (base64 data-URI change detection for resume). */
function hashString(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return `${text.length}:${h.toString(16)}`;
}

/** Decode a (validated) image data URI to its raw bytes. */
function decodeImageDataUri(value: string): Buffer {
  return Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
}

/* ------------------------ add-expression resolution ----------------------- */

interface ResolvedAddExpression {
  spec: AddExprSpec;
  /** Set when this overwrites an existing clip's frames instead of appending. */
  effectiveReplace?: string;
  group: ExpressionGroupOrCustom;
  name: string;
  trigger?: TriggerRule;
}

/** Resolve a validated add-expression payload into a concrete frame spec. */
function resolveAddExpression(
  input: AddFaceExpressionInput,
  config: AvatarConfig,
  method: PresetGenerationMeta["method"],
): ResolvedAddExpression {
  const clipId = clipIdForSpec(input);
  const existingClip = config.animations.find((c) => c.id === clipId);
  const effectiveReplace = input.replaceClipId ?? (existingClip ? clipId : undefined);

  let frameFile: string;
  let group: ExpressionGroupOrCustom;
  let name: string;
  let prompt: string;
  if (input.key) {
    const entry = catalogEntry(input.key);
    if (!entry) throw new FaceValidationError(`unknown expression key: ${input.key}`);
    frameFile = entry.frameFile;
    group = entry.group;
    name = entry.name;
    prompt = input.prompt ?? (method === "z-turbo-t2i" ? entry.t2iClause : entry.kontextPrompt);
  } else {
    frameFile = `anim-${clipId}-0.webp`;
    group = input.group ?? "custom";
    name = input.name ?? clipId;
    prompt = input.prompt ?? "";
  }
  // Regenerating an existing single-frame custom/emotion clip reuses its file.
  if (effectiveReplace && !input.key && existingClip?.frames?.length) {
    frameFile = existingClip.frames[0]!;
  }

  const spec: AddExprSpec = { clipId, frameFile, group, prompt, seed: randomInt(0, 0x100000000) };
  if (input.region) spec.region = input.region;
  const resolved: ResolvedAddExpression = { spec, group, name };
  if (effectiveReplace) resolved.effectiveReplace = effectiveReplace;
  if (input.trigger) resolved.trigger = input.trigger;
  return resolved;
}

/** Fold a finished add-expression frame into the preset config + generation meta. */
function applyAddExpression(
  config: AvatarConfig,
  method: PresetGenerationMeta["method"],
  resolved: ResolvedAddExpression,
  result: { clipId: string; region: FaceRegion; regionSource: PresetGenerationMeta["regionSource"]; seed: number },
): AvatarConfig {
  const cfg: AvatarConfig = JSON.parse(JSON.stringify(config)) as AvatarConfig;
  let gen = cfg.generation;
  if (!gen) {
    gen = {
      method,
      baseSeed: 0,
      regions: { ...DEFAULT_REGIONS_1024 },
      regionSource: result.regionSource,
      expressions: [],
    };
    cfg.generation = gen;
  }
  const group = resolved.group;
  if (group !== "custom") gen.regions[group] = result.region;

  const metaEntry = {
    clipId: result.clipId,
    prompt: resolved.spec.prompt,
    group,
    region: result.region,
    seed: result.seed,
  };
  const existingMeta = gen.expressions.find((e) => e.clipId === result.clipId);
  if (existingMeta) Object.assign(existingMeta, metaEntry);
  else gen.expressions.push(metaEntry);

  if (!cfg.animations.some((c) => c.id === result.clipId)) {
    cfg.animations.push(reactionClip(result.clipId, resolved.name));
    if (!resolved.effectiveReplace) {
      const trigger: TriggerRule =
        resolved.trigger ?? { id: `${result.clipId}-manual`, animationId: result.clipId, kind: "manual", enabled: true };
      if (!cfg.triggers.some((t) => t.id === trigger.id)) cfg.triggers.push(trigger);
    }
  } else if (!resolved.effectiveReplace && resolved.trigger) {
    if (!cfg.triggers.some((t) => t.id === resolved.trigger!.id)) cfg.triggers.push(resolved.trigger);
  }
  cfg.updatedAt = new Date().toISOString();
  return cfg;
}
