import type { Store } from "./db.js";
import { chatStream, DEFAULT_MODEL, modelStatus } from "./ollama.js";
import type { OllamaMessage } from "./ollama.js";
import { systemPrompt } from "./personas.js";
import { TeachingSegmenter } from "./segmenter.js";
import type { ChatMessage, CoreEvents, Persona } from "./types.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

interface ActiveGeneration {
  controller: AbortController;
  stopped: boolean;
}

/**
 * Owns the assistant-message generation lifecycle: builds history, streams from
 * Ollama, parses teaching segments, persists the result, and emits lifecycle
 * events. Degraded states (daemon offline / model missing) surface as
 * `chat.status` errors without ever throwing out of {@link start}.
 */
export class ChatEngine {
  private readonly active = new Map<string, ActiveGeneration>();

  constructor(
    private readonly store: Store,
    private readonly broadcast: Broadcast,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  /** Fire-and-forget: kicks off async generation for an assistant message. */
  start(assistant: ChatMessage, persona: Persona): void {
    void this.run(assistant, persona);
  }

  stop(messageId: string): boolean {
    const gen = this.active.get(messageId);
    if (!gen) return false;
    gen.stopped = true;
    gen.controller.abort();
    return true;
  }

  private async run(assistant: ChatMessage, persona: Persona): Promise<void> {
    const { id: messageId, threadId } = assistant;
    this.broadcast("chat.status", { messageId, threadId, phase: "thinking" });

    // Degraded pre-flight: never start a stream we can't sustain.
    const status = await modelStatus(this.model);
    if (status.state !== "ready") {
      this.broadcast("chat.status", {
        messageId,
        threadId,
        phase: "error",
        error:
          status.state === "ollama-offline"
            ? "Ollama is not running"
            : `Model ${this.model} is not pulled`,
      });
      return;
    }

    const messages = this.buildHistory(threadId, persona, messageId);
    const segmenter = new TeachingSegmenter();
    const controller = new AbortController();
    const gen: ActiveGeneration = { controller, stopped: false };
    this.active.set(messageId, gen);

    let sawToken = false;
    try {
      await chatStream({
        model: this.model,
        messages,
        signal: controller.signal,
        onChunk: (content) => {
          if (!sawToken) {
            sawToken = true;
            this.broadcast("chat.status", {
              messageId,
              threadId,
              phase: "drafting",
            });
          }
          for (const { segment, token } of segmenter.push(content)) {
            this.broadcast("chat.token", {
              messageId,
              threadId,
              segment,
              token,
            });
          }
        },
      });
      for (const { segment, token } of segmenter.flush()) {
        this.broadcast("chat.token", { messageId, threadId, segment, token });
      }
      this.store.updateMessageSegments(messageId, segmenter.segments());
      this.broadcast("chat.status", { messageId, threadId, phase: "done" });
    } catch (err) {
      // Persist whatever streamed before the failure/stop either way.
      for (const { segment, token } of segmenter.flush()) {
        this.broadcast("chat.token", { messageId, threadId, segment, token });
      }
      this.store.updateMessageSegments(messageId, segmenter.segments());
      if (gen.stopped) {
        this.broadcast("chat.status", { messageId, threadId, phase: "stopped" });
      } else {
        this.broadcast("chat.status", {
          messageId,
          threadId,
          phase: "error",
          error: humanError(err),
        });
      }
    } finally {
      this.active.delete(messageId);
    }
  }

  /**
   * Build the Ollama message array from persisted thread history. The in-flight
   * (empty) assistant row is excluded; stored assistant segments are rejoined in
   * order so the model sees coherent prior turns.
   */
  private buildHistory(
    threadId: string,
    persona: Persona,
    excludeId: string,
  ): OllamaMessage[] {
    const out: OllamaMessage[] = [
      { role: "system", content: systemPrompt(persona) },
    ];
    for (const m of this.store.getMessages(threadId)) {
      if (m.id === excludeId) continue;
      if (m.segments.length === 0) continue;
      const content =
        m.role === "assistant"
          ? m.segments.map((s) => s.content).join("\n\n")
          : m.segments.map((s) => s.content).join("");
      out.push({ role: m.role, content });
    }
    return out;
  }
}

function humanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ECONNREFUSED|network/i.test(msg)) {
    return "Lost connection to Ollama";
  }
  return msg || "Generation failed";
}
