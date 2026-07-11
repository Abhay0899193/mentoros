import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { VideoGenService, VideoGenBusyError } from "./service.js";
import { VideoGenValidationError, validateGenerateInput } from "./validate.js";
import { findModelDef } from "./models.js";
import { videogenArtDir, SAFE_VIDEOGEN_FILE } from "./paths.js";

/** Generation carries an optional source image data URI — allow a large body. */
const GENERATE_BODY_LIMIT = 64 * 1024 * 1024;

export interface VideoGenDeps {
  service: VideoGenService;
  /** Cross-busy guard: an Image Lab job also holds the GPU (§three-way busy). */
  isImageGenBusy?: () => boolean;
  /** Cross-busy guard: a faces job also holds the GPU (§three-way busy). */
  isFacesBusy?: () => boolean;
  dataDir: string;
}

/**
 * /videogen HTTP routes (mirror of coreClient §Video Lab). Art is served
 * server-relative at /videogen/art/<file> with HTTP Range support so the
 * `<video>` tag can scrub. Files are write-once (one mp4 per job id, never
 * overwritten), so the art route uses an immutable long cache.
 */
export function registerVideoGenRoutes(app: FastifyInstance, deps: VideoGenDeps): void {
  const { service } = deps;

  app.get("/videogen/models", async () => service.listModels());

  app.post<{ Body: unknown }>(
    "/videogen/generate",
    { bodyLimit: GENERATE_BODY_LIMIT },
    async (req, reply) => {
      // Three-way cross-busy: only one of videogen/imagegen/faces may run — each
      // peaks >10 GB in mflux/mlx-video.
      if (service.isBusy() || deps.isImageGenBusy?.() || deps.isFacesBusy?.()) {
        return reply.code(409).send({ error: "a generation is already running" });
      }
      const body = req.body as { modelId?: unknown } | null;
      const modelId = typeof body?.modelId === "string" ? body.modelId : "";
      const def = findModelDef(modelId);
      if (!def) return reply.code(422).send({ error: "unknown model" });
      const info = service.modelInfo(modelId);
      if (!info || !info.available) {
        return reply
          .code(503)
          .send({ error: "model unavailable", detail: info?.detail ?? "model unavailable" });
      }
      try {
        const input = validateGenerateInput(req.body, def);
        const job = service.generate(input);
        return { job };
      } catch (err) {
        if (err instanceof VideoGenValidationError) {
          return reply.code(422).send({ error: err.message });
        }
        if (err instanceof VideoGenBusyError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>("/videogen/jobs/:id", async (req, reply) => {
    const status = service.job(req.params.id);
    if (!status) return reply.code(404).send({ error: "job not found" });
    return status;
  });

  app.post<{ Params: { id: string } }>("/videogen/jobs/:id/cancel", async (req, reply) => {
    service.cancel(req.params.id);
    return reply.code(204).send();
  });

  app.get("/videogen/history", async () => service.history());

  app.delete<{ Params: { id: string } }>("/videogen/history/:id", async (req, reply) => {
    if (!service.deleteHistory(req.params.id)) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.code(204).send();
  });

  /* --------------------------- static art serving ------------------------- */
  // Write-once files (one per job id) → immutable long cache. Range support lets
  // <video> scrub without downloading the whole clip.
  app.get<{ Params: { file: string } }>("/videogen/art/:file", async (req, reply) => {
    const { file } = req.params;
    if (!SAFE_VIDEOGEN_FILE.test(file)) return reply.code(404).send({ error: "not found" });
    const path = join(videogenArtDir(deps.dataDir), file);
    if (!existsSync(path)) return reply.code(404).send({ error: "not found" });

    const total = statSync(path).size;
    reply.header("accept-ranges", "bytes");
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.type("video/mp4");

    const range = req.headers.range;
    if (!range) {
      reply.header("content-length", String(total));
      return reply.send(readFileSync(path));
    }
    return sendRange(reply, path, total, range);
  });
}

/**
 * Serve a byte range: 206 + Content-Range on success, 416 when unsatisfiable,
 * 200 (full) when the header is unparseable. Buffers the slice — clips are small.
 */
function sendRange(reply: FastifyReply, path: string, total: number, range: string): FastifyReply {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) {
    // Unparseable / empty range → serve the whole file.
    reply.header("content-length", String(total));
    return reply.send(readFileSync(path));
  }

  let start: number;
  let end: number;
  if (m[1] === "") {
    // Suffix range: last N bytes (`bytes=-500`).
    const n = Number(m[2]);
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  }

  if (start >= total || start > end || start < 0) {
    // 416 carries no body (content-type is already video/mp4) — just the range.
    return reply.code(416).header("content-range", `bytes */${total}`).send();
  }

  const buf = readFileSync(path).subarray(start, end + 1);
  return reply
    .code(206)
    .header("content-range", `bytes ${start}-${end}/${total}`)
    .header("content-length", String(end - start + 1))
    .send(buf);
}
