import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppSettings, CoreEvents } from "../types.js";
import { FaceService } from "./service.js";
import { FaceBusyError, FaceForbiddenError, FaceNotFoundError } from "./store.js";
import { presetDir, SAFE_ART_FILE, SAFE_PRESET_ID } from "./paths.js";
import { FaceValidationError, validateCreateInput, type ImageProbe } from "./validate.js";

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

export interface FaceDeps {
  service: FaceService;
  broadcast: Broadcast;
  /** Portrait dimension probe (validation) — injectable for tests. */
  probe: ImageProbe;
  /** Current settings, for the settings.changed carried by a mentorFace reset. */
  getSettings: () => AppSettings;
  dataDir: string;
}

/**
 * /faces HTTP routes (mirror of coreClient §custom face presets). Art is served
 * server-relative at /faces/art/<id>/<file>; the client absolutizes it.
 */
export function registerFaceRoutes(app: FastifyInstance, deps: FaceDeps): void {
  const { service, broadcast } = deps;

  app.get("/faces/toolchain", async () => service.toolchain());

  app.get("/faces/custom", async () => service.listCustom());

  app.post<{ Body: unknown }>("/faces/custom", async (req, reply) => {
    if (service.isBusy()) {
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
  app.get<{ Params: { presetId: string; file: string } }>(
    "/faces/art/:presetId/:file",
    async (req, reply) => {
      const { presetId, file } = req.params;
      if (!SAFE_PRESET_ID.test(presetId) || !SAFE_ART_FILE.test(file)) {
        return reply.code(404).send({ error: "not found" });
      }
      const path = join(presetDir(deps.dataDir, presetId), file);
      if (!existsSync(path)) return reply.code(404).send({ error: "not found" });
      return reply
        .type("image/webp")
        .header("cache-control", "public, max-age=3600")
        .send(readFileSync(path));
    },
  );
}
