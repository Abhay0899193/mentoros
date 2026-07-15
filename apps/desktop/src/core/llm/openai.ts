import type { OllamaMessage } from "../ollama.js";
import type { EndpointAuth } from "../types.js";

/**
 * Fetch-based adapter for OpenAI-compatible custom endpoints (§2.4 router).
 * Mirrors the shape of the Ollama/Anthropic adapters so the router can dispatch
 * uniformly. Zero SDK dependency — we POST /chat/completions and parse the SSE
 * stream ourselves so the core stays lean and framework-agnostic. The token is
 * never held on a long-lived singleton; it is passed in per call.
 *
 * Messages pass through as-is: OpenAI-compatible APIs accept the system role
 * inline in the messages array. max_tokens is omitted (gateways default it) and
 * response_format is never sent.
 */

/** One parsed SSE event from a /chat/completions stream. */
export type SseEvent = { done: true } | { content: string };

/**
 * Parse a single SSE line (already stripped of a trailing CR). Returns the
 * event, or null when the line carries nothing we care about (blank lines,
 * comments, non-`data:` fields, deltas without content, malformed JSON).
 * Exported so the parsing is unit-testable without a network stream.
 */
export function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (payload.length === 0) return null;
  if (payload === "[DONE]") return { done: true };
  try {
    const obj = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const content = obj.choices?.[0]?.delta?.content;
    return typeof content === "string" && content.length > 0 ? { content } : null;
  } catch {
    // Malformed line — ignore it, keep the stream alive.
    return null;
  }
}

/**
 * Incremental SSE buffer: feed it decoded chunks; it yields complete events,
 * holding any trailing partial line across chunk boundaries. Handles both LF and
 * CRLF line endings. Pure + unit-testable (no network).
 */
export class SseBuffer {
  private buf = "";

  /** Push a decoded chunk; return the events completed by this chunk. */
  push(chunk: string): SseEvent[] {
    this.buf += chunk;
    const events: SseEvent[] = [];
    let nl = this.buf.indexOf("\n");
    while (nl !== -1) {
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      const ev = parseSseLine(line);
      if (ev) events.push(ev);
      nl = this.buf.indexOf("\n");
    }
    return events;
  }
}

/** Build request headers, presenting the token per the endpoint's auth scheme. */
function authHeaders(token: string | null, auth: EndpointAuth): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    if (auth === "bearer") headers["authorization"] = `Bearer ${token}`;
    else headers["x-api-key"] = token;
  }
  return headers;
}

export interface OpenAiStreamOptions {
  baseUrl: string;
  token: string | null;
  auth: EndpointAuth;
  model: string;
  messages: OllamaMessage[];
  signal: AbortSignal;
  onChunk: (delta: string) => void;
}

/**
 * Stream a completion from an OpenAI-compatible endpoint. Text deltas arrive via
 * onChunk; resolves when the stream ends (`[DONE]` or body EOF). Aborts pass
 * through untouched so callers can tell user-stop from failure.
 */
export async function openaiStream(opts: OpenAiStreamOptions): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(opts.token, opts.auth),
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
      signal: opts.signal,
    });
  } catch (err) {
    throw humanizeNetwork(err);
  }
  if (!res.ok || !res.body) {
    throw new Error(humanizeStatus(res.status));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseBuffer();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const ev of sse.push(decoder.decode(value, { stream: true }))) {
        if ("done" in ev) return;
        opts.onChunk(ev.content);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface OpenAiOnceOptions {
  baseUrl: string;
  token: string | null;
  auth: EndpointAuth;
  model: string;
  messages: OllamaMessage[];
  timeoutMs?: number;
}

/** Single non-streaming completion; returns the assistant message content. */
export async function openaiOnce(opts: OpenAiOnceOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  try {
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: authHeaders(opts.token, opts.auth),
        body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: false }),
        signal: controller.signal,
      });
    } catch (err) {
      throw humanizeNetwork(err);
    }
    if (!res.ok) throw new Error(humanizeStatus(res.status));
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export interface ListOpenAiModelsOptions {
  baseUrl: string;
  token: string | null;
  auth: EndpointAuth;
  timeoutMs?: number;
}

/** GET /models → sorted list of model ids. Throws humanized errors on failure. */
export async function listOpenAiModels(opts: ListOpenAiModelsOptions): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6_000);
  try {
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}/models`, {
        headers: authHeaders(opts.token, opts.auth),
        signal: controller.signal,
      });
    } catch (err) {
      throw humanizeNetwork(err);
    }
    if (!res.ok) throw new Error(humanizeStatus(res.status));
    const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string")
      .sort();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Humanize an HTTP status into designed copy, mirroring humanizeAnthropicError:
 * auth failures, missing URL, and a generic fallback.
 */
export function humanizeStatus(status: number): string {
  if (status === 401 || status === 403) return "Endpoint rejected the token";
  if (status === 404) return "Endpoint URL not found (check the base URL)";
  return `Endpoint error ${status}`;
}

/** Aborts pass through untouched; anything else becomes a network-reach error. */
function humanizeNetwork(err: unknown): unknown {
  if (err instanceof Error && err.name === "AbortError") return err;
  return new Error("Cannot reach endpoint (network?)");
}
