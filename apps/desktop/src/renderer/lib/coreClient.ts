/**
 * coreClient — the single typed seam between the renderer and the core server.
 *
 * OWNED BY THE LEAD AGENT: this file defines the frontend↔core contract.
 * No `electron` import is permitted in the renderer; the client speaks plain
 * HTTP/WS so the same code runs in the desktop shell today and a browser or
 * mobile shell later (plan.md §2.2). Core implements the mirror of these
 * routes/events in src/core — implement against this file, do not redesign it.
 */

const DEFAULT_CORE_PORT = 4820;
const RECONNECT_DELAY_MS = 1000;

export interface CoreHealth {
  ok: true;
  version: string;
  uptimeMs: number;
}

/* ---------------- Chat (Stage 1b) ---------------- */

export type Persona = 'staff-engineer' | 'interviewer' | 'teacher' | 'architect';

/**
 * Teaching posture (§3.0.6): assistant answers stream as typed segments so the
 * UI can gate them behind the disclosure ladder. Core parses the model output
 * into segments; the renderer never sees raw section markers.
 */
export type Segment = 'prose' | 'hint1' | 'hint2' | 'approach' | 'solution';

export interface SegmentBlock {
  segment: Segment;
  content: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string; // ISO
  messageCount: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  persona?: Persona;
  createdAt: string; // ISO
  segments: SegmentBlock[];
}

export interface ModelStatus {
  state: 'ready' | 'ollama-offline' | 'model-missing';
  model: string;
}

export type ChatPhase = 'thinking' | 'drafting' | 'done' | 'error' | 'stopped';

export interface CoreEvents {
  'core.status': { state: 'starting' | 'ready' | 'degraded'; detail?: string };
  /** One streamed token for an in-flight assistant message. */
  'chat.token': { messageId: string; threadId: string; segment: Segment; token: string };
  /** Generation lifecycle. `thinking` = request sent, `drafting` = first token seen. */
  'chat.status': { messageId: string; threadId: string; phase: ChatPhase; error?: string };
  /** Model pull progress (for the "model not pulled" degraded state). */
  'models.pull': {
    model: string;
    completedBytes: number;
    totalBytes: number;
    done: boolean;
    error?: string;
  };
}

export interface CoreClient {
  readonly baseUrl: string;
  health(): Promise<CoreHealth>;
  on<E extends keyof CoreEvents>(event: E, cb: (payload: CoreEvents[E]) => void): () => void;

  /* chat */
  listThreads(): Promise<ThreadSummary[]>;
  createThread(title?: string): Promise<ThreadSummary>;
  deleteThread(threadId: string): Promise<void>;
  getMessages(threadId: string): Promise<ChatMessage[]>;
  /**
   * Persists the user message and starts generation. Resolves immediately with
   * both message ids; tokens arrive via `chat.token` / `chat.status` events.
   */
  sendMessage(
    threadId: string,
    content: string,
    persona: Persona,
  ): Promise<{ userMessageId: string; assistantMessageId: string }>;
  stopGeneration(messageId: string): Promise<void>;
  modelStatus(): Promise<ModelStatus>;
  /** Starts a pull of the default (or given) model; progress via `models.pull`. */
  pullModel(model?: string): Promise<void>;
}

function resolveCorePort(): number {
  try {
    const raw = new URLSearchParams(window.location.search).get('corePort');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CORE_PORT;
  } catch {
    return DEFAULT_CORE_PORT;
  }
}

type Listener = (payload: CoreEvents[keyof CoreEvents]) => void;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`core request failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export function createCoreClient(): CoreClient {
  const port = resolveCorePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/events`;

  const listeners = new Map<keyof CoreEvents, Set<Listener>>();
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const closed = false;

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

    socket.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { event?: keyof CoreEvents; payload?: unknown };
        if (msg.event) emit(msg.event, msg.payload);
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => socket?.close());
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  connect();

  const get = <T>(path: string) => fetch(`${baseUrl}${path}`).then((r) => json<T>(r));
  const post = <T>(path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => json<T>(r));

  return {
    baseUrl,

    health: () => get<CoreHealth>('/health'),

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

    listThreads: () => get<ThreadSummary[]>('/threads'),
    createThread: (title) => post<ThreadSummary>('/threads', { title }),
    deleteThread: (threadId) =>
      fetch(`${baseUrl}/threads/${threadId}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    getMessages: (threadId) => get<ChatMessage[]>(`/threads/${threadId}/messages`),
    sendMessage: (threadId, content, persona) =>
      post<{ userMessageId: string; assistantMessageId: string }>('/chat', {
        threadId,
        content,
        persona,
      }),
    stopGeneration: (messageId) => post<void>(`/chat/${messageId}/stop`),
    modelStatus: () => get<ModelStatus>('/models/status'),
    pullModel: (model) => post<void>('/models/pull', { model }),
  };
}

/** Shared singleton — one WS connection for the whole renderer. */
export const coreClient: CoreClient = createCoreClient();
