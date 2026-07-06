import {
  chatOnce,
  chatStream,
  DEFAULT_MODEL,
  modelStatus as probeOllama,
  type OllamaMessage,
} from "../ollama.js";
import { anthropicOnce, anthropicStream, isCloudModel } from "./anthropic.js";
import type {
  ApiKeyState,
  ModelProvider,
  ModelStatus,
  ModelSurface,
} from "../types.js";

/**
 * Per-surface model router (§2.4). Local-first: every surface reads its stored
 * ModelChoice; a cloud choice only takes effect while cloudEnabled AND a valid
 * key AND a known catalog model — otherwise it silently falls back to the local
 * default so a surface is never broken by a missing/invalid key or cloud-off.
 * Ollama choices pass through untouched.
 */

/** The slice of SettingsStore the router reads (injectable for tests). */
export interface RouterSettings {
  get(): { cloudEnabled: boolean; models: Record<ModelSurface, { provider: ModelProvider; model: string }> };
}

/** The slice of KeyStore the router reads (injectable for tests). */
export interface RouterKeys {
  getKey(): string | null;
  getState(): ApiKeyState;
}

export interface Resolved {
  provider: ModelProvider;
  model: string;
  fellBack: boolean;
}

export interface RouterStreamArgs {
  surface: ModelSurface;
  messages: OllamaMessage[];
  signal: AbortSignal;
  onChunk: (delta: string) => void;
}

export interface RouterOnceArgs {
  surface: ModelSurface;
  messages: OllamaMessage[];
  timeoutMs?: number;
  /** Structured-output mode; honored on the Ollama path only. */
  format?: "json";
}

export class ModelRouter {
  constructor(
    private readonly settings: RouterSettings,
    private readonly keys: RouterKeys,
  ) {}

  /** Resolve a surface to a concrete provider+model, reporting cloud→local fallback. */
  resolve(surface: ModelSurface): Resolved {
    const s = this.settings.get();
    const choice = s.models[surface];
    if (choice.provider === "anthropic") {
      const usable =
        s.cloudEnabled && this.keys.getState() === "valid" && isCloudModel(choice.model);
      if (!usable) return { provider: "ollama", model: DEFAULT_MODEL, fellBack: true };
      return { provider: "anthropic", model: choice.model, fellBack: false };
    }
    return { provider: "ollama", model: choice.model, fellBack: false };
  }

  async stream(args: RouterStreamArgs): Promise<void> {
    const r = this.resolve(args.surface);
    if (r.provider === "anthropic") {
      await anthropicStream({
        apiKey: this.requireKey(),
        model: r.model,
        messages: args.messages,
        signal: args.signal,
        onChunk: args.onChunk,
      });
      return;
    }
    await chatStream({
      model: r.model,
      messages: args.messages,
      signal: args.signal,
      onChunk: args.onChunk,
    });
  }

  async once(args: RouterOnceArgs): Promise<string> {
    const r = this.resolve(args.surface);
    if (r.provider === "anthropic") {
      return anthropicOnce({
        apiKey: this.requireKey(),
        model: r.model,
        messages: args.messages,
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      });
    }
    return chatOnce({
      model: r.model,
      messages: args.messages,
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      ...(args.format ? { format: args.format } : {}),
    });
  }

  /**
   * Pre-flight for a surface. Ollama surfaces probe the daemon (may report
   * offline/model-missing); cloud surfaces are always 'ready' (key validity is
   * enforced at resolve time — an unusable cloud choice has already fallen back).
   */
  async status(surface: ModelSurface): Promise<ModelStatus> {
    const r = this.resolve(surface);
    if (r.provider === "anthropic") {
      return { state: "ready", model: r.model, provider: "anthropic" };
    }
    const s = await probeOllama(r.model);
    return { ...s, provider: "ollama", ...(r.fellBack ? { fellBack: true } : {}) };
  }

  private requireKey(): string {
    const key = this.keys.getKey();
    if (!key) throw new Error("No Anthropic API key configured");
    return key;
  }
}
