import type { WebSocket } from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { ChatEngine } from "./chat.js";
import { defaultDataDir, Store } from "./db.js";
import { createMemorySystem } from "./memory/index.js";
import { registerMemoryRoutes } from "./memory/routes.js";
import { createLearningSystem, import3mc } from "./learning/index.js";
import { registerLearningRoutes } from "./learning/routes.js";
import { createKbSystem } from "./kb/index.js";
import { registerKbRoutes } from "./kb/routes.js";
import { createInterviewSystem } from "./interview/index.js";
import { registerInterviewRoutes } from "./interview/routes.js";
import { createSettingsSystem } from "./settings/index.js";
import { registerSettingsRoutes } from "./settings/routes.js";
import { createLlmSystem } from "./llm/index.js";
import { registerModelRoutes } from "./llm/routes.js";
import { DEFAULT_MODEL, pullModel } from "./ollama.js";
import { registerVoice } from "./voice/index.js";
import {
  createPersonaSystem,
  registerPersonaRoutes,
  type PersonaDraftOnce,
} from "./personas/index.js";
import { createFaceSystem, registerFaceRoutes, sipsProbe } from "./faces/index.js";
import { createImageGenSystem, registerImageGenRoutes } from "./imagegen/index.js";
import type { CoreEvents, ModelSurface, Persona } from "./types.js";

/**
 * MentorOS core server.
 *
 * Framework-agnostic: this module MUST NOT import `electron` (directly or
 * transitively). It is the single seam the renderer talks to via HTTP/WS, which
 * keeps the future web/mobile/SaaS path open (plan.md §2.2).
 */

export const CORE_VERSION = "0.0.0";
export const DEFAULT_CORE_PORT = 4820;
const HOST = "127.0.0.1";
const MAX_PORT_SCAN = 32;

export interface CoreHandle {
  readonly port: number;
  stop(): Promise<void>;
}

export interface StartCoreOptions {
  preferredPort?: number;
  dataDir?: string;
}

function buildServer(startedAt: number, dataDir: string): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new Store(dataDir);

  const sockets = new Set<WebSocket>();
  const broadcast = <E extends keyof CoreEvents>(
    event: E,
    payload: CoreEvents[E],
  ): void => {
    const frame = JSON.stringify({ event, payload });
    for (const socket of sockets) {
      try {
        socket.send(frame);
      } catch {
        /* socket mid-teardown; the close handler will evict it */
      }
    }
  };

  const settings = createSettingsSystem(dataDir);
  const llm = createLlmSystem(dataDir, settings.store);
  const memory = createMemorySystem(dataDir, broadcast);
  const learning = createLearningSystem(dataDir, memory.engine);
  const kb = createKbSystem(dataDir, broadcast);
  const interview = createInterviewSystem(dataDir, broadcast, memory.engine, llm.router);
  // Personas: deleting the active custom persona resets settings.activePersona,
  // so the store gets the settings store; settings, in turn, consults the store
  // to validate/activate personas (wired after both exist).
  const personas = createPersonaSystem(dataDir, settings.store);
  settings.store.setPersonaLookup(personas.store);
  // Custom faces: settings + personas validate mentorFace against custom ids too;
  // deleting the active custom preset resets settings.mentorFace to 'aura'.
  const faces = createFaceSystem(dataDir, broadcast, settings.store);
  settings.store.setFaceLookup(faces.store);
  personas.store.setFaceLookup(faces.store);
  const imagegen = createImageGenSystem(dataDir);
  const engine = new ChatEngine(
    store,
    broadcast,
    llm.router,
    memory.engine,
    kb.engine,
    personas.store,
  );

  void app.register(websocket);
  void app.register(cors, {
    origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, "null"],
    // @fastify/cors defaults to CORS-safelisted methods only (GET/HEAD/POST) —
    // DELETE/PUT/PATCH preflights fail without an explicit list.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });

  app.addHook("onClose", async () => {
    imagegen.close();
    faces.close();
    personas.close();
    interview.close();
    kb.close();
    learning.close();
    memory.close();
    llm.close();
    settings.close();
    store.close();
  });

  app.get("/health", async () => ({
    ok: true as const,
    version: CORE_VERSION,
    uptimeMs: Date.now() - startedAt,
  }));

  /* ------------------------------- events -------------------------------- */
  void app.register(async (instance) => {
    instance.get("/events", { websocket: true }, (socket) => {
      sockets.add(socket);
      socket.send(
        JSON.stringify({
          event: "core.status",
          payload: { state: "ready" } satisfies CoreEvents["core.status"],
        }),
      );
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => sockets.delete(socket));
    });
  });

  /* ------------------------------- threads ------------------------------- */
  app.get("/threads", async () => store.listThreads());

  app.post<{ Body: { title?: string } }>("/threads", async (req) =>
    store.createThread(req.body?.title),
  );

  app.delete<{ Params: { id: string } }>("/threads/:id", async (req, reply) => {
    store.deleteThread(req.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>(
    "/threads/:id/messages",
    async (req, reply) => {
      if (!store.threadExists(req.params.id)) {
        return reply.code(404).send({ error: "thread not found" });
      }
      return store.getMessages(req.params.id);
    },
  );

  /* -------------------------------- chat --------------------------------- */
  app.post<{
    Body: { threadId?: string; content?: string; persona?: Persona; surface?: ModelSurface };
  }>("/chat", async (req, reply) => {
    const { threadId, content, persona, surface } = req.body ?? {};
    if (!threadId || !store.threadExists(threadId)) {
      return reply.code(404).send({ error: "thread not found" });
    }
    if (!content || content.trim().length === 0) {
      return reply.code(400).send({ error: "content is required" });
    }
    // Accept any persona id; blurb resolution (unknown → staff-engineer) happens
    // in the personas module via systemPrompt, so a stale chip never 500s.
    const resolvedPersona: Persona =
      typeof persona === "string" && persona.trim().length > 0
        ? persona
        : "staff-engineer";
    // The Voice screen rides /chat with surface:'voice'; everything else is chat.
    const resolvedSurface: "chat" | "voice" = surface === "voice" ? "voice" : "chat";

    const user = store.addUserMessage(threadId, content, resolvedPersona);
    const assistant = store.addAssistantPlaceholder(threadId, resolvedPersona);
    // Respond immediately; tokens/status arrive over the /events websocket.
    engine.start(assistant, resolvedPersona, content, resolvedSurface);
    return { userMessageId: user.id, assistantMessageId: assistant.id };
  });

  app.post<{ Params: { messageId: string } }>(
    "/chat/:messageId/stop",
    async (req, reply) => {
      engine.stop(req.params.messageId);
      return reply.code(204).send();
    },
  );

  /* -------------------------------- models ------------------------------- */
  // /models/status (per-surface), /models/providers, /models/keys/anthropic.
  registerModelRoutes(app, { router: llm.router, keys: llm.keys });

  app.post<{ Body: { model?: string } }>("/models/pull", async (req, reply) => {
    const model = req.body?.model?.trim() || DEFAULT_MODEL;
    void pullModel(model, (p) => {
      broadcast("models.pull", {
        model,
        completedBytes: p.completedBytes,
        totalBytes: p.totalBytes,
        done: p.done,
        ...(p.error ? { error: p.error } : {}),
      });
    });
    return reply.code(202).send({ model });
  });

  /* -------------------------------- memory ------------------------------- */
  registerMemoryRoutes(app, {
    engine: memory.engine,
    broadcast,
    import3mc: (path, onProgress) =>
      import3mc({ path, store: learning.store, onProgress }),
  });

  /* ------------------------------- learning ------------------------------ */
  registerLearningRoutes(app, { engine: learning.engine, broadcast });

  /* ---------------------------- knowledge base --------------------------- */
  registerKbRoutes(app, { engine: kb.engine });

  /* ------------------------------ interview ------------------------------ */
  registerInterviewRoutes(app, { engine: interview.engine });

  /* ------------------------------ settings ------------------------------- */
  registerSettingsRoutes(app, { store: settings.store, broadcast });

  /* ------------------------------ personas ------------------------------- */
  const personaDraftOnce: PersonaDraftOnce = (o) =>
    llm.router.once({
      surface: "scorecard",
      messages: o.messages,
      ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
      ...(o.format ? { format: o.format } : {}),
    });
  registerPersonaRoutes(app, {
    store: personas.store,
    broadcast,
    draftOnce: personaDraftOnce,
    getSettings: () => settings.store.get(),
  });

  /* ------------------------------ custom faces --------------------------- */
  registerFaceRoutes(app, {
    service: faces.service,
    broadcast,
    probe: sipsProbe,
    getSettings: () => settings.store.get(),
    dataDir,
  });

  /* ------------------------------- image lab ----------------------------- */
  registerImageGenRoutes(app, {
    service: imagegen.service,
    falKeys: imagegen.keys,
    dataDir,
  });

  /* -------------------------------- voice -------------------------------- */
  registerVoice(app, { broadcast, dataDir, getSettings: () => settings.store.get() });

  return app;
}

function isAddressInUse(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "EADDRINUSE"
  );
}

/**
 * Starts the core server on 127.0.0.1, scanning upward from
 * {@link DEFAULT_CORE_PORT} if the preferred port is taken. Accepts either a
 * bare port (legacy) or an options object.
 */
export async function startCore(
  opts: StartCoreOptions | number = {},
): Promise<CoreHandle> {
  const options: StartCoreOptions =
    typeof opts === "number" ? { preferredPort: opts } : opts;
  const preferredPort = options.preferredPort ?? DEFAULT_CORE_PORT;
  const dataDir = options.dataDir ?? defaultDataDir();
  const startedAt = Date.now();

  for (let offset = 0; offset < MAX_PORT_SCAN; offset += 1) {
    const port = preferredPort + offset;
    const app = buildServer(startedAt, dataDir);
    try {
      await app.listen({ host: HOST, port });
      return {
        port,
        async stop() {
          await app.close();
        },
      };
    } catch (err) {
      await app.close().catch(() => undefined);
      if (isAddressInUse(err)) continue;
      throw err;
    }
  }

  throw new Error(
    `core: no free port in [${preferredPort}, ${preferredPort + MAX_PORT_SCAN})`,
  );
}
