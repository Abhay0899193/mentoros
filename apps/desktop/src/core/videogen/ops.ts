import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The injected side-effect seam for video generation. Everything the service
 * shells out to (mlx-video) lives behind this interface so the orchestration
 * (arg building, seed resolution, history writes, progress parsing) is testable
 * without a GPU. `MENTOROS_VIDEOGEN_FAKE=1` swaps in a deterministic op that
 * writes a tiny valid mp4 — used by the test suite.
 */
export interface VideoGenOps {
  generate(inv: LocalInvocation, report: (p: VideoProgress) => void, signal: AbortSignal): Promise<void>;
}

export interface LocalInvocation {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

/** Parsed progress tick: a monotonic 0..1 fraction plus the current step line. */
export interface VideoProgress {
  progress?: number;
  detail: string;
}

/** Local mlx-video runs are long (first run downloads ~30 GB of weights). */
const LOCAL_TIMEOUT_MS = 60 * 60 * 1000;
/** Grace between SIGTERM and SIGKILL on cancel. */
const KILL_GRACE_MS = 2000;
/** Stage 1 (denoise) is ~70% of wall clock; stage 2 (refine) the rest. */
const STAGE1_WEIGHT = 0.7;

/** Thrown when a run is killed by cancellation — the service maps it to 'cancelled'. */
export class VideoGenAbortError extends Error {
  constructor() {
    super("cancelled");
    this.name = "VideoGenAbortError";
  }
}

/**
 * Parse one mlx-video stderr line into a progress tick. The distilled pipeline
 * emits `STAGE:1:STEP:n:8:Denoising` then `STAGE:2:STEP:n:3:Refining`; stage 1
 * maps to [0, 0.7], stage 2 to [0.7, 1]. Non-progress lines return their text
 * with no fraction (detail-only). Returns null for blank lines.
 */
export function parseProgress(line: string): VideoProgress | null {
  const t = line.trim();
  if (!t) return null;
  const m = /STAGE:(\d+):STEP:(\d+):(\d+)/.exec(t);
  if (!m) return { detail: t };
  const stage = Number(m[1]);
  const step = Number(m[2]);
  const total = Number(m[3]);
  if (total <= 0) return { detail: t };
  const frac = Math.min(1, step / total);
  const progress = stage <= 1 ? frac * STAGE1_WEIGHT : STAGE1_WEIGHT + frac * (1 - STAGE1_WEIGHT);
  return { progress: Math.min(1, Math.max(0, progress)), detail: t };
}

/** Production ops: real spawn, or the fake op when MENTOROS_VIDEOGEN_FAKE=1. */
export function createRealVideoGenOps(): VideoGenOps {
  if (process.env.MENTOROS_VIDEOGEN_FAKE === "1") return createFakeVideoGenOps();
  return {
    generate(inv, report, signal) {
      return spawnGenerate(inv, report, signal);
    },
  };
}

/* ---------------------------- real (mlx-video) ---------------------------- */

function spawnGenerate(
  inv: LocalInvocation,
  report: (p: VideoProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new VideoGenAbortError());
      return;
    }
    const child = spawn(inv.cmd, inv.args, {
      env: { ...process.env, ...inv.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrTail = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, LOCAL_TIMEOUT_MS);
    const onAbort = (): void => {
      // Graceful first; hard-kill if it doesn't exit within the grace window.
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener("abort", onAbort);
    };
    // mlx-video writes STAGE:/STEP: progress to stderr; parse both streams.
    const onData = (buf: Buffer): void => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) {
        const p = parseProgress(line);
        if (p) report(p);
      }
      stderrTail = tail(stderrTail + text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      cleanup();
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${inv.cmd} not found`)
          : err,
      );
    });
    child.on("close", (code) => {
      cleanup();
      if (signal.aborted) {
        reject(new VideoGenAbortError());
        return;
      }
      if (timedOut) {
        reject(new Error("generation timed out"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`generation failed: ${lastLine(stderrTail) || `exit ${code}`}`));
        return;
      }
      resolve();
    });
  });
}

/* --------------------------------- fake ----------------------------------- */

/**
 * A minimal but real mp4 (ftyp + mdat) so `<video>`/Range streaming tests work.
 * ~236 bytes, content-addressed by job id (deterministic).
 */
const FAKE_MP4_BASE64 =
  "AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAANBtZGF0ISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISE=";

/**
 * Deterministic test op: emit 3 STAGE ticks (monotonic progress), honor abort,
 * then write the tiny mp4 to the invocation's `--output-path`.
 */
export function createFakeVideoGenOps(): VideoGenOps {
  return {
    async generate(inv, report, signal) {
      if (signal.aborted) throw new VideoGenAbortError();
      const out = outputPath(inv.args);
      const ticks = ["STAGE:1:STEP:4:8:Denoising", "STAGE:2:STEP:1:3:Refining", "STAGE:2:STEP:3:3:Refining"];
      for (const line of ticks) {
        if (signal.aborted) throw new VideoGenAbortError();
        const p = parseProgress(line);
        if (p) report(p);
      }
      if (!out) throw new Error("fake op: missing --output-path");
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(FAKE_MP4_BASE64, "base64"));
    },
  };
}

/** Pull the value after `--output-path` out of an arg vector. */
function outputPath(args: string[]): string | undefined {
  const i = args.indexOf("--output-path");
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/* -------------------------------- helpers --------------------------------- */

/** Keep only the last ~4 KB of streamed output (bounded memory for the error tail). */
function tail(text: string): string {
  return text.length > 4096 ? text.slice(-4096) : text;
}

function lastLine(text: string): string {
  const parts = text.trim().split("\n").filter(Boolean);
  return parts.length ? parts[parts.length - 1]!.trim() : "";
}
