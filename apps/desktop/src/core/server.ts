import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WebSocket } from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { createNetworkSystem, registerNetwork } from "./network.js";
import { ChatEngine } from "./chat.js";
import { defaultDataDir, Store } from "./db.js";
import { createMemorySystem } from "./memory/index.js";
import { registerMemoryRoutes } from "./memory/routes.js";
import { createLearningSystem, import3mc, computeSourceDigest } from "./learning/index.js";
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
import { createVideoGenSystem, registerVideoGenRoutes } from "./videogen/index.js";
import type { CoreEvents, ModelSurface, Persona } from "./types.js";

/**
 * MentorOS core server.
 *
 * Framework-agnostic: this module MUST NOT import `electron` (directly or
 * transitively). It is the single seam the renderer talks to via HTTP/WS, which
 * keeps the future web/mobile/SaaS path open (plan.md §2.2).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CORE_VERSION = "0.0.0";
export const DEFAULT_CORE_PORT = 4820;
const MAX_PORT_SCAN = 32;

export interface CoreHandle {
  readonly port: number;
  stop(): Promise<void>;
}

export interface StartCoreOptions {
  preferredPort?: number;
  dataDir?: string;
  /** Directory of the built renderer served over LAN (defaults to ../renderer). */
  rendererDir?: string;
}

/**
 * A built (but not-yet-listening) core: the Fastify app plus the host it wants
 * to bind and a setter for the resolved port (known only after `listen`).
 */
interface BuiltServer {
  app: FastifyInstance;
  host: string;
  setResolvedPort: (port: number) => void;
  /** Fire boot auto-sync of the 3mc plan (call once, after a successful listen). */
  autoSync: () => void;
}

function buildServer(startedAt: number, dataDir: string, rendererDir: string): BuiltServer {
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
  const videogen = createVideoGenSystem(dataDir, broadcast);
  // Preset Generator hands a chosen Image Lab base candidate to a faces job by id.
  faces.service.setHistoryResolver((id) => imagegen.service.historyImagePath(id));
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

  /* ------------------------------- network ------------------------------- */
  // Registered AFTER cors and BEFORE every other route so the LAN auth hook
  // (onRequest) covers them all — including the @fastify/websocket upgrades
  // (/events, /voice) whose HTTP upgrade requests run onRequest hooks too.
  const network = createNetworkSystem(dataDir);
  const lanEnabled =
    process.env.MENTOROS_LAN === "1" || settings.store.get().lanAccess === true;
  let resolvedPort = 0;
  registerNetwork(app, {
    tokenStore: network.tokenStore,
    getPort: () => resolvedPort,
    rendererDir,
    lanEnabled,
  });

  app.addHook("onClose", async () => {
    videogen.close();
    imagegen.close();
    faces.close();
    personas.close();
    interview.close();
    kb.close();
    learning.close();
    memory.close();
    llm.close();
    settings.close();
    network.close();
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
  const memoryRoutes = registerMemoryRoutes(app, {
    engine: memory.engine,
    broadcast,
    import3mc: (path, onProgress) =>
      import3mc({
        path,
        store: learning.store,
        onProgress,
        // Quick-review skill docs land in the KB (idempotent by path hash).
        ingestSkillDoc: async (absPath, title, tags) => {
          const prepared = kb.engine.prepareSource(absPath, { title, tags });
          await kb.engine.runIngest(prepared);
          return prepared.sourceId;
        },
      }),
    // Persist the source fingerprint after a clean 3mc import so boot auto-sync
    // (below) can tell when the on-disk plan has drifted. Best-effort.
    persistImportMeta: (path) => {
      try {
        const digest = computeSourceDigest(path);
        if (digest) learning.store.writeImportMeta({ sourcePath: path, digest });
      } catch {
        /* meta persistence is best-effort — never fail an import over it */
      }
    },
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
    // Cross-busy: an Image Lab or Video Lab job holds the GPU → generate/photo/
    // expressions 409.
    isImageGenBusy: () => imagegen.service.isBusy(),
    isVideoGenBusy: () => videogen.service.isBusy(),
    dataDir,
  });

  /* ------------------------------- image lab ----------------------------- */
  registerImageGenRoutes(app, {
    service: imagegen.service,
    falKeys: imagegen.keys,
    // Cross-busy: a faces or Video Lab job holds the GPU → /imagegen/generate 409.
    isFacesBusy: () => faces.service.isBusy(),
    isVideoGenBusy: () => videogen.service.isBusy(),
    dataDir,
  });

  /* ------------------------------- video lab ----------------------------- */
  registerVideoGenRoutes(app, {
    service: videogen.service,
    // Cross-busy: an Image Lab or faces job holds the GPU → /videogen/generate 409.
    isImageGenBusy: () => imagegen.service.isBusy(),
    isFacesBusy: () => faces.service.isBusy(),
    dataDir,
  });

  /* -------------------------------- voice -------------------------------- */
  registerVoice(app, { broadcast, dataDir, getSettings: () => settings.store.get() });

  /**
   * Boot auto-sync: if the last-imported 3mc source still exists and its content
   * fingerprint has drifted, silently re-run the import through the shared runner
   * (same broadcast + job record, so a connected renderer updates and the digest
   * is re-persisted). Non-blocking and fully guarded — must never crash boot.
   */
  const autoSync = (): void => {
    void (async () => {
      try {
        const meta = learning.store.readImportMeta();
        if (!meta || !existsSync(meta.sourcePath)) return;
        const digest = computeSourceDigest(meta.sourcePath);
        if (!digest || digest === meta.digest) return;
        await memoryRoutes.run3mc(meta.sourcePath);
      } catch {
        /* auto-sync is best-effort */
      }
    })();
  };

  const host = lanEnabled ? "0.0.0.0" : "127.0.0.1";
  return {
    app,
    host,
    setResolvedPort: (port) => {
      resolvedPort = port;
    },
    autoSync,
  };
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
 * Starts the core server (loopback, or 0.0.0.0 when LAN access is enabled via
 * the persisted setting or MENTOROS_LAN=1), scanning upward from
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
  const rendererDir = options.rendererDir ?? join(__dirname, "../renderer");
  const startedAt = Date.now();

  for (let offset = 0; offset < MAX_PORT_SCAN; offset += 1) {
    const port = preferredPort + offset;
    const { app, host, setResolvedPort, autoSync } = buildServer(startedAt, dataDir, rendererDir);
    try {
      await app.listen({ host, port });
      setResolvedPort(port);
      // Only after a real bind — throwaway instances (EADDRINUSE) never sync.
      autoSync();
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
