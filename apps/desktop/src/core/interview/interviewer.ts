import { chatStream, DEFAULT_MODEL, modelStatus } from "../ollama.js";
import type { OllamaMessage } from "../ollama.js";
import type {
  CoreEvents,
  EvalResult,
  InterviewPhase,
  InterviewTurn,
} from "../types.js";
import type { BankProblem } from "./problems.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

/**
 * Interviewer LLM voice (§0 of the interview-prep operating manual): a Staff
 * Engineer running a real Google/Meta loop. Zero praise-padding, no emojis,
 * terse, information-dense, never volunteers the solution — nudges live only in
 * the deterministic hint ladder. Streaming degrades gracefully: if Ollama is
 * down the turn surfaces a designed `interview.status` error while /run and
 * /hint keep working.
 */

export interface StreamTurnArgs {
  sessionId: string;
  turnId: string;
  phase: InterviewPhase;
  problem: BankProblem;
  /** Prior transcript (the empty in-flight turn is excluded by the engine). */
  turns: InterviewTurn[];
  /** Interrogation context: latest code + last EvalResult. */
  code?: string;
  lastEval?: EvalResult;
  /** True only for the message that opens the interrogation phase. */
  interrogationOpener?: boolean;
  /** Persist the completed reply text (engine writes it to the store). */
  onComplete: (text: string) => void;
  /**
   * Framing only: fired (after onComplete) when the interviewer judged the
   * candidate's framing adequate and emitted the [BEGIN CODING] marker.
   */
  onBeginCoding?: () => void;
}

export interface IInterviewer {
  streamTurn(args: StreamTurnArgs): Promise<void>;
}

const PERSONA = [
  "You are a Staff Engineer conducting a real coding interview at a top company (Google/Meta bar).",
  "Voice: terse, information-dense, professional. No praise-padding, no filler, no emojis, no exclamation marks.",
  "Never volunteer the solution, the algorithm name, or the optimal approach. If the candidate wants a nudge, tell them to use a hint.",
  "Do not write code for the candidate. Keep replies to 1-4 sentences unless a numbered list is required.",
].join(" ");

function phasePrompt(args: StreamTurnArgs): string {
  const { problem, phase } = args;
  const problemBlock = `PROBLEM: ${problem.title} (${problem.difficulty}).\n${problem.promptMd}`;

  if (phase === "framing") {
    return [
      PERSONA,
      problemBlock,
      "PHASE: Framing. Present the problem in at most 2 lines (do not paste the full statement back).",
      "Then require the candidate to (a) restate it in their own words, (b) confirm the constraints, and (c) name 2-3 edge cases before writing any code.",
      "If this is the opening message, deliver that framing and ask them to restate. Otherwise respond to what they said and hold them to confirming constraints + edge cases before coding.",
      `Once (and only once) the candidate has adequately restated the problem, confirmed the constraints, and named 2-3 plausible edge cases, end your reply with the exact text ${BEGIN_CODING_MARKER} on its own final line. Never emit it in your opening message and never emit it while any of the three items is missing or wrong.`,
    ].join("\n\n");
  }

  if (phase === "coding") {
    return [
      PERSONA,
      problemBlock,
      "PHASE: Coding. Answer clarifying questions tersely and factually.",
      "Refuse to reveal the approach or data structure: 'use a hint if you want a nudge.' Push back on hand-waving and vague complexity claims; ask them to be precise.",
    ].join("\n\n");
  }

  if (phase === "interrogation") {
    const evalLine = args.lastEval
      ? `Latest test run: ${args.lastEval.passed}/${args.lastEval.total} passed${args.lastEval.compileError ? ` (compile error: ${args.lastEval.compileError})` : ""}.`
      : "No test run was recorded.";
    const codeBlock = args.code
      ? `CANDIDATE FINAL CODE:\n\`\`\`\n${args.code.slice(0, 4000)}\n\`\`\``
      : "The candidate submitted no code.";
    const opener = args.interrogationOpener === true;
    return [
      PERSONA,
      problemBlock,
      codeBlock,
      evalLine,
      "PHASE: Interrogation. The candidate declared done.",
      opener
        ? "Open with ONE message listing exactly these five questions, numbered: 1) Time complexity, with the derivation. 2) Space complexity, including recursion stack. 3) Why this is optimal / what the lower bound is. 4) What alternatives you considered. 5) The trade-offs of your choice. Do not answer them yourself."
        : "Probe the candidate's latest answer. If it is wrong or hand-wavy, note that it is not fully correct and press for the precise reasoning WITHOUT giving the answer. Take weak answers one at a time.",
    ].join("\n\n");
  }

  // scorecard / abandoned — no interviewer streaming expected.
  return [PERSONA, problemBlock].join("\n\n");
}

export const BEGIN_CODING_MARKER = "[BEGIN CODING]";
const BEGIN_CODING_RE = /\s*\[BEGIN CODING\]\s*$/;
/** Tail chars withheld from the live stream so the marker never reaches the renderer. */
const MARKER_HOLDBACK = BEGIN_CODING_MARKER.length + 8;

/** Strips a trailing [BEGIN CODING] marker; returns the clean text + whether it was present. */
export function stripBeginMarker(text: string): { text: string; beginCoding: boolean } {
  if (!BEGIN_CODING_RE.test(text)) return { text, beginCoding: false };
  return { text: text.replace(BEGIN_CODING_RE, ""), beginCoding: true };
}

function buildMessages(args: StreamTurnArgs): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: "system", content: phasePrompt(args) }];
  for (const t of args.turns) {
    if (!t.content.trim()) continue;
    out.push({
      role: t.role === "candidate" ? "user" : "assistant",
      content: t.content,
    });
  }
  // llama3.1 returns an empty completion when the transcript does not end with
  // a user turn (fresh framing opener, interrogation opener after /finish) —
  // give it a candidate line to respond to. Never persisted as a turn.
  if (out[out.length - 1]!.role !== "user") {
    out.push({
      role: "user",
      content:
        args.phase === "framing"
          ? "I'm ready — go ahead."
          : args.interrogationOpener === true
            ? "I'm done — my code is submitted. Go ahead with your questions."
            : "Go ahead.",
    });
  }
  return out;
}

export class Interviewer implements IInterviewer {
  constructor(
    private readonly broadcast: Broadcast,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async streamTurn(args: StreamTurnArgs): Promise<void> {
    const { sessionId, turnId } = args;
    this.broadcast("interview.status", { sessionId, turnId, phase: "thinking" });

    const status = await modelStatus(this.model);
    if (status.state !== "ready") {
      this.broadcast("interview.status", {
        sessionId,
        turnId,
        phase: "error",
        error:
          status.state === "ollama-offline"
            ? "Ollama is offline — the interviewer is unavailable, but Run and Hint still work."
            : `Model ${this.model} is not pulled — Run and Hint still work.`,
      });
      return;
    }

    const messages = buildMessages(args);
    const controller = new AbortController();
    // During framing the reply may end with [BEGIN CODING]; hold back a small
    // tail so the marker is stripped before it ever reaches the renderer.
    const holdback = args.phase === "framing" ? MARKER_HOLDBACK : 0;
    let text = "";
    let emitted = 0;
    let sawToken = false;
    const flushTo = (end: number) => {
      if (end <= emitted) return;
      this.broadcast("interview.token", {
        sessionId,
        turnId,
        token: text.slice(emitted, end),
      });
      emitted = end;
    };
    try {
      await chatStream({
        model: this.model,
        messages,
        signal: controller.signal,
        onChunk: (content) => {
          if (!sawToken) {
            sawToken = true;
            this.broadcast("interview.status", { sessionId, turnId, phase: "drafting" });
          }
          text += content;
          flushTo(text.length - holdback);
        },
      });
      const { text: finalText, beginCoding } =
        args.phase === "framing" ? stripBeginMarker(text) : { text, beginCoding: false };
      flushTo(finalText.length);
      args.onComplete(finalText);
      this.broadcast("interview.status", { sessionId, turnId, phase: "done" });
      if (beginCoding) args.onBeginCoding?.();
    } catch (err) {
      flushTo(text.length);
      if (text) args.onComplete(text);
      this.broadcast("interview.status", {
        sessionId,
        turnId,
        phase: "error",
        error: humanError(err),
      });
    }
  }
}

function humanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ECONNREFUSED|network/i.test(msg)) {
    return "Lost connection to Ollama — the interviewer stopped, but Run and Hint still work.";
  }
  return msg || "Interviewer generation failed";
}
