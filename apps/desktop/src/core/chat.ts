import type { Store } from "./db.js";
import { chatStream, DEFAULT_MODEL, modelStatus } from "./ollama.js";
import type { OllamaMessage } from "./ollama.js";
import { systemPrompt } from "./personas.js";
import { TeachingSegmenter } from "./segmenter.js";
import type { MemoryEngine } from "./memory/engine.js";
import type { KbEngine } from "./kb/engine.js";
import type { HybridHit } from "./kb/search.js";
import type {
  ChatMessage,
  CoreEvents,
  MemoryType,
  MessageCitation,
  Persona,
  RecallHit,
  SaveMemoryInput,
} from "./types.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

/** Recall tuning for chat context injection (§2.3 / §4.2). */
const RECALL_K = 4;
const RECALL_MIN_SCORE = 0.5;
const CONTEXT_BLOCK_MAX = 600;

/** KB grounding (§4.7): at most this many excerpts, each trimmed to EXCERPT_MAX. */
const GROUND_MAX = 5;
const EXCERPT_MAX = 700;

/**
 * Auto-capture seed (§Requirement 7): a light heuristic that turns first-person
 * declarations into memory records. The full "Save this?" confirmation UI is the
 * lead agent's job; this just plants durable facts so recall has something to
 * work with. Keyword → type mapping (documented):
 *   "my goal" / "i want to become"                        → goal
 *   "i'm weak" / "i am weak" / "my weakness" / "i struggle with" → skill +weakness
 *   "i'm good at" / "i am good at" / "my strength"        → skill +strength
 *   "i prefer" / "remember that"                          → preference
 * Weakness/strength tags make chat-captured skills surface in
 * profile.weaknesses / profile.strengths (which filter on those tags).
 */
const CAPTURE_RE =
  /\b(my goal|i want to become|i'm weak|i am weak|my weakness|i struggle with|i'm good at|i am good at|my strength|i prefer|remember that)\b/i;

function captureType(text: string): { type: MemoryType; extraTags: string[] } {
  if (/\b(my goal|i want to become)\b/i.test(text)) return { type: "goal", extraTags: [] };
  if (/\b(i'm weak|i am weak|my weakness|i struggle with)\b/i.test(text)) {
    return { type: "skill", extraTags: ["weakness"] };
  }
  if (/\b(i'm good at|i am good at|my strength)\b/i.test(text)) {
    return { type: "skill", extraTags: ["strength"] };
  }
  return { type: "preference", extraTags: [] }; // "i prefer" / "remember that"
}

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
    private readonly memory?: MemoryEngine,
    private readonly kb?: KbEngine,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  /** Fire-and-forget: kicks off async generation for an assistant message. */
  start(assistant: ChatMessage, persona: Persona, userContent = ""): void {
    void this.run(assistant, persona, userContent);
  }

  stop(messageId: string): boolean {
    const gen = this.active.get(messageId);
    if (!gen) return false;
    gen.stopped = true;
    gen.controller.abort();
    return true;
  }

  private async run(
    assistant: ChatMessage,
    persona: Persona,
    userContent: string,
  ): Promise<void> {
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

    // Long-term memory recall + KB grounding: inject what we know before generating.
    const contextMessage = await this.recallContext(threadId, messageId, userContent);
    const grounded = await this.groundContext(threadId, messageId, userContent);
    const messages = this.buildHistory(threadId, persona, messageId);
    const injected: OllamaMessage[] = [];
    if (contextMessage) injected.push(contextMessage);
    if (grounded) injected.push(grounded.message);
    if (injected.length) messages.splice(1, 0, ...injected);
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
      if (grounded) {
        const finalText = segmenter
          .segments()
          .map((s) => s.content)
          .join("\n");
        this.reconcileCitations(threadId, messageId, grounded.citations, finalText);
      }
      this.broadcast("chat.status", { messageId, threadId, phase: "done" });
      this.autoCapture(userContent);
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
   * Recall long-term memory for the user's message, broadcast what was used
   * (feeds the Context panel), and return a system-role context block to prepend
   * to generation — or null when there is nothing relevant / no memory engine.
   */
  private async recallContext(
    threadId: string,
    messageId: string,
    userContent: string,
  ): Promise<OllamaMessage | null> {
    if (!this.memory || !userContent.trim()) return null;
    let hits: RecallHit[];
    try {
      hits = await this.memory.recall(userContent, {
        k: RECALL_K,
        minScore: RECALL_MIN_SCORE,
      });
    } catch {
      return null;
    }
    if (hits.length === 0) return null;

    this.broadcast("chat.context", {
      threadId,
      messageId,
      memories: hits.map((h) => ({
        id: h.record.id,
        type: h.record.type,
        title: h.record.title,
        score: h.score,
      })),
    });

    return { role: "system", content: buildContextBlock(hits) };
  }

  /**
   * Ground the answer on the personal KB (§4.7). Hybrid-search the user's
   * message; if the retrieval is strong enough (see KbEngine.isGrounded — a
   * lexical top hit, or a vector top hit clearing GROUND_VECTOR_MIN) inject numbered excerpts
   * and instruct the model to cite `[n]`. Emits `chat.sources` up front and
   * persists the citations on the assistant row so pills survive reopen. Returns
   * a system-role block to prepend, or null when nothing relevant / no KB engine.
   */
  private async groundContext(
    threadId: string,
    messageId: string,
    userContent: string,
  ): Promise<{ message: OllamaMessage; citations: MessageCitation[] } | null> {
    if (!this.kb || !userContent.trim()) return null;
    let hits: HybridHit[];
    try {
      hits = await this.kb.search(userContent, { k: GROUND_MAX });
    } catch {
      return null;
    }
    if (hits.length === 0 || !this.kb.isGrounded(hits)) return null;

    const top = hits.slice(0, GROUND_MAX);
    const citations: MessageCitation[] = top.map((h, i) => ({
      n: i + 1,
      sourceId: h.sourceId,
      chunkId: h.chunkId,
      title: h.sourceTitle,
      snippet: h.snippet,
      score: h.score,
    }));

    // Emit as soon as grounding is decided (before generation) + persist.
    this.broadcast("chat.sources", { threadId, messageId, citations });
    try {
      this.store.setMessageCitations(messageId, citations);
    } catch {
      /* persistence is best-effort; the live pills already went out */
    }

    return { message: { role: "system", content: buildGroundedBlock(top) }, citations };
  }

  /**
   * After generation: keep only the citations the answer actually marked with
   * `[n]`, so pills never claim sources the model ignored. If the model cited
   * nothing explicitly we keep the full list — retrieved context still shaped
   * the answer, and hiding it would be less honest, not more.
   */
  private reconcileCitations(
    threadId: string,
    messageId: string,
    citations: MessageCitation[],
    finalText: string,
  ): void {
    // Ignore code spans — `arr[1]` in a snippet is not a citation marker.
    const prose = finalText.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    const used = new Set<number>();
    for (const m of prose.matchAll(/\[(\d{1,2})\]/g)) used.add(Number(m[1]));
    const kept = citations.filter((c) => used.has(c.n));
    if (kept.length === 0 || kept.length === citations.length) return;
    this.broadcast("chat.sources", { threadId, messageId, citations: kept });
    try {
      this.store.setMessageCitations(messageId, kept);
    } catch {
      /* best-effort, same as the initial persist */
    }
  }

  /** Seed durable facts from first-person declarations (fire-and-forget). */
  private autoCapture(userContent: string): void {
    if (!this.memory) return;
    const text = userContent.trim();
    if (!text || !CAPTURE_RE.test(text)) return;
    const { type, extraTags } = captureType(text);
    const input: SaveMemoryInput = {
      type,
      body: text,
      source: "chat",
      tags: ["auto", ...extraTags],
      confidence: 0.6,
    };
    void this.memory.saveMemory(input).catch(() => undefined);
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

/**
 * Compose the ≤600-char system-context block from recalled memories. Mistake
 * counts (tag `count:N`) render as `(×N)` so the model sees frequency.
 */
function buildContextBlock(hits: RecallHit[]): string {
  const header =
    "What you know about Abhay (long-term memory — use it, don't re-ask):";
  const lines: string[] = [];
  let length = header.length;
  for (const { record } of hits) {
    const countTag = record.tags.find((t) => /^count:\d+$/i.test(t));
    const freq = countTag ? ` (×${countTag.split(":")[1]})` : "";
    const line = `- [${record.type}] ${record.title}${freq}`;
    if (length + line.length + 1 > CONTEXT_BLOCK_MAX) break;
    lines.push(line);
    length += line.length + 1;
  }
  return `${header}\n${lines.join("\n")}`;
}

/**
 * Compose the grounded-context block from KB hits: numbered `[n]` excerpts with
 * their source titles/sections, capped at EXCERPT_MAX chars each, plus a citing
 * instruction. The model is told to prefer these excerpts over parametric
 * knowledge for document-specific questions.
 */
function buildGroundedBlock(hits: HybridHit[]): string {
  const header =
    "Grounded context from Abhay's knowledge base. Cite [n] inline for EVERY excerpt your answer draws on, at the sentence where you use it — and never cite an excerpt you didn't use. For questions about these documents, prefer the excerpts over your own general knowledge; if they don't cover it, say so.";
  const lines = hits.map((h, i) => {
    const label = h.section ? `${h.sourceTitle} — ${h.section}` : h.sourceTitle;
    const body = h.text.length > EXCERPT_MAX ? `${h.text.slice(0, EXCERPT_MAX)}…` : h.text;
    return `[${i + 1}] (${label})\n${body.trim()}`;
  });
  return `${header}\n\n${lines.join("\n\n")}`;
}

function humanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ECONNREFUSED|network/i.test(msg)) {
    return "Lost connection to Ollama";
  }
  return msg || "Generation failed";
}
