import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ModelRouter } from "../llm/router.js";
import type {
  CoreEvents,
  DraftValidation,
  EvalResult,
  InterviewLanguage,
  InterviewMode,
  InterviewPhase,
  InterviewProblem,
  InterviewProblemDraft,
  InterviewProblemMeta,
  InterviewScorecard,
  InterviewSession,
  InterviewSessionSummary,
  InterviewTurn,
  InterviewType,
  LeetCodeFetchResult,
  MemoryRecord,
  PageFetchResult,
  SaveMemoryInput,
  SaveMemoryResult,
} from "../types.js";
import {
  toMeta,
  toPublicProblem,
  type BankProblem,
} from "./problems.js";
import {
  allProblems,
  findProblem,
  isBuiltInProblem,
  MemImportStore,
  type IImportStore,
} from "./importStore.js";
import {
  generateValidatedDraft,
  saveDraft,
  validateDraft,
  DraftInvalidError,
  DraftGenerationError,
} from "./importer.js";
import { Interviewer, type IInterviewer, type StreamTurnArgs } from "./interviewer.js";
import { recommendProblem, type MistakeSignal, type RecResult } from "./recommend.js";
import { gradePractice, gradeScorecard, writeScorecardMemories, type GradeInput, type ScorecardOnce } from "./scorecard.js";
import { fetchLeetCodeProblem } from "./leetcode.js";
import { fetchProblemPage } from "./page.js";
import { chatOnce } from "../ollama.js";
import { runTests, type RunTestsOpts } from "./runner.js";
import type { IInterviewStore } from "./store.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

/** The slice of the memory engine the interview platform depends on. */
export interface InterviewMemory {
  listMemories(opts?: { type?: MemoryRecord["type"]; q?: string; limit?: number }): MemoryRecord[];
  saveMemory(input: SaveMemoryInput): Promise<SaveMemoryResult>;
}

export type RunFn = (opts: RunTestsOpts) => Promise<Omit<EvalResult, "attemptId">>;
export type GradeFn = (input: GradeInput) => Promise<InterviewScorecard>;

export interface InterviewEngineDeps {
  store: IInterviewStore;
  broadcast: Broadcast;
  dataDir: string;
  memory?: InterviewMemory;
  interviewer?: IInterviewer;
  runFn?: RunFn;
  gradeFn?: GradeFn;
  /** Persistence for user-imported problems (defaults to an empty in-memory store). */
  importStore?: IImportStore;
  /** Routes interviewer + scorecard surfaces (local or cloud). */
  router?: ModelRouter;
}

class NotFoundError extends Error {}
class ConflictError extends Error {}
class ForbiddenError extends Error {}

export {
  NotFoundError as InterviewNotFound,
  ConflictError as InterviewConflict,
  ForbiddenError as InterviewForbidden,
};
export { DraftInvalidError, DraftGenerationError } from "./importer.js";

/**
 * InterviewEngine — the coding-interview façade the routes call. Owns the
 * session lifecycle (framing → coding → interrogation → scorecard/abandoned),
 * fires interviewer streaming, runs the eval sandbox, and — on /end — grades
 * asynchronously and writes the scorecard's takeaways back into memory.
 */
export class InterviewEngine {
  private readonly store: IInterviewStore;
  private readonly broadcast: Broadcast;
  private readonly memory?: InterviewMemory;
  private readonly interviewer: IInterviewer;
  private readonly runFn: RunFn;
  private readonly gradeFn: GradeFn;
  private readonly router?: ModelRouter;
  private readonly importStore: IImportStore;
  private readonly tmpRoot: string;

  constructor(deps: InterviewEngineDeps) {
    this.store = deps.store;
    this.broadcast = deps.broadcast;
    this.importStore = deps.importStore ?? new MemImportStore();
    if (deps.memory) this.memory = deps.memory;
    if (deps.router) this.router = deps.router;
    // The default Interviewer needs a router; tests inject a fake interviewer so
    // this RHS never evaluates without one.
    this.interviewer = deps.interviewer ?? new Interviewer(deps.broadcast, this.needRouter());
    this.runFn = deps.runFn ?? runTests;
    this.gradeFn = deps.gradeFn ?? gradeScorecard;
    this.tmpRoot = join(deps.dataDir, "tmp");
    mkdirSync(this.tmpRoot, { recursive: true });
  }

  private needRouter(): ModelRouter {
    if (!this.router) throw new Error("interview engine requires a model router");
    return this.router;
  }

  /* ------------------------------ problems ----------------------------- */

  listProblems(type: InterviewType = "coding"): InterviewProblemMeta[] {
    if (type !== "coding") return [];
    const stats = this.problemStats();
    const metas = allProblems(this.importStore).map(toMeta);
    for (const m of metas) {
      const s = stats.get(m.id);
      if (s && s.best >= 0) m.lastScore = s.best;
    }
    const rec = this.recommend(stats);
    if (rec) {
      const m = metas.find((x) => x.id === rec.id);
      if (m) {
        m.recommended = true;
        m.recommendedReason = rec.reason;
      }
    }
    return metas;
  }

  listSessions(): InterviewSessionSummary[] {
    return this.store.listSessions().map((s) => {
      const problem = findProblem(this.importStore, s.problemId);
      const sc = this.store.getScorecard(s.id);
      const sum: InterviewSessionSummary = {
        id: s.id,
        type: s.type,
        mode: s.mode ?? "interview",
        problemTitle: problem?.title ?? s.problemId,
        pattern: problem?.pattern ?? "unknown",
        phase: s.phase,
        startedAt: s.startedAt,
      };
      if (sc) sum.score = sc.score;
      return sum;
    });
  }

  /**
   * Resolve a problem (bank or custom) by its LeetCode titleSlug — the
   * practice-mode "open this LC problem in-app" entry point. Case-insensitive.
   */
  problemBySlug(slug: string): InterviewProblem | undefined {
    const want = slug.trim().toLowerCase();
    if (!want) return undefined;
    const hit = allProblems(this.importStore).find(
      (p) => (p.slug ?? "").toLowerCase() === want,
    );
    return hit ? toPublicProblem(hit) : undefined;
  }

  /**
   * Fetch a problem statement from LeetCode's public GraphQL (practice-mode
   * import). Pure delegation to {@link fetchLeetCodeProblem}; errors bubble as
   * LeetCodeNotFound (→404) / LeetCodeFetchError (→502) for the route to map.
   */
  fetchLeetCode(slug: string): Promise<LeetCodeFetchResult> {
    return fetchLeetCodeProblem(slug);
  }

  /**
   * Fetch + extract an arbitrary problem page (Phase H import-from-URL). Pure
   * delegation to {@link fetchProblemPage}; errors bubble as PageUrlError
   * (→400) / PageExtractError (→422) / PageFetchError (→502).
   */
  fetchPage(url: string): Promise<PageFetchResult> {
    return fetchProblemPage(url);
  }

  /* ------------------------------- importer ---------------------------- */

  /**
   * Draft a bank problem from a pasted statement (LLM, scorecard surface) and
   * validate it by executing the reference solution against its own tests.
   * On validation failure the importer runs one self-correction round (the
   * model sees its own failing tests) before giving up to the review UI.
   * Throws {@link DraftGenerationError} if the model output is unusable.
   */
  async importDraft(
    sourceText: string,
  ): Promise<{ draft: InterviewProblemDraft; validation: DraftValidation }> {
    return generateValidatedDraft(sourceText, this.scorecardOnce(), this.runFn, this.tmpRoot);
  }

  /** Re-run validation for a (possibly user-edited) draft. */
  async validateDraftInput(draft: InterviewProblemDraft): Promise<DraftValidation> {
    return validateDraft(draft, this.runFn, this.tmpRoot);
  }

  /**
   * Persist a draft after a server-side re-validation (never trust the client).
   * Throws {@link DraftInvalidError} (→ 422) when the draft does not validate.
   */
  async saveDraftInput(draft: InterviewProblemDraft): Promise<InterviewProblemMeta> {
    const validation = await validateDraft(draft, this.runFn, this.tmpRoot);
    const problem = saveDraft(draft, validation, this.importStore);
    return toMeta(problem);
  }

  /** Delete a custom problem. Throws {@link ForbiddenError} for built-ins. */
  deleteProblem(id: string): boolean {
    if (isBuiltInProblem(id)) throw new ForbiddenError("built-in problems cannot be deleted");
    return this.importStore.delete(id);
  }

  /** Route a single-shot completion through the scorecard surface (local-first). */
  private scorecardOnce(): ScorecardOnce {
    const router = this.router;
    if (router) {
      return (o) =>
        router.once({
          surface: "scorecard",
          messages: o.messages,
          ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
          ...(o.format ? { format: o.format } : {}),
        });
    }
    return (o) =>
      chatOnce({
        messages: o.messages,
        options: { temperature: 0 },
        ...(o.format ? { format: o.format } : {}),
        ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
      });
  }

  /* ------------------------------ lifecycle ---------------------------- */

  startSession(input: {
    type: InterviewType;
    problemId?: string;
    language: InterviewLanguage;
    mode?: InterviewMode;
  }): { session: InterviewSession; problem: InterviewProblem } {
    const problemId = input.problemId ?? this.recommendedOrDefault();
    const problem = findProblem(this.importStore, problemId);
    if (!problem) throw new NotFoundError("problem not found");

    const mode: InterviewMode = input.mode ?? "interview";
    const session = this.store.createSession({
      type: input.type,
      problemId,
      language: input.language,
      mode,
    });

    if (mode === "practice") {
      // Practice: no interviewer, no framing, no LLM. Start directly in coding
      // so /run and /hint are the only mechanics; resume never re-enters framing.
      this.store.setPhase(session.id, "coding");
      session.phase = "coding";
      this.broadcast("interview.phase", { sessionId: session.id, phase: "coding" });
      return { session, problem: toPublicProblem(problem) };
    }

    // Interview: stream the framing opener as the first interviewer turn.
    const turn = this.store.addTurn({
      sessionId: session.id,
      role: "interviewer",
      kind: "chat",
      content: "",
    });
    this.streamInterviewer(session, "framing", turn.id);
    return { session, problem: toPublicProblem(problem) };
  }

  getFullSession(id: string):
    | {
        session: InterviewSession;
        problem: InterviewProblem;
        turns: InterviewTurn[];
        attempts: EvalResult[];
        scorecard?: InterviewScorecard;
      }
    | undefined {
    const session = this.store.getSession(id);
    if (!session) return undefined;
    const problem = findProblem(this.importStore, session.problemId);
    if (!problem) return undefined;
    const out = {
      session,
      problem: toPublicProblem(problem),
      turns: this.store.getTurns(id),
      attempts: this.store.getAttempts(id),
    } as {
      session: InterviewSession;
      problem: InterviewProblem;
      turns: InterviewTurn[];
      attempts: EvalResult[];
      scorecard?: InterviewScorecard;
    };
    const sc = this.store.getScorecard(id);
    if (sc) out.scorecard = sc;
    return out;
  }

  say(id: string, content: string): { turnId: string; replyTurnId: string } {
    const session = this.requireSession(id);
    const userTurn = this.store.addTurn({
      sessionId: id,
      role: "candidate",
      kind: "chat",
      content,
    });
    const reply = this.store.addTurn({
      sessionId: id,
      role: "interviewer",
      kind: "chat",
      content: "",
    });
    const phase: InterviewPhase =
      session.phase === "framing"
        ? "framing"
        : session.phase === "interrogation"
          ? "interrogation"
          : "coding";
    const extra =
      phase === "interrogation"
        ? { code: this.store.getCode(id) ?? "", lastEval: this.latestEval(id) }
        : undefined;
    this.streamInterviewer(session, phase, reply.id, extra);
    return { turnId: userTurn.id, replyTurnId: reply.id };
  }

  hint(id: string): { level: 1 | 2 | 3; replyTurnId: string } {
    const session = this.requireSession(id);
    if (session.hintsUsed >= 3) throw new ConflictError("hint ladder exhausted");
    const level = (session.hintsUsed + 1) as 1 | 2 | 3;
    const problem = findProblem(this.importStore, session.problemId);
    if (!problem) throw new NotFoundError("problem not found");
    const text = problem.hints[level - 1];
    const turn = this.store.addTurn({
      sessionId: id,
      role: "interviewer",
      kind: "hint",
      hintLevel: level,
      content: text,
    });
    this.store.incHints(id);
    this.maybeEnterCoding(session);
    // Deterministic + offline: emit the stored hint as a single token, then done.
    this.broadcast("interview.token", { sessionId: id, turnId: turn.id, token: text });
    this.broadcast("interview.status", { sessionId: id, turnId: turn.id, phase: "done" });
    return { level, replyTurnId: turn.id };
  }

  async run(id: string, code: string): Promise<EvalResult> {
    const session = this.requireSession(id);
    const problem = findProblem(this.importStore, session.problemId);
    if (!problem) throw new NotFoundError("problem not found");
    this.store.setCode(id, code);
    this.maybeEnterCoding(session);
    const partial = await this.runFn({
      language: session.language,
      functionName: problem.functionName,
      tests: problem.tests,
      code,
      tmpRoot: this.tmpRoot,
    });
    const result: EvalResult = { attemptId: randomUUID(), ...partial };
    this.store.addAttempt(id, result);
    return result;
  }

  finish(id: string, code: string): { replyTurnId: string } {
    const session = this.requireSession(id);
    this.store.setCode(id, code);
    if (session.mode === "practice") {
      // Practice has no interrogation and no interviewer. `finish` is the
      // terminal action: move straight to a deterministic, LLM-free scorecard.
      // Returns an empty replyTurnId — there is no interviewer turn to bind.
      this.store.setPhase(id, "scorecard");
      this.broadcast("interview.phase", { sessionId: id, phase: "scorecard" });
      void this.gradePracticeAndPersist({ ...session, phase: "scorecard" });
      return { replyTurnId: "" };
    }
    this.store.setPhase(id, "interrogation");
    this.broadcast("interview.phase", { sessionId: id, phase: "interrogation" });
    this.store.addTurn({
      sessionId: id,
      role: "interviewer",
      kind: "phase",
      content: "Moving to interrogation.",
    });
    const reply = this.store.addTurn({
      sessionId: id,
      role: "interviewer",
      kind: "chat",
      content: "",
    });
    this.streamInterviewer(this.requireSession(id), "interrogation", reply.id, {
      code,
      lastEval: this.latestEval(id),
      interrogationOpener: true,
    });
    return { replyTurnId: reply.id };
  }

  end(id: string): { started: true } {
    const session = this.requireSession(id);
    this.store.setPhase(id, "scorecard");
    this.broadcast("interview.phase", { sessionId: id, phase: "scorecard" });
    if (session.mode === "practice") {
      // Defensive: practice grading is deterministic and LLM-free even via /end.
      void this.gradePracticeAndPersist(session);
    } else {
      void this.gradeAndPersist(session);
    }
    return { started: true };
  }

  abandon(id: string): boolean {
    const session = this.store.getSession(id);
    if (!session) return false;
    this.store.setPhase(id, "abandoned");
    this.store.setEnded(id, new Date().toISOString());
    this.broadcast("interview.phase", { sessionId: id, phase: "abandoned" });
    return true;
  }

  /* ------------------------------ internals ---------------------------- */

  private requireSession(id: string): InterviewSession {
    const session = this.store.getSession(id);
    if (!session) throw new NotFoundError("session not found");
    return session;
  }

  private maybeEnterCoding(session: InterviewSession): void {
    if (session.phase === "framing") {
      this.store.setPhase(session.id, "coding");
      this.broadcast("interview.phase", { sessionId: session.id, phase: "coding" });
    }
  }

  private latestEval(id: string): EvalResult | undefined {
    const attempts = this.store.getAttempts(id);
    return attempts.length ? attempts[attempts.length - 1] : undefined;
  }

  private streamInterviewer(
    session: InterviewSession,
    phase: InterviewPhase,
    turnId: string,
    extra?: { code?: string; lastEval?: EvalResult; interrogationOpener?: boolean },
  ): void {
    const problem = findProblem(this.importStore, session.problemId);
    if (!problem) return;
    const turns = this.store
      .getTurns(session.id)
      .filter((t) => t.id !== turnId && t.kind !== "phase" && t.content.trim());
    const args: StreamTurnArgs = {
      sessionId: session.id,
      turnId,
      phase,
      problem,
      turns,
      onComplete: (text) => this.store.updateTurnContent(turnId, text),
    };
    if (phase === "framing") {
      // Interviewer signals an adequate framing with [BEGIN CODING] (stripped
      // before it reaches the renderer). /run and /hint remain the fail-open
      // mechanical transition if the model never emits it.
      args.onBeginCoding = () => {
        const current = this.store.getSession(session.id);
        if (!current || current.phase !== "framing") return;
        this.store.addTurn({
          sessionId: session.id,
          role: "interviewer",
          kind: "phase",
          content: "Framing accepted — start coding.",
        });
        this.maybeEnterCoding(current);
      };
    }
    if (extra?.code) args.code = extra.code;
    if (extra?.lastEval) args.lastEval = extra.lastEval;
    if (extra?.interrogationOpener) args.interrogationOpener = true;
    void this.interviewer.streamTurn(args);
  }

  /**
   * Practice grading: a deterministic, LLM-free scorecard from the test results
   * and hint usage. No interviewer call, no scorecard stream. Practice does NOT
   * write memories — it is a low-stakes grind, not a graded mock, so it must not
   * flood the profile's mistake/skill records or the spaced-repetition queue.
   */
  private async gradePracticeAndPersist(session: InterviewSession): Promise<void> {
    const problem = findProblem(this.importStore, session.problemId);
    if (!problem) return;
    const endISO = new Date().toISOString();
    const attempts = this.store.getAttempts(session.id);
    const turns = this.store.getTurns(session.id);
    const durationSec = Math.max(
      0,
      Math.round((Date.parse(endISO) - Date.parse(session.startedAt)) / 1000),
    );
    const scorecard = gradePractice({
      problem,
      session,
      turns,
      code: this.store.getCode(session.id) ?? "",
      attempts,
      hintsUsed: session.hintsUsed,
      durationSec,
      endISO,
    });
    this.store.setScorecard(scorecard);
    this.store.setEnded(session.id, endISO);
    this.broadcast("interview.scorecard", { sessionId: session.id, scorecard });
  }

  private async gradeAndPersist(session: InterviewSession): Promise<void> {
    const problem = findProblem(this.importStore, session.problemId);
    if (!problem) return;
    const endISO = new Date().toISOString();
    const attempts = this.store.getAttempts(session.id);
    const turns = this.store.getTurns(session.id);
    const durationSec = Math.max(
      0,
      Math.round((Date.parse(endISO) - Date.parse(session.startedAt)) / 1000),
    );
    const router = this.router;
    const scorecard = await this.gradeFn({
      problem,
      session,
      turns,
      code: this.store.getCode(session.id) ?? "",
      attempts,
      hintsUsed: session.hintsUsed,
      durationSec,
      endISO,
      // Route the grader through the scorecard surface (local or cloud). If no
      // router is wired the default falls back to a direct local call.
      ...(router
        ? {
            once: (o) =>
              router.once({
                surface: "scorecard",
                messages: o.messages,
                ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
                ...(o.format ? { format: o.format } : {}),
              }),
          }
        : {}),
    });
    if (this.memory) {
      const memory = this.memory;
      scorecard.memoryWrites = await writeScorecardMemories(scorecard, problem, (i) =>
        memory.saveMemory(i),
      );
    }
    this.store.setScorecard(scorecard);
    this.store.setEnded(session.id, endISO);
    this.broadcast("interview.scorecard", { sessionId: session.id, scorecard });
  }

  private problemStats(): Map<string, { best: number; solved: boolean }> {
    const map = new Map<string, { best: number; solved: boolean }>();
    for (const s of this.store.listSessions()) {
      const sc = this.store.getScorecard(s.id);
      if (!sc) continue;
      const cur = map.get(s.problemId) ?? { best: -1, solved: false };
      cur.best = Math.max(cur.best, sc.score);
      if (sc.testsTotal > 0 && sc.testsPassed === sc.testsTotal) cur.solved = true;
      map.set(s.problemId, cur);
    }
    return map;
  }

  private recommend(stats: Map<string, { best: number; solved: boolean }>): RecResult | null {
    const solvedIds = new Set(
      [...stats].filter(([, v]) => v.solved).map(([k]) => k),
    );
    const mistakes: MistakeSignal[] = [];
    if (this.memory) {
      const records = [
        ...this.memory.listMemories({ type: "mistake" }),
        ...this.memory
          .listMemories({ type: "skill" })
          .filter((r) => r.tags.includes("weakness")),
      ];
      for (const r of records) {
        mistakes.push({ title: r.title, body: r.body, count: parseCount(r.tags) });
      }
    }
    return recommendProblem(allProblems(this.importStore), mistakes, solvedIds);
  }

  private recommendedOrDefault(): string {
    const rec = this.recommend(this.problemStats());
    return rec?.id ?? (allProblems(this.importStore)[0] as BankProblem).id;
  }
}

/** Mistake frequency lives in a `count:N` tag (interview-prep import convention). */
function parseCount(tags: string[]): number {
  for (const t of tags) {
    const m = t.match(/^count:(\d+)$/i);
    if (m) return Number.parseInt(m[1], 10);
  }
  return 1;
}
