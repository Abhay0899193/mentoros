import type { FastifyInstance } from "fastify";
import { DEFAULT_MODEL, listLocalModels } from "../ollama.js";
import type { ModelSurface, ProvidersInfo } from "../types.js";
import { CLOUD_CATALOG, validateAnthropicKey } from "./anthropic.js";
import { maskAnthropicKey } from "./keys.js";
import type { KeyStore } from "./keys.js";
import type { ModelRouter } from "./router.js";

const SURFACES = new Set<string>(["chat", "voice", "interviewer", "scorecard"]);

export interface ModelRoutesDeps {
  router: ModelRouter;
  keys: KeyStore;
}

/**
 * Provider + key + status routes (§2.4). The raw key is write-only: it never
 * leaves the process except as a mask. GET /models/status stays
 * backward-compatible (state, model) so the existing chat banner keeps working.
 */
export function registerModelRoutes(app: FastifyInstance, deps: ModelRoutesDeps): void {
  const { router, keys } = deps;

  app.get("/models/providers", async (): Promise<ProvidersInfo> => {
    const ollama = await listLocalModels();
    const anthropic: ProvidersInfo["anthropic"] = {
      keyState: keys.getState(),
      catalog: CLOUD_CATALOG,
    };
    const mask = keys.getMask();
    if (mask) anthropic.keyMask = mask;
    const err = keys.getError();
    if (err) anthropic.keyError = err;
    return {
      ollama: { reachable: ollama.reachable, models: ollama.models, defaultModel: DEFAULT_MODEL },
      anthropic,
    };
  });

  app.put<{ Body: { apiKey?: string } }>("/models/keys/anthropic", async (req, reply) => {
    const apiKey = (req.body?.apiKey ?? "").trim();
    if (!apiKey) return reply.code(400).send({ error: "apiKey is required" });
    const { keyState, keyError } = await validateAnthropicKey(apiKey);
    keys.setKey(apiKey, keyState, keyError);
    const out: { keyState: typeof keyState; keyMask: string; keyError?: string } = {
      keyState,
      keyMask: maskAnthropicKey(apiKey),
    };
    if (keyError) out.keyError = keyError;
    return out;
  });

  app.delete("/models/keys/anthropic", async (_req, reply) => {
    keys.clear();
    return reply.code(204).send();
  });

  app.get<{ Querystring: { surface?: string } }>("/models/status", async (req) => {
    const raw = req.query?.surface;
    const surface: ModelSurface = raw && SURFACES.has(raw) ? (raw as ModelSurface) : "chat";
    return router.status(surface);
  });
}
