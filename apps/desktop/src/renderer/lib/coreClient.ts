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

/* ---------------- Memory (Phase 2) ---------------- */

export type MemoryType =
  | 'identity'
  | 'goal'
  | 'skill'
  | 'learning'
  | 'project'
  | 'career'
  | 'preference'
  | 'mistake'
  | 'achievement'
  | 'repo'
  | 'meeting'
  | 'book'
  | 'research';

/**
 * One evolving fact — never a chat fragment (§2.3). Repeating a fact merges
 * into the same record via upsert-by-similarity (embed → nearest same-type →
 * cosine ≥ threshold ⇒ merge: newest body wins, old body appends to history,
 * confidence nudges up, id is stable).
 */
export interface MemoryRecord {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  confidence: number; // 0..1
  /** 'chat' | 'voice' | 'manual' | 'import:interview-prep' | 'import:3mc' */
  source: string;
  tags: string[];
  /** Related memory ids (graph edges). */
  links: string[];
  createdAt: string;
  updatedAt: string;
  history: { at: string; body: string }[];
}

export interface SaveMemoryInput {
  type: MemoryType;
  body: string;
  title?: string;
  source: string;
  tags?: string[];
  confidence?: number;
}

export interface SaveMemoryResult {
  record: MemoryRecord;
  action: 'created' | 'merged';
  similarity?: number; // set when merged
}

export interface RecallHit {
  record: MemoryRecord;
  score: number; // cosine similarity 0..1
}

export interface MemoryGraphData {
  nodes: { id: string; type: MemoryType; title: string; confidence: number }[];
  edges: { source: string; target: string }[];
}

/** Derived views over records (§2.3) — computed by core, never stored. */
export interface DerivedProfile {
  identity: { name: string; role: string } | null;
  goals: MemoryRecord[];
  strengths: MemoryRecord[];
  weaknesses: MemoryRecord[];
  stack: string[];
  reading: { title: string; percent: number | null; recordId: string }[];
  /** Mistake tally, most frequent first (count parsed from tags/body). */
  mistakes: { recordId: string; title: string; count: number; updatedAt: string }[];
  counts: Partial<Record<MemoryType, number>>;
}

export type ImportSource = 'interview-prep' | '3mc';

/* ---------------- Learning & Daily Loop (Phase 3) ---------------- */

export type TaskKind =
  | 'leetcode'
  | 'video'
  | 'article'
  | 'docs'
  | 'book'
  | 'hands-on'
  | 'course'
  | 'review'
  | 'other';

export interface LearningTask {
  id: string; // stable id from the 3mc parser (phase-n-week-w-day-d-…)
  dayId: string;
  kind: TaskKind;
  title: string;
  url?: string;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  done: boolean;
  completedAt?: string;
}

export interface LearningDay {
  id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  state: 'locked' | 'available' | 'current' | 'done';
  taskCount: number;
  doneCount: number;
}

export interface LearningWeek {
  phase: number;
  week: number;
  days: LearningDay[];
}

export interface LearningSummary {
  imported: boolean;
  totalDays: number;
  doneDays: number;
  totalTasks: number;
  doneTasks: number;
  currentDayId: string | null;
  xp: number;
  level: number;
}

export interface MissionItem {
  id: string;
  label: string;
  kind: TaskKind | 'drill';
  /** Teaching transparency: why this item — "from your plan, week 12" / "weakness: DP ×8". */
  reason: string;
  taskId?: string;
  url?: string;
  done: boolean;
}

/** Right-sized daily selection (4–5 items) — never the raw firehose of the plan. */
export interface TodayMission {
  date: string; // YYYY-MM-DD
  items: MissionItem[];
  streak: { current: number; best: number };
}

export interface ReviewItem {
  memoryId: string;
  title: string;
  due: string;
  lastGrade: number | null;
}

export interface HeatCell {
  date: string;
  count: number;
}

/* ---------------- Voice (Stage 1c) ---------------- */

export interface VoiceStatus {
  stt: 'ready' | 'missing' | 'starting' | 'error';
  tts: 'ready' | 'missing' | 'starting' | 'error';
  detail?: string;
}

/**
 * /voice WebSocket protocol (core implements the mirror):
 *  client→server  JSON  {type:'mic-start', sampleRate:16000}
 *  client→server  binary PCM16 mono chunks (mic, 16 kHz)
 *  client→server  JSON  {type:'mic-stop'} | {type:'tts-stop'}
 *  server→client  JSON  {type:'transcript', text, final}
 *  server→client  JSON  {type:'tts-start', sampleRate} → binary PCM16 chunks → {type:'tts-end'}
 *  server→client  JSON  {type:'voice-error', message}
 */
export interface VoiceChannelHandlers {
  onTranscript: (t: { text: string; final: boolean }) => void;
  onTtsStart: (sampleRate: number) => void;
  onTtsChunk: (pcm: ArrayBuffer) => void;
  onTtsEnd: () => void;
  onError: (message: string) => void;
}

export interface VoiceChannel {
  micStart: (sampleRate: number) => void;
  sendPcm: (chunk: ArrayBuffer) => void;
  micStop: () => void;
  stopTts: () => void;
  close: () => void;
}

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
  /** STT/TTS install progress (binaries + models). */
  'voice.install': {
    step: string;
    completedBytes: number;
    totalBytes: number;
    done: boolean;
    error?: string;
  };
  /** Sidecar readiness changes. */
  'voice.status': VoiceStatus;
  /** Global push-to-talk hotkey (from Electron main via core). */
  'voice.ptt': { pressed: boolean };
  /** A memory was created or merged — drives "Profile updated" moments. */
  'memory.saved': { record: MemoryRecord; action: 'created' | 'merged'; similarity?: number };
  /** What recall injected into a generation — feeds the Context panel (§4.2). */
  'chat.context': {
    threadId: string;
    messageId: string;
    memories: { id: string; type: MemoryType; title: string; score: number }[];
  };
  /** Importer progress. */
  'import.progress': {
    source: ImportSource;
    step: string;
    created: number;
    merged: number;
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

  /* memory */
  listMemories(opts?: { type?: MemoryType; q?: string; limit?: number }): Promise<MemoryRecord[]>;
  saveMemory(input: SaveMemoryInput): Promise<SaveMemoryResult>;
  updateMemory(
    id: string,
    patch: Partial<Pick<MemoryRecord, 'title' | 'body' | 'type' | 'tags' | 'confidence' | 'links'>>,
  ): Promise<MemoryRecord>;
  deleteMemory(id: string): Promise<void>;
  recall(query: string, opts?: { k?: number; types?: MemoryType[] }): Promise<RecallHit[]>;
  memoryGraph(): Promise<MemoryGraphData>;
  profile(): Promise<DerivedProfile>;
  /** Kick off an import; progress arrives via `import.progress`. Idempotent. */
  importSource(source: ImportSource, path: string): Promise<{ started: true }>;

  /* voice */
  voiceStatus(): Promise<VoiceStatus>;
  /** Download/build STT+TTS binaries and models; progress via `voice.install`. */
  installVoice(): Promise<void>;
  /** Synthesize text; audio streams back over the open /voice channel. */
  speak(text: string): Promise<void>;
  openVoiceChannel(handlers: VoiceChannelHandlers): VoiceChannel;
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

    listMemories: (opts) => {
      const p = new URLSearchParams();
      if (opts?.type) p.set('type', opts.type);
      if (opts?.q) p.set('q', opts.q);
      if (opts?.limit) p.set('limit', String(opts.limit));
      const qs = p.toString();
      return get<MemoryRecord[]>(`/memories${qs ? `?${qs}` : ''}`);
    },
    saveMemory: (input) => post<SaveMemoryResult>('/memories', input),
    updateMemory: (id, patch) =>
      fetch(`${baseUrl}/memories/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((r) => json<MemoryRecord>(r)),
    deleteMemory: (id) =>
      fetch(`${baseUrl}/memories/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    recall: (query, opts) => post<RecallHit[]>('/memories/recall', { query, ...opts }),
    memoryGraph: () => get<MemoryGraphData>('/memories/graph'),
    profile: () => get<DerivedProfile>('/memories/profile'),
    importSource: (source, path) => post<{ started: true }>('/import', { source, path }),

    voiceStatus: () => get<VoiceStatus>('/voice/status'),
    installVoice: () => post<void>('/voice/install'),
    speak: (text) => post<void>('/voice/speak', { text }),

    openVoiceChannel(handlers) {
      const vws = new WebSocket(`ws://127.0.0.1:${port}/voice`);
      vws.binaryType = 'arraybuffer';
      let ttsActive = false;

      vws.addEventListener('message', (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          if (ttsActive) handlers.onTtsChunk(ev.data);
          return;
        }
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type: string;
            text?: string;
            final?: boolean;
            sampleRate?: number;
            message?: string;
          };
          if (msg.type === 'transcript') handlers.onTranscript({ text: msg.text ?? '', final: !!msg.final });
          else if (msg.type === 'tts-start') {
            ttsActive = true;
            handlers.onTtsStart(msg.sampleRate ?? 24000);
          } else if (msg.type === 'tts-end') {
            ttsActive = false;
            handlers.onTtsEnd();
          } else if (msg.type === 'voice-error') handlers.onError(msg.message ?? 'Voice error');
        } catch {
          /* ignore malformed frames */
        }
      });
      vws.addEventListener('error', () => handlers.onError('Voice channel disconnected'));

      const sendJson = (obj: unknown) => {
        if (vws.readyState === WebSocket.OPEN) vws.send(JSON.stringify(obj));
        else vws.addEventListener('open', () => vws.send(JSON.stringify(obj)), { once: true });
      };

      return {
        micStart: (sampleRate) => sendJson({ type: 'mic-start', sampleRate }),
        sendPcm: (chunk) => {
          if (vws.readyState === WebSocket.OPEN) vws.send(chunk);
        },
        micStop: () => sendJson({ type: 'mic-stop' }),
        stopTts: () => sendJson({ type: 'tts-stop' }),
        close: () => vws.close(),
      };
    },
  };
}

/** Shared singleton — one WS connection for the whole renderer. */
export const coreClient: CoreClient = createCoreClient();
