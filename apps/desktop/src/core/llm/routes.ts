import type { FastifyInstance } from "fastify";
import { DEFAULT_MODEL, listLocalModels } from "../ollama.js";
import type { CustomEndpointInfo, ModelSurface, ProvidersInfo } from "../types.js";
import {
  CLOUD_CATALOG,
  listAnthropicModels,
  validateAnthropicKey,
} from "./anthropic.js";
import { EndpointValidationError, type EndpointConfig, type EndpointStore } from "./endpoints.js";
import { maskAnthropicKey } from "./keys.js";
import type { KeyStore } from "./keys.js";
import { listOpenAiModels } from "./openai.js";
import type { ModelRouter } from "./router.js";

const SURFACES = new Set<string>(["chat", "voice", "interviewer", "scorecard", "guide"]);

export interface ModelRoutesDeps {
  router: ModelRouter;
  keys: KeyStore;
  endpoints: EndpointStore;
}

/** Config → wire shape: attach the token mask, never the token itself. */
function toEndpointInfo(cfg: EndpointConfig, keys: KeyStore): CustomEndpointInfo {
  const mask = keys.endpointTokenMask(cfg.id);
  return {
    id: cfg.id,
    label: cfg.label,
    kind: cfg.kind,
    baseUrl: cfg.baseUrl,
    auth: cfg.auth,
    models: cfg.models,
    ...(mask ? { tokenMask: mask } : {}),
  };
}

/** Fetch the remote model list for an endpoint by its wire protocol. */
async function fetchRemoteModels(cfg: EndpointConfig, token: string | null): Promise<string[]> {
  if (cfg.kind === "openai") {
    return listOpenAiModels({ baseUrl: cfg.baseUrl, token, auth: cfg.auth, timeoutMs: 6_000 });
  }
  return listAnthropicModels({ baseUrl: cfg.baseUrl, token, auth: cfg.auth });
}

/**
 * Provider + key + status routes (§2.4). The raw key is write-only: it never
 * leaves the process except as a mask. GET /models/status stays
 * backward-compatible (state, model) so the existing chat banner keeps working.
 */
export function registerModelRoutes(app: FastifyInstance, deps: ModelRoutesDeps): void {
  const { router, keys, endpoints } = deps;

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
      endpoints: endpoints.list().map((cfg) => toEndpointInfo(cfg, keys)),
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/models/endpoints", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    let cfg: EndpointConfig;
    try {
      cfg = endpoints.create(body);
    } catch (err) {
      if (err instanceof EndpointValidationError) return reply.code(400).send({ error: err.message });
      throw err;
    }
    // token present on create → store it (absent/empty leaves the endpoint keyless).
    const token = typeof body.token === "string" ? body.token : "";
    if (token) keys.setEndpointToken(cfg.id, token);
    return reply.code(201).send({ endpoint: toEndpointInfo(cfg, keys) });
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/models/endpoints/:id",
    async (req, reply) => {
      const { id } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      // token semantics: field absent = keep, '' = clear, non-empty = set.
      const { token, ...config } = body;
      let cfg: EndpointConfig | null;
      try {
        cfg = endpoints.update(id, config);
      } catch (err) {
        if (err instanceof EndpointValidationError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      if (!cfg) return reply.code(404).send({ error: "endpoint not found" });
      if (typeof token === "string") {
        if (token) keys.setEndpointToken(id, token);
        else keys.clearEndpointToken(id);
      }
      return { endpoint: toEndpointInfo(cfg, keys) };
    },
  );

  app.delete<{ Params: { id: string } }>("/models/endpoints/:id", async (req, reply) => {
    keys.clearEndpointToken(req.params.id);
    endpoints.delete(req.params.id);
    // Surfaces still pointing at this endpoint just fall back at resolve time — no
    // settings scrubbing needed.
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/models/endpoints/:id/models", async (req, reply) => {
    const cfg = endpoints.get(req.params.id);
    if (!cfg) return reply.code(404).send({ error: "endpoint not found" });
    try {
      const models = await fetchRemoteModels(cfg, keys.getEndpointToken(cfg.id));
      return { models };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "fetch failed" });
    }
  });

  app.post<{ Params: { id: string } }>("/models/endpoints/:id/test", async (req, reply) => {
    const cfg = endpoints.get(req.params.id);
    if (!cfg) return reply.code(404).send({ error: "endpoint not found" });
    try {
      await fetchRemoteModels(cfg, keys.getEndpointToken(cfg.id));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "test failed" };
    }
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
