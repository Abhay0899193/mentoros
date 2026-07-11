import { randomUUID, randomInt } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  CoreEvents,
  VideoGenHistoryItem,
  VideoGenJobStatus,
  VideoGenModelInfo,
  VideoGenRequest,
} from "../types.js";
import {
  VIDEO_ENCODER_REPO,
  VIDEO_MODEL_REPO,
  type VideoGenToolchainProbe,
} from "./toolchain.js";
import {
  buildModelInfos,
  findModelDef,
  modelInfoFor,
  type VideoGenModelDef,
} from "./models.js";
import { videogenArtDir, videogenBin, videogenHfCache, videogenTmpDir } from "./paths.js";
import { serializeHistory, type VideoGenRepo } from "./store.js";
import {
  createRealVideoGenOps,
  VideoGenAbortError,
  type LocalInvocation,
  type VideoGenOps,
} from "./ops.js";

/**
 * Owns the single-flight generation lifecycle: a validated request comes in, a
 * background job runs (streaming `videogen.job`), and a finished mp4 is
 * persisted to history. Only one job runs at a time — it monopolizes the GPU.
 * Jobs are tracked in memory; a restart drops any in-flight job (the UI falls
 * back to history). Finished results live in the persistent history table.
 */

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

/** A generation job is already running (→ HTTP 409). */
export class VideoGenBusyError extends Error {
  constructor(message = "a generation is already running") {
    super(message);
    this.name = "VideoGenBusyError";
  }
}

interface RunningJob {
  jobId: string;
  abort: AbortController;
}

export interface VideoGenServiceDeps {
  dataDir: string;
  repo: VideoGenRepo;
  broadcast: Broadcast;
  /** LTX-2.3 local toolchain probe. */
  probe: VideoGenToolchainProbe;
  ops?: VideoGenOps;
  home?: string;
}

export class VideoGenService {
  private running: RunningJob | null = null;
  private readonly jobs = new Map<string, VideoGenJobStatus>();
  private readonly ops: VideoGenOps;
  private readonly home: string;

  constructor(private readonly deps: VideoGenServiceDeps) {
    this.ops = deps.ops ?? createRealVideoGenOps();
    this.home = deps.home ?? homedir();
  }

  isBusy(): boolean {
    return this.running !== null;
  }

  /** Live picker infos (availability recomputed from the current probe). */
  listModels(): VideoGenModelInfo[] {
    return buildModelInfos({ probe: this.deps.probe });
  }

  /** One model's live info (undefined for an unknown id). */
  modelInfo(id: string): VideoGenModelInfo | undefined {
    return modelInfoFor(id, { probe: this.deps.probe });
  }

  job(id: string): VideoGenJobStatus | null {
    const j = this.jobs.get(id);
    return j ? { ...j } : null;
  }

  history(): VideoGenHistoryItem[] {
    return this.deps.repo.list().map(serializeHistory);
  }

  /** Resolve a history id to its stored mp4 path on disk (null when gone). */
  historyVideoPath(id: string): string | null {
    const row = this.deps.repo.get(id);
    if (!row) return null;
    const path = join(videogenArtDir(this.deps.dataDir), row.file);
    return existsSync(path) ? path : null;
  }

  /** Delete a history row + its mp4. False when the id is unknown. */
  deleteHistory(id: string): boolean {
    const row = this.deps.repo.get(id);
    if (!row) return false;
    this.deps.repo.delete(id);
    rmSync(join(videogenArtDir(this.deps.dataDir), row.file), { force: true });
    return true;
  }

  cancel(id: string): void {
    if (this.running && this.running.jobId === id) this.running.abort.abort();
  }

  /**
   * Start a generation job for a validated request. Throws
   * {@link VideoGenBusyError} when one is already running. Returns the queued
   * status immediately; progress/result arrive via `videogen.job`.
   */
  generate(req: VideoGenRequest): VideoGenJobStatus {
    if (this.running) throw new VideoGenBusyError();
    const def = findModelDef(req.modelId);
    if (!def) throw new VideoGenBusyError("unknown model"); // defensive: routes pre-check

    const jobId = randomUUID();
    const seedUsed = req.randomizeSeed || req.seed === undefined ? randomInt(0, 0x100000000) : req.seed;

    const status: VideoGenJobStatus = { id: jobId, state: "queued", progress: 0 };
    this.jobs.set(jobId, status);
    this.deps.broadcast("videogen.job", { ...status });
    const queued: VideoGenJobStatus = { ...status };

    const abort = new AbortController();
    this.running = { jobId, abort };
    void this.run(def, req, jobId, seedUsed, abort.signal);
    return queued;
  }

  /* --------------------------------- run ---------------------------------- */

  private async run(
    def: VideoGenModelDef,
    req: VideoGenRequest,
    jobId: string,
    seedUsed: number,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now();
    const artDir = videogenArtDir(this.deps.dataDir);
    mkdirSync(artDir, { recursive: true });
    const file = `${jobId}.mp4`;
    const outPath = join(artDir, file);
    let imgPath: string | undefined;

    const status = this.jobs.get(jobId)!;
    const emit = (): void => {
      this.deps.broadcast("videogen.job", { ...status });
    };

    try {
      status.state = "running";
      status.progress = 0;
      status.detail = "Preparing…";
      emit();
      if (req.image) imgPath = this.writeSourceImage(jobId, req.image);

      await this.ops.generate(
        this.invocation(req, seedUsed, outPath, imgPath),
        (p) => {
          // Monotonic: never let a late detail-only line rewind the bar.
          if (p.progress !== undefined && (status.progress === undefined || p.progress > status.progress)) {
            status.progress = p.progress;
          }
          status.detail = p.detail;
          emit();
        },
        signal,
      );

      const createdAt = new Date().toISOString();
      const durationMs = Date.now() - startedAt;
      this.deps.repo.insert({
        id: jobId,
        modelId: def.id,
        prompt: req.prompt,
        width: req.width,
        height: req.height,
        numFrames: req.numFrames,
        fps: req.fps,
        seed: seedUsed,
        hasSourceImage: !!req.image,
        durationMs,
        file,
        createdAt,
      });
      status.result = {
        historyId: jobId,
        url: `/videogen/art/${file}`,
        seedUsed,
        elapsedMs: durationMs,
      };
      status.progress = 1;
      status.detail = "Done";
      status.state = "done";
      emit();
    } catch (err) {
      // A partial/failed mp4 must not linger under a job id that reports error.
      if (existsSync(outPath)) rmSync(outPath, { force: true });
      if (err instanceof VideoGenAbortError || signal.aborted) {
        status.state = "cancelled";
        status.detail = "Cancelled";
        status.error = "cancelled";
      } else {
        status.state = "error";
        status.detail = "Failed";
        status.error = err instanceof Error ? err.message : "generation failed";
      }
      emit();
    } finally {
      if (imgPath) rmSync(imgPath, { force: true });
      if (this.running && this.running.jobId === jobId) this.running = null;
    }
  }

  /* ------------------------------ invocation ------------------------------ */

  private invocation(
    req: VideoGenRequest,
    seed: number,
    outPath: string,
    imgPath: string | undefined,
  ): LocalInvocation {
    const hfHome = videogenHfCache(this.home);
    const args = ["--prompt", req.prompt];
    if (imgPath) args.push("--image", imgPath);
    args.push(
      "--model-repo", VIDEO_MODEL_REPO,
      "--text-encoder-repo", VIDEO_ENCODER_REPO,
      "--width", String(req.width),
      "--height", String(req.height),
      "--num-frames", String(req.numFrames),
      "--fps", String(req.fps),
      "--seed", String(seed),
      "--output-path", outPath,
    );
    return {
      cmd: videogenBin(this.home),
      args,
      // NB: no --steps flag — the distilled pipeline ignores it (two fixed stages).
      env: { HF_HOME: hfHome, HF_HUB_DISABLE_XET: "1" },
    };
  }

  /** Decode an I2V source data URI to a PNG the CLI can read. */
  private writeSourceImage(jobId: string, dataUri: string): string {
    const dir = videogenTmpDir(this.deps.dataDir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${jobId}-src.png`);
    writeFileSync(path, Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"));
    return path;
  }
}
