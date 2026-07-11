import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppSettings, CoreEvents } from "../types.js";
import { FaceService } from "./service.js";
import { FaceBusyError, FaceForbiddenError, FaceNotFoundError } from "./store.js";
import { presetDir, SAFE_ART_FILE, SAFE_PRESET_ID } from "./paths.js";
import { FaceValidationError, validateCreateInput, type ImageProbe } from "./validate.js";
import {
  validateAddExpressionInput,
  validateConfigUpdate,
  validateGenerateInput,
  validateManualInput,
} from "./config.js";
import { serializeCatalog } from "./catalog.js";

/** Manual create / editor save carry base64 webp frames — allow a large body. */
const MANUAL_BODY_LIMIT = 128 * 1024 * 1024;
/** Generate carries an optional base candidate data URI — allow a large body. */
const GENERATE_BODY_LIMIT = 64 * 1024 * 1024;

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

export interface FaceDeps {
  service: FaceService;
  broadcast: Broadcast;
  /** Portrait dimension probe (validation) — injectable for tests. */
  probe: ImageProbe;
  /** Current settings, for the settings.changed carried by a mentorFace reset. */
  getSettings: () => AppSettings;
  /** Cross-busy guard: an Image Lab job also holds the GPU (§decision #4). */
  isImageGenBusy?: () => boolean;
  /** Cross-busy guard: a Video Lab job also holds the GPU (§three-way busy). */
  isVideoGenBusy?: () => boolean;
  dataDir: string;
}

/**
 * /faces HTTP routes (mirror of coreClient §custom face presets). Art is served
 * server-relative at /faces/art/<id>/<file>; the client absolutizes it.
 */
export function registerFaceRoutes(app: FastifyInstance, deps: FaceDeps): void {
  const { service, broadcast } = deps;

  app.get("/faces/toolchain", async () => service.toolchain());

  app.get("/faces/catalog", async () => serializeCatalog());

  app.get("/faces/custom", async () => service.listCustom());

  /* ---------------------- Preset Generator (t2i) -------------------------- */
  // Cross-busy: faces + Image Lab jobs each spawn mflux (~11 GB peak), so a
  // running Image Lab job blocks generate/expressions (and vice versa).
  app.post<{ Body: unknown }>(
    "/faces/custom/generate",
    { bodyLimit: GENERATE_BODY_LIMIT },
    async (req, reply) => {
      if (service.isBusy() || deps.isImageGenBusy?.() || deps.isVideoGenBusy?.()) {
        return reply.code(409).send({ error: "a generation is already running" });
      }
      const toolchain = service.generateToolchain();
      if (toolchain.state !== "ready") {
        return reply
          .code(503)
          .send({ error: "image toolchain unavailable", detail: toolchain.detail ?? "toolchain missing" });
      }
      try {
        const input = validateGenerateInput(req.body);
        const job = service.startGenerate(input);
        return { job };
      } catch (err) {
        if (err instanceof FaceValidationError) return reply.code(422).send({ error: err.message });
        if (err instanceof FaceBusyError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/faces/custom/:id/expressions",
    { bodyLimit: GENERATE_BODY_LIMIT },
    async (req, reply) => {
      if (service.isBusy() || deps.isImageGenBusy?.() || deps.isVideoGenBusy?.()) {
        return reply.code(409).send({ error: "a generation is already running" });
      }
      const toolchain = service.generateToolchain();
      if (toolchain.state !== "ready") {
        return reply
          .code(503)
          .send({ error: "image toolchain unavailable", detail: toolchain.detail ?? "toolchain missing" });
      }
      try {
        const input = validateAddExpressionInput(req.body);
        const job = service.startAddExpression(req.params.id, input);
        return { job };
      } catch (err) {
        if (err instanceof FaceValidationError) return reply.code(422).send({ error: err.message });
        if (err instanceof FaceForbiddenError) return reply.code(403).send({ error: err.message });
        if (err instanceof FaceNotFoundError) return reply.code(404).send({ error: err.message });
        if (err instanceof FaceBusyError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.post<{ Body: unknown }>("/faces/custom", async (req, reply) => {
    if (service.isBusy() || deps.isVideoGenBusy?.()) {
      return reply.code(409).send({ error: "a preset is already generating" });
    }
    const toolchain = service.toolchain();
    if (toolchain.state !== "ready") {
      return reply
        .code(503)
        .send({ error: "image toolchain unavailable", detail: toolchain.detail ?? "toolchain missing" });
    }
    try {
      const { input, portraitDims } = validateCreateInput(req.body, deps.probe);
      const job = service.start(input, portraitDims);
      return { job };
    } catch (err) {
      if (err instanceof FaceValidationError) {
        return reply.code(422).send({ error: err.message });
      }
      if (err instanceof FaceBusyError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Body: unknown }>(
    "/faces/custom/manual",
    { bodyLimit: MANUAL_BODY_LIMIT },
    async (req, reply) => {
      try {
        const input = validateManualInput(req.body);
        const preset = service.createManual(input);
        broadcast("faces.changed", { presets: service.listCustom() });
        return preset;
      } catch (err) {
        if (err instanceof FaceValidationError) {
          return reply.code(422).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/faces/custom/:id/config",
    { bodyLimit: MANUAL_BODY_LIMIT },
    async (req, reply) => {
      try {
        const input = validateConfigUpdate(req.body);
        const preset = service.updateConfig(req.params.id, input);
        broadcast("faces.changed", { presets: service.listCustom() });
        return preset;
      } catch (err) {
        if (err instanceof FaceValidationError) {
          return reply.code(422).send({ error: err.message });
        }
        if (err instanceof FaceForbiddenError) {
          return reply.code(403).send({ error: err.message });
        }
        if (err instanceof FaceNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get("/faces/jobs/active", async () => service.activeJob());

  app.post<{ Params: { id: string } }>("/faces/jobs/:id/cancel", async (req, reply) => {
    service.cancel(req.params.id);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/faces/custom/:id", async (req, reply) => {
    try {
      const { mentorFaceReset } = service.deletePreset(req.params.id);
      if (mentorFaceReset) {
        broadcast("settings.changed", { settings: deps.getSettings() });
      }
      broadcast("faces.changed", { presets: service.listCustom() });
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof FaceForbiddenError) {
        return reply.code(403).send({ error: err.message });
      }
      if (err instanceof FaceNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  /* --------------------------- static art serving ------------------------- */
  // no-cache + ETag (not max-age): preset ids reuse freed slugs and frame files
  // are overwritten in place, so a time-based cache serves a deleted preset's
  // frames at the recreated preset's URLs. Revalidation keeps the fast path
  // (304 on localhost) without ever showing stale art.
  app.get<{ Params: { presetId: string; file: string } }>(
    "/faces/art/:presetId/:file",
    async (req, reply) => {
      const { presetId, file } = req.params;
      if (!SAFE_PRESET_ID.test(presetId) || !SAFE_ART_FILE.test(file)) {
        return reply.code(404).send({ error: "not found" });
      }
      const path = join(presetDir(deps.dataDir, presetId), file);
      if (!existsSync(path)) return reply.code(404).send({ error: "not found" });
      const stat = statSync(path);
      const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
      reply.header("cache-control", "no-cache").header("etag", etag);
      if (req.headers["if-none-match"] === etag) return reply.code(304).send();
      return reply.type("image/webp").send(readFileSync(path));
    },
  );
}
