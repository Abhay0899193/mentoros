import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CoreEvents,
  CreateFacePresetInput,
  CustomFacePreset,
  FaceJobStatus,
  FaceToolchainStatus,
} from "../types.js";
import { computeCrop } from "./crop.js";
import type { FaceOps } from "./ops.js";
import { presetDir, workDir } from "./paths.js";
import { runFaceJob, TOTAL_FRAMES } from "./runner.js";
import {
  BUILTIN_FACE_IDS,
  FaceBusyError,
  FaceForbiddenError,
  FaceNotFoundError,
  FaceStore,
  jobRowToStatus,
  type JobRow,
} from "./store.js";
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
