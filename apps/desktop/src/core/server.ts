import type { WebSocket } from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { ChatEngine } from "./chat.js";
import { defaultDataDir, Store } from "./db.js";
import { createMemorySystem } from "./memory/index.js";
import { registerMemoryRoutes } from "./memory/routes.js";
import {
  DEFAULT_MODEL,
  modelStatus as probeModelStatus,
  pullModel,
} from "./ollama.js";
import { registerVoice } from "./voice/index.js";
import type { CoreEvents, Persona } from "./types.js";

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

const PERSONAS: readonly Persona[] = [
  "staff-engineer",
  "interviewer",
  "teacher",
  "architect",
];

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

  const memory = createMemorySystem(dataDir, broadcast);
  const engine = new ChatEngine(store, broadcast, memory.engine);

  void app.register(websocket);
  void app.register(cors, {
    origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, "null"],
  });

  app.addHook("onClose", async () => {
    memory.close();
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
  app.post<{ Body: { threadId?: string; content?: string; persona?: Persona } }>(
    "/chat",
    async (req, reply) => {
      const { threadId, content, persona } = req.body ?? {};
      if (!threadId || !store.threadExists(threadId)) {
        return reply.code(404).send({ error: "thread not found" });
      }
      if (!content || content.trim().length === 0) {
        return reply.code(400).send({ error: "content is required" });
      }
      const resolvedPersona: Persona = PERSONAS.includes(persona as Persona)
        ? (persona as Persona)
        : "staff-engineer";

      const user = store.addUserMessage(threadId, content, resolvedPersona);
      const assistant = store.addAssistantPlaceholder(threadId, resolvedPersona);
      // Respond immediately; tokens/status arrive over the /events websocket.
      engine.start(assistant, resolvedPersona, content);
      return { userMessageId: user.id, assistantMessageId: assistant.id };
    },
  );

  app.post<{ Params: { messageId: string } }>(
    "/chat/:messageId/stop",
    async (req, reply) => {
      engine.stop(req.params.messageId);
      return reply.code(204).send();
    },
  );

  /* -------------------------------- models ------------------------------- */
  app.get("/models/status", async () => probeModelStatus(DEFAULT_MODEL));

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
  registerMemoryRoutes(app, { engine: memory.engine, broadcast });

  /* -------------------------------- voice -------------------------------- */
  registerVoice(app, { broadcast, dataDir });

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
