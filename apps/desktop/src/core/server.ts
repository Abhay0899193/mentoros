import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";

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

/** A structured `core.status` event mirrored in the renderer's coreClient. */
type CoreStatus = {
  state: "starting" | "ready" | "degraded";
  detail?: string;
};

function buildServer(startedAt: number): FastifyInstance {
  const app = Fastify({ logger: false });

  void app.register(websocket);

  // Renderer origins only: Vite dev server and the packaged file:// page
  // (which sends Origin: null). The server already binds to loopback.
  void app.register(cors, {
    origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, "null"],
  });

  app.get("/health", async () => ({
    ok: true as const,
    version: CORE_VERSION,
    uptimeMs: Date.now() - startedAt,
  }));

  void app.register(async (instance) => {
    instance.get("/events", { websocket: true }, (socket) => {
      const status: CoreStatus = { state: "ready" };
      socket.send(JSON.stringify({ event: "core.status", payload: status }));
    });
  });

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
 * {@link DEFAULT_CORE_PORT} if the preferred port is taken.
 */
export async function startCore(
  preferredPort: number = DEFAULT_CORE_PORT,
): Promise<CoreHandle> {
  const startedAt = Date.now();

  for (let offset = 0; offset < MAX_PORT_SCAN; offset += 1) {
    const port = preferredPort + offset;
    const app = buildServer(startedAt);
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
