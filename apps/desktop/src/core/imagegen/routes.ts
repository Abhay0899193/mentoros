import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ApiKeyState } from "../types.js";
import { ImageGenService, ImageGenBusyError } from "./service.js";
import { ImageGenValidationError, validateGenerateInput } from "./validate.js";
import { findModelDef } from "./models.js";
import { imagegenRoot, SAFE_IMAGEGEN_FILE } from "./paths.js";
import type { FalKeyStore } from "./keys.js";

/** Generation carries an optional reference image data URI — allow a large body. */
const GENERATE_BODY_LIMIT = 64 * 1024 * 1024;

export interface ImageGenDeps {
  service: ImageGenService;
  falKeys: FalKeyStore;
  /** Cross-busy guard: a faces job also holds the GPU (§decision #4). */
  isFacesBusy?: () => boolean;
  dataDir: string;
}

/**
 * /imagegen HTTP routes (mirror of coreClient §Image Lab). Art is served
 * server-relative at /imagegen/art/<file>; the client absolutizes it. Files are
 * write-once, so the art route uses an immutable long cache (no ETag machinery).
 */
export function registerImageGenRoutes(app: FastifyInstance, deps: ImageGenDeps): void {
  const { service, falKeys } = deps;

  app.get("/imagegen/models", async () => service.listModels());

  app.post<{ Body: unknown }>(
    "/imagegen/generate",
    { bodyLimit: GENERATE_BODY_LIMIT },
    async (req, reply) => {
      if (service.isBusy() || deps.isFacesBusy?.()) {
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
        return service.generate(input);
      } catch (err) {
        if (err instanceof ImageGenValidationError) {
          return reply.code(422).send({ error: err.message });
        }
        if (err instanceof ImageGenBusyError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>("/imagegen/jobs/:id", async (req, reply) => {
    const status = service.job(req.params.id);
    if (!status) return reply.code(404).send({ error: "job not found" });
    return status;
  });

  app.post<{ Params: { id: string } }>("/imagegen/jobs/:id/cancel", async (req, reply) => {
    service.cancel(req.params.id);
    return reply.code(204).send();
  });

  app.get("/imagegen/history", async () => service.history());

  app.delete<{ Params: { id: string } }>("/imagegen/history/:id", async (req, reply) => {
    if (!service.deleteHistory(req.params.id)) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.code(204).send();
  });

  /* --------------------------- static art serving ------------------------- */
  // Write-once files (one per job id, never overwritten) → immutable long cache.
  app.get<{ Params: { file: string } }>("/imagegen/art/:file", async (req, reply) => {
    const { file } = req.params;
    if (!SAFE_IMAGEGEN_FILE.test(file)) return reply.code(404).send({ error: "not found" });
    const path = join(imagegenRoot(deps.dataDir), file);
    if (!existsSync(path)) return reply.code(404).send({ error: "not found" });
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.type("image/png").send(readFileSync(path));
  });

  /* ------------------------------- fal key -------------------------------- */
  // Mirror of /models/keys/anthropic: the raw key is write-only, returned only
  // as presence/state + a mask. fal has no cheap validation ping.
  app.get("/imagegen/keys/fal", async () => keyStatus(falKeys));

  app.put<{ Body: { apiKey?: string } }>("/imagegen/keys/fal", async (req, reply) => {
    const apiKey = (req.body?.apiKey ?? "").trim();
    if (!apiKey) return reply.code(400).send({ error: "apiKey is required" });
    falKeys.setKey(apiKey);
    return keyStatus(falKeys);
  });

  app.delete("/imagegen/keys/fal", async (_req, reply) => {
    falKeys.clear();
    return reply.code(204).send();
  });
}

function keyStatus(falKeys: FalKeyStore): { keyState: ApiKeyState; keyMask?: string } {
  const keyState = falKeys.getState();
  const mask = falKeys.getMask();
  return mask ? { keyState, keyMask: mask } : { keyState };
}
