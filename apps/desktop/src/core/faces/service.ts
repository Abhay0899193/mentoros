import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AnimationClip,
  AvatarConfig,
  CoreEvents,
  CreateFacePresetInput,
  CreateManualFacePresetInput,
  CustomFacePreset,
  FaceJobStatus,
  FaceToolchainStatus,
  UpdateAvatarConfigInput,
} from "../types.js";
import { computeCrop } from "./crop.js";
import type { FaceOps } from "./ops.js";
import { presetDir, SAFE_ART_FILE, workDir } from "./paths.js";
import { runFaceJob, TOTAL_FRAMES } from "./runner.js";
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
import { parseConfig } from "./config.js";
import { FaceValidationError } from "./validate.js";
import { FaceAbortError } from "./ops.js";
import { evaluateToolchain, type ToolchainProbe } from "./toolchain.js";
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
  toolchainProbe: ToolchainProbe;
  settings?: ActiveFaceSettings;
}

export class FaceService {
  private running: RunningJob | null = null;

  constructor(private readonly deps: FaceServiceDeps) {
    // Any job left live by a crash/quit can never auto-resume — mark it errored.
    this.deps.store.sweepLiveJobs(RESTART_ERROR);
  }

  toolchain(): FaceToolchainStatus {
    return evaluateToolchain(this.deps.toolchainProbe);
  }

  isReady(): boolean {
    return this.toolchain().state === "ready";
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
    state: s.state,
    step: s.step,
    completedFrames: s.completedFrames,
    totalFrames: s.totalFrames,
    error: s.error ?? null,
    startedAt: s.startedAt,
  };
}
