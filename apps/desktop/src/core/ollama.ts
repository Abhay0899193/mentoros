import type { LocalModelInfo, ModelStatus } from "./types.js";

/**
 * Native Ollama adapter — talks HTTP to a locally running Ollama daemon. No SDK
 * dependency; we parse Ollama's NDJSON streams directly so the core stays lean
 * and framework-agnostic.
 */

export const DEFAULT_MODEL = "llama3.1:8b";
const OLLAMA_BASE = "http://127.0.0.1:11434";
const STATUS_TIMEOUT_MS = 250;

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Iterate the newline-delimited JSON objects of a streaming Response body. */
async function* ndjson(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.length > 0) yield JSON.parse(line);
        nl = buf.indexOf("\n");
      }
    }
    const tail = buf.trim();
    if (tail.length > 0) yield JSON.parse(tail);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Fast reachability + model-presence probe. Never throws; resolves to a status
 * within ~{@link STATUS_TIMEOUT_MS} even when the daemon is down.
 */
export async function modelStatus(model = DEFAULT_MODEL): Promise<ModelStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: controller.signal,
    });
    if (!res.ok) return { state: "ollama-offline", model };
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models ?? []).map((m) => m.name);
    const present = names.some((n) => n === model || n === `${model}:latest`);
    return { state: present ? "ready" : "model-missing", model };
  } catch {
    return { state: "ollama-offline", model };
  } finally {
    clearTimeout(timer);
  }
}

const TAGS_TIMEOUT_MS = 800;

/**
 * Enumerate installed Ollama models for the Settings picker. Never throws;
 * resolves `reachable:false` with an empty list when the daemon is down.
 */
export async function listLocalModels(): Promise<{
  reachable: boolean;
  models: LocalModelInfo[];
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAGS_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
    if (!res.ok) return { reachable: false, models: [] };
    const data = (await res.json()) as {
      models?: Array<{ name?: string; size?: number }>;
    };
    const models: LocalModelInfo[] = (data.models ?? [])
      .filter((m): m is { name: string; size?: number } => typeof m.name === "string")
      .map((m) => ({ model: m.name, label: m.name, sizeBytes: m.size ?? 0 }));
    return { reachable: true, models };
  } catch {
    return { reachable: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatStreamOptions {
  model?: string;
  messages: OllamaMessage[];
  signal: AbortSignal;
  /** Called once per NDJSON chunk with the incremental content. */
  onChunk: (content: string) => void;
}

/**
 * Stream a chat completion. Resolves when the stream ends normally; rejects if
 * the daemon is unreachable or errors mid-stream. Aborting the signal rejects
 * with an AbortError, which the caller distinguishes from a real failure.
 */
export async function chatStream(opts: ChatStreamOptions): Promise<void> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      messages: opts.messages,
      stream: true,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama chat failed: ${res.status} ${res.statusText}`);
  }
  for await (const obj of ndjson(res.body)) {
    const msg = obj as {
      message?: { content?: string };
      error?: string;
      done?: boolean;
    };
    if (msg.error) throw new Error(msg.error);
    const content = msg.message?.content;
    if (content) opts.onChunk(content);
    if (msg.done) break;
  }
}

export interface ChatOnceOptions {
  model?: string;
  messages: OllamaMessage[];
  /** Ollama sampling options, e.g. { temperature: 0, num_predict: 5 }. */
  options?: Record<string, unknown>;
  /** Abort after this many ms (default 2500). */
  timeoutMs?: number;
  /** Ollama structured-output mode, e.g. 'json' for the scorecard grader. */
  format?: "json";
}

/**
 * Single non-streaming completion. Used for short, deterministic classifier
 * calls (e.g. the memory merge judge). Throws on unreachable daemon / timeout /
 * HTTP error so callers can treat any failure uniformly (fail-open).
 */
export async function chatOnce(opts: ChatOnceOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2500);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        messages: opts.messages,
        stream: false,
        options: opts.options ?? {},
        ...(opts.format ? { format: opts.format } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama chat failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error) throw new Error(data.error);
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export interface PullProgress {
  completedBytes: number;
  totalBytes: number;
  done: boolean;
  error?: string;
}

/**
 * Pull a model, reporting byte progress. Resolves when the pull completes;
 * surfaces daemon errors via the `error` field on a final progress event.
 */
export async function pullModel(
  model: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal,
    });
  } catch {
    onProgress({
      completedBytes: 0,
      totalBytes: 0,
      done: true,
      error: "Ollama is not running",
    });
    return;
  }
  if (!res.ok || !res.body) {
    onProgress({
      completedBytes: 0,
      totalBytes: 0,
      done: true,
      error: `Pull failed: ${res.status} ${res.statusText}`,
    });
    return;
  }

  let completed = 0;
  let total = 0;
  for await (const obj of ndjson(res.body)) {
    const p = obj as {
      status?: string;
      completed?: number;
      total?: number;
      error?: string;
    };
    if (p.error) {
      onProgress({
        completedBytes: completed,
        totalBytes: total,
        done: true,
        error: p.error,
      });
      return;
    }
    if (typeof p.completed === "number") completed = p.completed;
    if (typeof p.total === "number") total = p.total;
    const done = p.status === "success";
    onProgress({ completedBytes: completed, totalBytes: total, done });
    if (done) return;
  }
  onProgress({ completedBytes: completed, totalBytes: total, done: true });
}
