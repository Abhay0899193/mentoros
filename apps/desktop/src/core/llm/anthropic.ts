import Anthropic from "@anthropic-ai/sdk";
import type { OllamaMessage } from "../ollama.js";
import type { CloudModelInfo } from "../types.js";

/**
 * Anthropic (Claude) adapter. Mirrors the shape of the Ollama adapter so the
 * router can dispatch uniformly. A fresh client is constructed per call with the
 * stored key — the key is never held on a long-lived singleton (§2.4). Zero
 * Electron imports; pure JS SDK.
 *
 * Model ids are current as of 2026-06 and complete as written — the catalog does
 * NOT use date-suffixed ids.
 */

export const CLOUD_CATALOG: CloudModelInfo[] = [
  {
    model: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    inputPerMTok: 5,
    outputPerMTok: 25,
    note: "Most capable Opus — best for deep interview reviews",
    recommended: true,
  },
  {
    model: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    inputPerMTok: 3,
    outputPerMTok: 15,
    note: "Near-Opus coding quality, faster and cheaper",
  },
  {
    model: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    note: "Fastest and cheapest — quick answers",
  },
  {
    model: "claude-fable-5",
    label: "Claude Fable 5",
    inputPerMTok: 10,
    outputPerMTok: 50,
    note: "Anthropic's most capable model — premium",
  },
];

const CLOUD_MODEL_IDS = new Set(CLOUD_CATALOG.map((m) => m.model));

/** True when `model` is a known cloud catalog id (used by the router + settings). */
export function isCloudModel(model: string): boolean {
  return CLOUD_MODEL_IDS.has(model);
}

/** adaptive thinking is unsupported on Haiku — omit the param there entirely. */
function thinkingFor(model: string): { thinking: { type: "adaptive" } } | Record<string, never> {
  return model === "claude-haiku-4-5" ? {} : { thinking: { type: "adaptive" } };
}

/**
 * Pure mapping from the router's system|user|assistant message array to the
 * Anthropic request shape: all system entries are hoisted into the top-level
 * `system` string (joined with blank lines); everything else stays in order as
 * `messages`. Exported so the ordering logic is unit-testable without the SDK.
 */
export function toAnthropicRequest(messages: OllamaMessage[]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  return { system, messages: rest };
}

export interface AnthropicStreamOptions {
  apiKey: string;
  model: string;
  messages: OllamaMessage[];
  signal: AbortSignal;
  onChunk: (delta: string) => void;
}

/**
 * Stream a completion. Text deltas arrive via onChunk; resolves when the stream
 * ends. A refusal stop is surfaced as a designed error. The AbortSignal cancels
 * the request via SDK request options, with a `stream.abort()` fallback.
 */
export async function anthropicStream(opts: AnthropicStreamOptions): Promise<void> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const { system, messages } = toAnthropicRequest(opts.messages);

  const stream = client.messages.stream(
    {
      model: opts.model,
      max_tokens: 8192,
      ...(system ? { system } : {}),
      messages,
      ...thinkingFor(opts.model),
    },
    { signal: opts.signal },
  );

  // Belt-and-suspenders: also tear the stream down if the signal fires.
  const onAbort = () => stream.abort();
  opts.signal.addEventListener("abort", onAbort, { once: true });

  stream.on("text", (delta) => opts.onChunk(delta));
  try {
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      throw new Error("The cloud model declined this request");
    }
  } catch (err) {
    throw rethrowHuman(err);
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Humanize SDK errors at the adapter boundary so chat/interview status events
 * show designed copy, not raw SDK messages. Aborts pass through untouched —
 * callers distinguish user-stop from failure by their own stopped flag, but the
 * abort identity must survive for anyone who checks err.name.
 */
function rethrowHuman(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Error && err.name === "AbortError") return err;
  if (err instanceof Anthropic.APIError) return new Error(humanizeAnthropicError(err));
  return err;
}

export interface AnthropicOnceOptions {
  apiKey: string;
  model: string;
  messages: OllamaMessage[];
  timeoutMs?: number;
}

/** Single non-streaming completion; concatenates the text blocks of the reply. */
export async function anthropicOnce(opts: AnthropicOnceOptions): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const { system, messages } = toAnthropicRequest(opts.messages);
  try {
    const res = await client.messages.create(
      {
        model: opts.model,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages,
        ...thinkingFor(opts.model),
      },
      { timeout: opts.timeoutMs ?? 45_000 },
    );
    if (res.stop_reason === "refusal") {
      throw new Error("The cloud model declined this request");
    }
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (err) {
    throw rethrowHuman(err);
  }
}

/** Cheapest authenticated probe (~6s): list models. Never throws. */
export async function validateAnthropicKey(
  apiKey: string,
): Promise<{ keyState: "valid" | "invalid"; keyError?: string }> {
  const client = new Anthropic({ apiKey });
  try {
    await client.models.list({}, { timeout: 6_000 });
    return { keyState: "valid" };
  } catch (err) {
    return { keyState: "invalid", keyError: humanizeAnthropicError(err) };
  }
}

/**
 * Map SDK errors to human copy via the typed error classes (most specific
 * first) — never string-match messages.
 */
export function humanizeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid Anthropic API key";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic rate limit hit — try again shortly";
  if (err instanceof Anthropic.APIConnectionError) return "Cannot reach Anthropic (network?)";
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ""}`.trim();
  return err instanceof Error ? err.message : "Anthropic request failed";
}
