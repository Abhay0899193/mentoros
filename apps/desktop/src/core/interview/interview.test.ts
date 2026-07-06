import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  EvalResult,
  InterviewPhase,
  InterviewScorecard,
  InterviewSession,
  InterviewTurn,
  SaveMemoryInput,
  SaveMemoryResult,
  MemoryRecord,
} from "../types.js";
import { PROBLEMS, getBankProblem, toPublicProblem } from "./problems.js";
import { runTests } from "./runner.js";
import {
  fallbackGrade,
  nextReviewDate,
  writeScorecardMemories,
} from "./scorecard.js";
import { recommendProblem, type MistakeSignal } from "./recommend.js";
import { InterviewEngine, InterviewConflict } from "./engine.js";
import type {
  AddTurnInput,
  CreateSessionInput,
  IInterviewStore,
} from "./store.js";

/* ------------------------------ tmp helper ----------------------------- */

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "iv-run-"));
}

/* --------------------------- runner (python) --------------------------- */

test("runner python: passes a correct solution and reports actual", async () => {
  const root = await tmpRoot();
  const res = await runTests({
    language: "python",
    functionName: "add",
    code: "def add(a, b):\n    return a + b\n",
    tests: [{ name: "t", args: [2, 3], expected: 5 }],
    tmpRoot: root,
  });
  assert.equal(res.passed, 1);
  assert.equal(res.total, 1);
  assert.equal(res.results[0].passed, true);
  assert.equal(res.results[0].actual, "5");
  assert.equal(res.compileError, undefined);
});

test("runner python: fails a wrong solution and captures the actual value", async () => {
  const root = await tmpRoot();
  const res = await runTests({
    language: "python",
    functionName: "add",
    code: "def add(a, b):\n    return a - b\n",
    tests: [{ name: "t", args: [2, 3], expected: 5 }],
    tmpRoot: root,
  });
  assert.equal(res.passed, 0);
  assert.equal(res.results[0].passed, false);
  assert.equal(res.results[0].actual, "-1");
});

test("runner python: syntax error surfaces as compileError, no tests run", async () => {
  const root = await tmpRoot();
  const res = await runTests({
    language: "python",
    functionName: "add",
    code: "def add(a, b)\n    return a + b\n", // missing colon
    tests: [{ name: "t", args: [1, 1], expected: 2 }],
    tmpRoot: root,
  });
  assert.ok(res.compileError, "compileError is set");
  assert.equal(res.passed, 0);
  assert.equal(res.results.length, 0);
});

test("runner python: infinite loop is killed and remaining tests marked timeout", async () => {
  const root = await tmpRoot();
  const res = await runTests({
    language: "python",
    functionName: "spin",
    code: "def spin(x):\n    while True:\n        pass\n",
    tests: [{ name: "t", args: [1], expected: 1 }],
    tmpRoot: root,
    timeoutMs: 1200,
  });
  assert.equal(res.passed, 0);
  assert.equal(res.results[0].passed, false);
  assert.equal(res.results[0].error, "timeout");
});

test("runner python: sortInner normalization makes order-insensitive answers pass", async () => {
  const root = await tmpRoot();
  const res = await runTests({
    language: "python",
    functionName: "pair",
    code: "def pair(nums):\n    return [1, 0]\n",
    tests: [{ name: "t", args: [[9, 2]], expected: [0, 1], normalize: "sortInner" }],
    tmpRoot: root,
  });
  assert.equal(res.results[0].passed, true, "[1,0] matches [0,1] under sortInner");
});

/* ----------------------------- runner (js) ----------------------------- */

test("runner javascript: passes a correct solution", async () => {
  const root = await tmpRoot();
  const res = await runTests({
    language: "javascript",
    functionName: "add",
    code: "function add(a, b) {\n  return a + b;\n}\n",
    tests: [{ name: "t", args: [2, 3], expected: 5 }],
    tmpRoot: root,
  });
  assert.equal(res.passed, 1);
  assert.equal(res.results[0].actual, "5");
});

test("runner javascript: syntax error surfaces as compileError", async () => {
  const root = await tmpRoot();
  const res = await runTests({
    language: "javascript",
    functionName: "add",
    code: "function add(a, b) { return a + ; }\n",
    tests: [{ name: "t", args: [1, 1], expected: 2 }],
    tmpRoot: root,
  });
  assert.ok(res.compileError, "compileError is set for a JS syntax error");
  assert.equal(res.results.length, 0);
});

test("runner javascript: a thrown runtime error fails just that test", async () => {
  const root = await tmpRoot();
  const res = await runTests({
    language: "javascript",
    functionName: "boom",
    code: "function boom(x) {\n  if (x === 2) throw new Error('nope');\n  return x;\n}\n",
    tests: [
      { name: "ok", args: [1], expected: 1 },
      { name: "throws", args: [2], expected: 2 },
    ],
    tmpRoot: root,
  });
  assert.equal(res.passed, 1);
  assert.equal(res.results[1].passed, false);
  assert.ok(res.results[1].error && /nope/.test(res.results[1].error));
});

/* --------------------------- bank integrity ---------------------------- */

test("bank: exactly 10 problems with the expected LeetCode set", () => {
  assert.equal(PROBLEMS.length, 10);
  const lc = PROBLEMS.map((p) => p.lcNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(lc, [1, 3, 20, 33, 42, 53, 56, 121, 200, 322]);
  const ids = new Set(PROBLEMS.map((p) => p.id));
  assert.equal(ids.size, 10, "problem ids are unique");
});

test("bank: every problem is complete (prompt, both starters, >=8 tests, 3 hints)", () => {
  for (const p of PROBLEMS) {
    assert.ok(p.promptMd.trim().length > 40, `${p.id} has a non-empty promptMd`);
    assert.ok(p.functionName.length > 0, `${p.id} has a functionName`);
    assert.ok(p.starterCode.python.includes(p.functionName), `${p.id} python starter defines ${p.functionName}`);
    assert.ok(p.starterCode.javascript.includes(p.functionName), `${p.id} js starter defines ${p.functionName}`);
    assert.ok(p.tests.length >= 8, `${p.id} has >=8 hidden tests (has ${p.tests.length})`);
    for (const t of p.tests) {
      assert.ok(t.name && Array.isArray(t.args), `${p.id}/${t.name} is well-formed`);
      // arguments + expected must be JSON round-trippable
      assert.doesNotThrow(() => JSON.stringify([t.args, t.expected]));
    }
    assert.equal(p.hints.length, 3, `${p.id} has 3 hints`);
    for (const h of p.hints) assert.ok(h.trim().length > 10, `${p.id} hint is substantive`);
  }
});

test("bank: public problem shape hides tests and hints", () => {
  const pub = toPublicProblem(PROBLEMS[0]) as unknown as Record<string, unknown>;
  assert.equal(pub.tests, undefined, "tests are stripped from the public shape");
  assert.equal(pub.hints, undefined, "hints are stripped from the public shape");
  assert.ok(typeof pub.promptMd === "string" && (pub.promptMd as string).length > 0);
});

/* ------------------------- review-interval math ------------------------ */

test("nextReviewDate: absolute ISO offsets per spaced-rep grade", () => {
  const from = "2026-07-06T12:00:00.000Z";
  const day = (iso: string) => iso.slice(0, 10);
  assert.equal(day(nextReviewDate(5, from)), "2026-07-27"); // +21
  assert.equal(day(nextReviewDate(4, from)), "2026-07-16"); // +10
  assert.equal(day(nextReviewDate(3, from)), "2026-07-10"); // +4
  assert.equal(day(nextReviewDate(2, from)), "2026-07-08"); // +2
  assert.equal(day(nextReviewDate(1, from)), "2026-07-07"); // +1
  assert.equal(day(nextReviewDate(0, from)), "2026-07-07"); // +1
});

/* ----------------------- fallback scorecard math ----------------------- */

function attempt(passed: number, total: number, over?: Partial<EvalResult>): EvalResult {
  return {
    attemptId: "a1",
    passed,
    total,
    results: [],
    durationMs: 5,
    ranAt: "2026-07-06T12:00:00.000Z",
    ...over,
  };
}

function gradeInput(over: Partial<Parameters<typeof fallbackGrade>[0]> = {}) {
  const problem = getBankProblem("two-sum")!;
  const session: InterviewSession = {
    id: "s1",
    type: "coding",
    problemId: "two-sum",
    language: "python",
    phase: "scorecard",
    hintsUsed: 0,
    startedAt: "2026-07-06T12:00:00.000Z",
  };
  return {
    problem,
    session,
    turns: [] as InterviewTurn[],
    code: "def twoSum(nums, target):\n    return [0, 1]\n",
    attempts: [attempt(10, 10)],
    hintsUsed: 0,
    durationSec: 300,
    endISO: "2026-07-06T12:05:00.000Z",
    ...over,
  };
}

test("fallbackGrade: deterministic — same input yields the same scorecard", () => {
  const input = gradeInput();
  const a = fallbackGrade(input, 10, 10);
  const b = fallbackGrade(input, 10, 10);
  assert.deepEqual(a, b);
});

test("fallbackGrade: full pass + no hints scores high; failures + hints score low", () => {
  const clean = fallbackGrade(gradeInput({ hintsUsed: 0 }), 10, 10);
  assert.equal(clean.score, 8);
  assert.equal(clean.recallGrade, 5);
  assert.equal(clean.dimensions.find((d) => d.name === "correctness")?.verdict, "pass");

  const rough = fallbackGrade(
    gradeInput({ hintsUsed: 3, attempts: [attempt(3, 10)] }),
    3,
    10,
  );
  assert.ok(rough.score < clean.score, "hints + failures lower the score");
  assert.ok(rough.recallGrade < clean.recallGrade);
  assert.equal(rough.dimensions.find((d) => d.name === "correctness")?.verdict, "fail");
  assert.equal(rough.nextProblems.length, 3);
});

/* ---------------------------- recommendation --------------------------- */

test("recommendProblem: complexity-miscalc mistake targets a dp/two-pointer problem", () => {
  const mistakes: MistakeSignal[] = [
    { title: "Complexity miscalculation", body: "kept computing big-O wrong", count: 8 },
  ];
  const rec = recommendProblem(PROBLEMS, mistakes, new Set());
  assert.ok(rec, "a recommendation is produced");
  const picked = getBankProblem(rec!.id)!;
  assert.ok(
    ["dp-1d", "two-pointers", "sliding-window"].includes(picked.pattern),
    `picked pattern ${picked.pattern} targets the complexity weakness`,
  );
  assert.match(rec!.reason, /targets: Complexity miscalculation ×8/);
});

test("recommendProblem: no mistakes falls back to the easiest unsolved problem", () => {
  const rec = recommendProblem(PROBLEMS, [], new Set());
  assert.ok(rec);
  assert.equal(getBankProblem(rec!.id)!.difficulty, "easy");
});

/* ------------------ engine: store CRUD + phase transitions -------------- */

class FakeStore implements IInterviewStore {
  sessions = new Map<string, InterviewSession>();
  codes = new Map<string, string>();
  turns: InterviewTurn[] = [];
  attempts = new Map<string, EvalResult[]>();
  scorecards = new Map<string, InterviewScorecard>();
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  createSession(input: CreateSessionInput): InterviewSession {
    const s: InterviewSession = {
      id: this.id("s"),
      type: input.type,
      problemId: input.problemId,
      language: input.language,
      phase: "framing",
      hintsUsed: 0,
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(s.id, s);
    return s;
  }
  getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? { ...s } : undefined;
  }
  listSessions() {
    return [...this.sessions.values()].map((s) => ({ ...s }));
  }
  setPhase(id: string, phase: InterviewPhase) {
    const s = this.sessions.get(id);
    if (s) s.phase = phase;
  }
  setCode(id: string, code: string) {
    this.codes.set(id, code);
  }
  getCode(id: string) {
    return this.codes.get(id);
  }
  incHints(id: string) {
    const s = this.sessions.get(id);
    if (!s) return 0;
    s.hintsUsed += 1;
    return s.hintsUsed;
  }
  setEnded(id: string, endedAt: string) {
    const s = this.sessions.get(id);
    if (s) s.endedAt = endedAt;
  }
  addTurn(input: AddTurnInput): InterviewTurn {
    const t: InterviewTurn = {
      id: this.id("t"),
      sessionId: input.sessionId,
      role: input.role,
      kind: input.kind,
      content: input.content,
      createdAt: new Date().toISOString(),
    };
    if (input.hintLevel) t.hintLevel = input.hintLevel;
    this.turns.push(t);
    return t;
  }
  updateTurnContent(id: string, content: string) {
    const t = this.turns.find((x) => x.id === id);
    if (t) t.content = content;
  }
  getTurns(sessionId: string) {
    return this.turns.filter((t) => t.sessionId === sessionId).map((t) => ({ ...t }));
  }
  addAttempt(sessionId: string, result: EvalResult) {
    const list = this.attempts.get(sessionId) ?? [];
    list.push(result);
    this.attempts.set(sessionId, list);
  }
  getAttempts(sessionId: string) {
    return [...(this.attempts.get(sessionId) ?? [])];
  }
  setScorecard(sc: InterviewScorecard) {
    this.scorecards.set(sc.sessionId, sc);
  }
  getScorecard(sessionId: string) {
    return this.scorecards.get(sessionId);
  }
}

function makeEngine() {
  const events: Array<{ event: string; payload: any }> = [];
  const store = new FakeStore();
  const streamCalls: any[] = [];
  const broadcast = (event: string, payload: unknown) => {
    events.push({ event, payload });
  };

  const memoryWrites: SaveMemoryInput[] = [];
  const memory = {
    listMemories: (): MemoryRecord[] => [],
    saveMemory: async (input: SaveMemoryInput): Promise<SaveMemoryResult> => {
      memoryWrites.push(input);
      return {
        record: {
          id: `m-${memoryWrites.length}`,
          type: input.type,
          title: input.title ?? input.body.slice(0, 20),
          body: input.body,
          confidence: input.confidence ?? 0.7,
          source: input.source,
          tags: input.tags ?? [],
          links: [],
          createdAt: "now",
          updatedAt: "now",
          history: [],
        },
        action: "created",
      };
    },
  };

  const engine = new InterviewEngine({
    store,
    broadcast: broadcast as any,
    dataDir: join(tmpdir(), "iv-engine"),
    memory,
    interviewer: {
      streamTurn: async (args) => {
        streamCalls.push(args);
        args.onComplete("interviewer says something terse");
      },
    },
    runFn: async () => ({
      passed: 10,
      total: 10,
      results: [],
      durationMs: 4,
      ranAt: new Date().toISOString(),
    }),
    gradeFn: async (input) => ({
      sessionId: input.session.id,
      score: 7,
      bar: "L5",
      summary: "solid",
      biggestMistake: "off-by-one in the loop bound",
      biggestTakeaway: "verify boundaries before declaring done",
      pattern: input.problem.pattern,
      patternConfidence: 4,
      dimensions: [{ name: "correctness", verdict: "pass", note: "ok" }],
      nextProblems: [{ title: "Merge Intervals", reason: "intervals practice" }],
      recallGrade: 4,
      nextReviewDate: nextReviewDate(4, input.endISO),
      hintsUsed: input.hintsUsed,
      testsPassed: 10,
      testsTotal: 10,
      durationSec: input.durationSec,
      memoryWrites: [],
      createdAt: input.endISO,
    }),
  });

  return { engine, store, events, streamCalls, memoryWrites };
}

test("engine.startSession: creates a framing session and streams the opener", () => {
  const { engine, store, streamCalls } = makeEngine();
  const { session, problem } = engine.startSession({ type: "coding", language: "python" });
  assert.equal(session.phase, "framing");
  assert.ok(getBankProblem(problem.id), "resolved to a real bank problem");
  assert.equal((problem as unknown as Record<string, unknown>).tests, undefined, "no tests leak to the client");
  const turns = store.getTurns(session.id);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].role, "interviewer");
  assert.equal(streamCalls[0].phase, "framing");
});

test("engine.run: first run moves framing → coding and persists the attempt", async () => {
  const { engine, store, events } = makeEngine();
  const { session } = engine.startSession({ type: "coding", problemId: "two-sum", language: "python" });
  const result = await engine.run(session.id, "def twoSum(n,t): return [0,1]");
  assert.equal(store.getSession(session.id)!.phase, "coding");
  assert.equal(store.getAttempts(session.id).length, 1);
  assert.ok(result.attemptId, "attempt id assigned");
  assert.ok(events.some((e) => e.event === "interview.phase" && e.payload.phase === "coding"));
});

test("engine.hint: ladder increments and is exhausted after three", () => {
  const { engine, store, events } = makeEngine();
  const { session } = engine.startSession({ type: "coding", problemId: "two-sum", language: "python" });
  const problem = getBankProblem("two-sum")!;

  const h1 = engine.hint(session.id);
  assert.equal(h1.level, 1);
  const hintTurn = store.getTurns(session.id).find((t) => t.id === h1.replyTurnId)!;
  assert.equal(hintTurn.kind, "hint");
  assert.equal(hintTurn.content, problem.hints[0]);
  assert.ok(events.some((e) => e.event === "interview.token" && e.payload.token === problem.hints[0]));

  assert.equal(engine.hint(session.id).level, 2);
  assert.equal(engine.hint(session.id).level, 3);
  assert.equal(store.getSession(session.id)!.hintsUsed, 3);
  assert.throws(() => engine.hint(session.id), InterviewConflict);
});

test("engine.finish: transitions to interrogation with an opener turn", () => {
  const { engine, store, events, streamCalls } = makeEngine();
  const { session } = engine.startSession({ type: "coding", problemId: "two-sum", language: "python" });
  engine.finish(session.id, "def twoSum(n,t): return [0,1]");
  assert.equal(store.getSession(session.id)!.phase, "interrogation");
  assert.ok(events.some((e) => e.event === "interview.phase" && e.payload.phase === "interrogation"));
  const last = streamCalls[streamCalls.length - 1];
  assert.equal(last.phase, "interrogation");
  assert.equal(last.interrogationOpener, true);
  assert.ok(store.getTurns(session.id).some((t) => t.kind === "phase"));
});

test("engine.end: grades async, persists the scorecard, and writes memories", async () => {
  const { engine, store, events, memoryWrites } = makeEngine();
  const { session } = engine.startSession({ type: "coding", problemId: "two-sum", language: "python" });
  await engine.run(session.id, "def twoSum(n,t): return [0,1]");
  const ret = engine.end(session.id);
  assert.deepEqual(ret, { started: true });
  assert.equal(store.getSession(session.id)!.phase, "scorecard");

  // gradeAndPersist is fired async; wait for the scorecard to land.
  const sc = await waitFor(() => store.getScorecard(session.id));
  assert.equal(sc.score, 7);
  assert.ok(store.getSession(session.id)!.endedAt, "ended_at set");
  assert.ok(events.some((e) => e.event === "interview.scorecard"));
  // skill + mistake + learning writebacks
  assert.equal(memoryWrites.length, 3);
  assert.deepEqual(
    memoryWrites.map((m) => m.type).sort(),
    ["learning", "mistake", "skill"],
  );
  assert.equal(sc.memoryWrites.length, 3);
});

test("engine.abandon: marks the session abandoned", () => {
  const { engine, store, events } = makeEngine();
  const { session } = engine.startSession({ type: "coding", problemId: "two-sum", language: "python" });
  assert.equal(engine.abandon(session.id), true);
  assert.equal(store.getSession(session.id)!.phase, "abandoned");
  assert.ok(events.some((e) => e.event === "interview.phase" && e.payload.phase === "abandoned"));
  assert.equal(engine.abandon("nope"), false);
});

/* ---------------------- scorecard memory writeback --------------------- */

test("writeScorecardMemories: emits skill + mistake + learning with pattern tags", async () => {
  const saved: SaveMemoryInput[] = [];
  const save = async (input: SaveMemoryInput): Promise<SaveMemoryResult> => {
    saved.push(input);
    return {
      record: {
        id: `m${saved.length}`,
        type: input.type,
        title: input.title ?? "",
        body: input.body,
        confidence: 0.7,
        source: input.source,
        tags: input.tags ?? [],
        links: [],
        createdAt: "now",
        updatedAt: "now",
        history: [],
      },
      action: "created",
    };
  };
  const problem = getBankProblem("coin-change")!;
  const sc: InterviewScorecard = {
    sessionId: "s1",
    score: 3,
    bar: "L5",
    summary: "",
    biggestMistake: "greedy assumption on coin denominations",
    biggestTakeaway: "reach for 1-D DP when subproblems overlap",
    pattern: "dp-1d",
    patternConfidence: 2,
    dimensions: [],
    nextProblems: [],
    recallGrade: 2,
    nextReviewDate: "2026-07-08T00:00:00.000Z",
    hintsUsed: 2,
    testsPassed: 6,
    testsTotal: 10,
    durationSec: 400,
    memoryWrites: [],
    createdAt: "2026-07-06T12:05:00.000Z",
  };
  const writes = await writeScorecardMemories(sc, problem, save);
  assert.equal(writes.length, 3);
  const skill = saved.find((s) => s.type === "skill")!;
  assert.ok(skill.tags?.includes("weakness"), "low confidence tags the skill as a weakness");
  assert.ok(skill.tags?.includes("dp-1d"));
  assert.ok(saved.some((s) => s.type === "mistake"));
  assert.ok(saved.some((s) => s.type === "learning"));
});

/* ------------------------------- helpers ------------------------------- */

async function waitFor<T>(fn: () => T | undefined, tries = 50): Promise<T> {
  for (let i = 0; i < tries; i += 1) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor: condition never met");
}
