import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** First existing path from the candidates, or null. */
export function firstExisting(paths: string[]): string | null {
  for (const p of paths) if (existsSync(p)) return p;
  return null;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a process, buffering stdout/stderr. Never rejects on non-zero exit —
 * the caller inspects {@link RunResult.code}. Rejects only if spawn itself
 * fails (e.g. ENOENT) unless `tolerant` is set.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; input?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      signal: opts.signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

export interface DownloadProgress {
  completedBytes: number;
  totalBytes: number;
}

/**
 * Stream a URL to `dest` (atomic: writes `<dest>.part` then renames), following
 * redirects via global fetch. Reports byte progress. Skips the download if the
 * destination already exists and is non-trivial.
 */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { redirect: "follow", signal });
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} ${res.statusText} for ${url}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  let completed = 0;
  const tmp = `${dest}.part`;
  const out = createWriteStream(tmp);
  const body = res.body as unknown as ReadableStream<Uint8Array>;
  const reader = Readable.fromWeb(body as never);
  reader.on("data", (chunk: Buffer) => {
    completed += chunk.length;
    onProgress({ completedBytes: completed, totalBytes: total });
  });
  try {
    await pipeline(reader, out);
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
