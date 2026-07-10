import { randomUUID, randomInt } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ImageGenHistoryItem,
  ImageGenJobStatus,
  ImageGenModelInfo,
  ImageGenRequest,
} from "../types.js";
import { KONTEXT_BIN, KONTEXT_MODEL, type ToolchainProbe } from "../faces/toolchain.js";
import { Z_TURBO_BIN, type ImageGenToolchainProbe } from "./toolchain.js";
import {
  buildModelInfos,
  findModelDef,
  modelInfoFor,
  type ImageGenBackend,
  type ImageGenModelDef,
} from "./models.js";
import { imagegenRoot, imagegenTmpDir } from "./paths.js";
import { serializeHistory, type ImageGenRepo } from "./store.js";
import {
  createRealImageGenOps,
  ImageGenAbortError,
  type FalGenerateBody,
  type ImageGenOps,
  type LocalInvocation,
} from "./ops.js";
import type { FalKeyStore } from "./keys.js";

/**
 * Owns the single-flight generation lifecycle: a validated request comes in, a
 * background job runs (streaming stdout into `progressText`), and a finished PNG
 * is persisted to history. Only one job runs at a time — it monopolizes the GPU
 * (local) or the fal budget (hosted). Jobs are tracked in memory; finished
 * results live in the persistent history table.
 */

const FAL_URL = "https://fal.run/fal-ai/z-image/turbo";

/** A generation job is already running (→ HTTP 409). */
export class ImageGenBusyError extends Error {
  constructor(message = "a generation is already running") {
    super(message);
    this.name = "ImageGenBusyError";
  }
}

interface RunningJob {
  jobId: string;
  abort: AbortController;
}

export interface ImageGenServiceDeps {
  dataDir: string;
  repo: ImageGenRepo;
  falKeys: FalKeyStore;
  /** Z-Image-Turbo local toolchain probe. */
  probe: ImageGenToolchainProbe;
  /** Faces (mflux + FLUX-Kontext) toolchain probe — reused for the edit model. */
  kontextProbe: ToolchainProbe;
  ops?: ImageGenOps;
  home?: string;
}

export class ImageGenService {
  private running: RunningJob | null = null;
  private readonly jobs = new Map<string, ImageGenJobStatus>();
  private readonly ops: ImageGenOps;
  private readonly home: string;

  constructor(private readonly deps: ImageGenServiceDeps) {
    this.ops = deps.ops ?? createRealImageGenOps();
    this.home = deps.home ?? homedir();
  }

  isBusy(): boolean {
    return this.running !== null;
  }

  /** Live picker infos (availability recomputed from the current probes/key). */
  listModels(): ImageGenModelInfo[] {
    return buildModelInfos(this.availability());
  }

  /** One model's live info (undefined for an unknown id). */
  modelInfo(id: string): ImageGenModelInfo | undefined {
    return modelInfoFor(id, this.availability());
  }

  job(id: string): ImageGenJobStatus | null {
    const j = this.jobs.get(id);
    return j ? { ...j } : null;
  }

  history(): ImageGenHistoryItem[] {
    return this.deps.repo.list().map(serializeHistory);
  }

  /** Delete a history row + its PNG. False when the id is unknown. */
  deleteHistory(id: string): boolean {
    const row = this.deps.repo.get(id);
    if (!row) return false;
    this.deps.repo.delete(id);
    rmSync(join(imagegenRoot(this.deps.dataDir), row.file), { force: true });
    return true;
  }

  cancel(id: string): void {
    if (this.running && this.running.jobId === id) this.running.abort.abort();
  }

  /**
   * Start a generation job for a validated request. Throws
   * {@link ImageGenBusyError} when one is already running. Returns the new job
   * id immediately; progress/result arrive via {@link job}.
   */
  generate(req: ImageGenRequest): { jobId: string } {
    if (this.running) throw new ImageGenBusyError();
    const def = findModelDef(req.modelId);
    if (!def) throw new ImageGenBusyError("unknown model"); // defensive: routes pre-check

    const jobId = randomUUID();
    const seedUsed = req.randomizeSeed || req.seed === undefined ? randomInt(0, 0x100000000) : req.seed;

    const status: ImageGenJobStatus = { id: jobId, state: "queued" };
    this.jobs.set(jobId, status);

    const abort = new AbortController();
    this.running = { jobId, abort };
    void this.run(def, req, jobId, seedUsed, abort.signal);
    return { jobId };
  }

  /* --------------------------------- run ---------------------------------- */

  private async run(
    def: ImageGenModelDef,
    req: ImageGenRequest,
    jobId: string,
    seedUsed: number,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now();
    const root = imagegenRoot(this.deps.dataDir);
    mkdirSync(root, { recursive: true });
    const file = `${jobId}.png`;
    const outPng = join(root, file);
    let refPath: string | undefined;

    const status = this.jobs.get(jobId)!;
    const report = (line: string): void => {
      status.progressText = line;
    };
    const setState = (s: ImageGenJobStatus["state"]): void => {
      status.state = s;
    };

    try {
      setState("running");
      report("Preparing…");
      if (req.referenceDataUri && def.requiresReference) {
        refPath = this.writeReference(jobId, req.referenceDataUri);
      }

      if (def.backend === "z-turbo-fal") {
        await this.ops.runFal(
          { url: FAL_URL, apiKey: this.requireFalKey(), body: this.falBody(req, seedUsed) },
          outPng,
          report,
          signal,
        );
      } else {
        await this.ops.runLocal(this.localInvocation(def.backend, req, seedUsed, outPng, refPath), report, signal);
      }

      const createdAt = new Date().toISOString();
      this.deps.repo.insert({
        id: jobId,
        modelId: def.id,
        prompt: req.prompt,
        width: req.width,
        height: req.height,
        steps: req.steps,
        seed: seedUsed,
        file,
        createdAt,
      });
      status.result = {
        historyId: jobId,
        url: `/imagegen/art/${file}`,
        seedUsed,
        elapsedMs: Date.now() - startedAt,
      };
      status.progressText = "Done";
      setState("done");
    } catch (err) {
      // A partial/failed PNG must not linger under a job id that reports 'error'.
      if (existsSync(outPng)) rmSync(outPng, { force: true });
      setState("error");
      status.error =
        err instanceof ImageGenAbortError || signal.aborted
          ? "cancelled"
          : err instanceof Error
            ? err.message
            : "generation failed";
    } finally {
      if (refPath) rmSync(refPath, { force: true });
      if (this.running && this.running.jobId === jobId) this.running = null;
    }
  }

  /* ------------------------------ invocation ------------------------------ */

  private localInvocation(
    backend: Extract<ImageGenBackend, "z-turbo-local" | "kontext-local">,
    req: ImageGenRequest,
    seed: number,
    outPng: string,
    refPath: string | undefined,
  ): LocalInvocation {
    const localBin = join(this.home, ".local", "bin");
    const path = `${localBin}:${process.env.PATH ?? ""}`;
    const hfHome = join(this.home, "mentoros-imagegen", "hf-cache");
    const env = { HF_HOME: hfHome, HF_HUB_DISABLE_XET: "1", PATH: path };

    if (backend === "kontext-local") {
      return {
        cmd: localBinOr(localBin, KONTEXT_BIN),
        args: [
          "--model", KONTEXT_MODEL,
          "--base-model", "dev",
          "--image-path", refPath!,
          "--prompt", req.prompt,
          "--steps", String(req.steps),
          "--guidance", "4.0",
          "--seed", String(seed),
          "--width", String(req.width),
          "--height", String(req.height),
          "--output", outPng,
        ],
        env,
      };
    }
    return {
      cmd: localBinOr(localBin, Z_TURBO_BIN),
      args: [
        "--prompt", req.prompt,
        "--width", String(req.width),
        "--height", String(req.height),
        "--steps", String(req.steps),
        "--seed", String(seed),
        "-q", "8",
        "--output", outPng,
      ],
      env,
    };
  }

  private falBody(req: ImageGenRequest, seed: number): FalGenerateBody {
    return {
      prompt: req.prompt,
      image_size: { width: req.width, height: req.height },
      num_inference_steps: req.steps,
      seed,
      num_images: 1,
      enable_prompt_expansion: false,
      output_format: "png",
      sync_mode: true,
    };
  }

  private requireFalKey(): string {
    const key = this.deps.falKeys.getKey();
    if (!key) throw new Error("no fal.ai API key configured");
    return key;
  }

  /** Decode a reference data URI to a PNG the CLI can read. */
  private writeReference(jobId: string, dataUri: string): string {
    const dir = imagegenTmpDir(this.deps.dataDir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${jobId}-ref.png`);
    writeFileSync(path, Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"));
    return path;
  }

  private availability() {
    return {
      probe: this.deps.probe,
      falState: this.deps.falKeys.getState(),
      kontextProbe: this.deps.kontextProbe,
    };
  }
}

/** Prefer the explicit ~/.local/bin copy the toolchain installs; else resolve on PATH. */
function localBinOr(localBin: string, name: string): string {
  const local = join(localBin, name);
  return existsSync(local) ? local : name;
}
