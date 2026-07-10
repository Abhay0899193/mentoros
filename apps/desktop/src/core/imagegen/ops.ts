import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

/**
 * The injected side-effect seam for generation. Everything the service shells
 * out to (mflux) or calls over the network (fal.ai) lives behind this interface
 * so the orchestration (arg building, seed resolution, history writes) is
 * testable without a GPU or a real fal key.
 *
 *   - runLocal is the long-running mflux step (streams stdout lines to `report`)
 *   - runFal POSTs to fal.ai and writes the returned PNG to `outPng`
 */
export interface ImageGenOps {
  runLocal(inv: LocalInvocation, report: (line: string) => void, signal: AbortSignal): Promise<void>;
  runFal(inv: FalInvocation, outPng: string, report: (line: string) => void, signal: AbortSignal): Promise<void>;
}

export interface LocalInvocation {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

/** fal.ai z-image/turbo request body (sync_mode returns the image inline). */
export interface FalGenerateBody {
  prompt: string;
  image_size: { width: number; height: number };
  num_inference_steps: number;
  seed: number;
  num_images: 1;
  enable_prompt_expansion: false;
  output_format: "png";
  sync_mode: true;
}

export interface FalInvocation {
  url: string;
  apiKey: string;
  body: FalGenerateBody;
}

/** Local mflux runs can take a long time (first run downloads weights). */
const LOCAL_TIMEOUT_MS = 45 * 60 * 1000;

/** Thrown when a step is killed by cancellation — the service maps it to 'error'/'cancelled'. */
export class ImageGenAbortError extends Error {
  constructor() {
    super("cancelled");
    this.name = "ImageGenAbortError";
  }
}

/** Production ops: real spawn + real fetch. */
export function createRealImageGenOps(): ImageGenOps {
  return {
    runLocal(inv, report, signal) {
      return spawnLocal(inv, report, signal);
    },
    runFal(inv, outPng, report, signal) {
      return callFal(inv, outPng, report, signal);
    },
  };
}

/* ------------------------------ local (mflux) ----------------------------- */

function spawnLocal(inv: LocalInvocation, report: (line: string) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ImageGenAbortError());
      return;
    }
    const child = spawn(inv.cmd, inv.args, {
      env: { ...process.env, ...inv.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrTail = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, LOCAL_TIMEOUT_MS);
    const onAbort = (): void => {
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // mflux writes its progress bar to stderr; surface both streams as progress.
    const onData = (b: Buffer): void => {
      for (const line of b.toString().split(/\r?\n/)) {
        const t = line.trim();
        if (t) report(t);
      }
      stderrTail = tail(stderrTail + b.toString());
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${inv.cmd} not found`)
          : err,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        reject(new ImageGenAbortError());
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

/* -------------------------------- fal.ai ---------------------------------- */

interface FalResponse {
  images?: Array<{ url?: string }>;
  seed?: number;
}

async function callFal(
  inv: FalInvocation,
  outPng: string,
  report: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new ImageGenAbortError();
  report("Contacting fal.ai…");
  let res: Response;
  try {
    res = await fetch(inv.url, {
      method: "POST",
      headers: {
        Authorization: `Key ${inv.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(inv.body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new ImageGenAbortError();
    throw new Error(`fal.ai request failed: ${err instanceof Error ? err.message : "network error"}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`fal.ai error ${res.status}: ${lastLine(detail) || res.statusText}`);
  }
  const json = (await res.json()) as FalResponse;
  const url = json.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image");
  report("Downloading result…");
  writeFileSync(outPng, await readImageUrl(url, signal));
}

/** Decode a data URI, or fetch an http(s) URL, into raw PNG bytes. */
async function readImageUrl(url: string, signal: AbortSignal): Promise<Buffer> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma === -1) throw new Error("malformed data URI from fal.ai");
    return Buffer.from(url.slice(comma + 1), "base64");
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`failed to download fal.ai image (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
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
