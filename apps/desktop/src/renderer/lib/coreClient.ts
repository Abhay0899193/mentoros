/**
 * coreClient — the single typed seam between the renderer and the core server.
 *
 * OWNED BY THE LEAD AGENT: implement, do not redesign. No `electron` import is
 * permitted in the renderer; the client speaks plain HTTP/WS so the same code
 * runs in the desktop shell today and a browser/mobile shell later (plan.md §2.2).
 */

const DEFAULT_CORE_PORT = 4820;
const RECONNECT_DELAY_MS = 1000;

export interface CoreHealth {
  ok: true;
  version: string;
  uptimeMs: number;
}

export interface CoreEvents {
  "core.status": { state: "starting" | "ready" | "degraded"; detail?: string };
}

export interface CoreClient {
  health(): Promise<CoreHealth>;
  on<E extends keyof CoreEvents>(
    event: E,
    cb: (payload: CoreEvents[E]) => void,
  ): () => void;
  readonly baseUrl: string;
}

function resolveCorePort(): number {
  try {
    const raw = new URLSearchParams(window.location.search).get("corePort");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CORE_PORT;
  } catch {
    return DEFAULT_CORE_PORT;
  }
}

type Listener = (payload: CoreEvents[keyof CoreEvents]) => void;

export function createCoreClient(): CoreClient {
  const port = resolveCorePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/events`;

  const listeners = new Map<keyof CoreEvents, Set<Listener>>();
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function emit(event: keyof CoreEvents, payload: unknown): void {
    const set = listeners.get(event);
    if (!set) return;
    for (const cb of set) cb(payload as CoreEvents[keyof CoreEvents]);
  }

  function connect(): void {
    if (closed) return;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          event?: keyof CoreEvents;
          payload?: unknown;
        };
        if (msg.event && listeners.has(msg.event)) {
          emit(msg.event, msg.payload);
        }
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => socket?.close());
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  connect();

  return {
    baseUrl,

    async health(): Promise<CoreHealth> {
      const res = await fetch(`${baseUrl}/health`);
      if (!res.ok) {
        throw new Error(`core health failed: ${res.status}`);
      }
      return (await res.json()) as CoreHealth;
    },

    on(event, cb) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb as Listener);
      return () => {
        set?.delete(cb as Listener);
      };
    },
  };
}
