import { chatOnce, type OllamaMessage } from "../ollama.js";
import type {
  EvalResult,
  InterviewScorecard,
  InterviewSession,
  InterviewTurn,
  SaveMemoryInput,
  SaveMemoryResult,
  ScorecardDimension,
} from "../types.js";
import type { BankProblem } from "./problems.js";
import { PROBLEMS } from "./problems.js";

/**
 * Scorecard grading (§3.6). Preferred path: llama3.1 with `format:'json'` and a
 * strict schema, validated + clamped, retried once. Fallback (Ollama down or two
 * bad parses): a deterministic scorecard derived from test results + hint usage,
 * honestly flagged as offline. Either way the result drives spaced repetition
 * (§5) and the memory writeback that produces the "Profile updated" moment.
 */

/** recallGrade → interval in days; absolute date is computed from session end. */
const REVIEW_INTERVAL_DAYS: Record<number, number> = { 5: 21, 4: 10, 3: 4, 2: 2, 1: 1, 0: 1 };

/** Canonical 16 review dimensions; the grader picks the 8 most relevant. */
export const REVIEW_DIMENSIONS = [
  "correctness",
  "hidden bugs",
  "edge cases",
  "performance",
  "readability",
  "naming",
  "complexity justification",
  "interview quality",
  "problem decomposition",
  "data structure choice",
  "algorithmic approach",
  "communication",
  "testing rigor",
  "code style",
  "time management",
  "handling of feedback",
] as const;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

export function nextReviewDate(grade: number, fromISO: string): string {
  const g = clamp(Math.round(grade), 0, 5);
  const days = REVIEW_INTERVAL_DAYS[g] ?? 1;
  const base = new Date(fromISO);
  const d = Number.isNaN(base.getTime()) ? new Date() : base;
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out.toISOString();
}

/**
 * A single non-streaming completion for grading — routed (surface 'scorecard')
 * by the engine, or the local default below. format:'json' is meaningful on the
 * Ollama path; cloud ignores it (the prompt already demands JSON).
 */
export type ScorecardOnce = (opts: {
  messages: OllamaMessage[];
  format?: "json";
  timeoutMs?: number;
}) => Promise<string>;

export interface GradeInput {
  problem: BankProblem;
  session: InterviewSession;
  turns: InterviewTurn[];
  code: string;
  attempts: EvalResult[];
  hintsUsed: number;
  durationSec: number;
  /** Session end timestamp — the anchor for the next-review date. */
  endISO: string;
  /** Injected grader call; defaults to a local Ollama completion. */
  once?: ScorecardOnce;
}

/** Local grader used when the engine wires no router (deterministic temp 0). */
const localOnce: ScorecardOnce = (o) =>
  chatOnce({
    messages: o.messages,
    options: { temperature: 0 },
    ...(o.format ? { format: o.format } : {}),
    ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
  });

/** Best attempt = the run with the most passing tests (ties: latest). */
function bestAttempt(attempts: EvalResult[]): EvalResult | undefined {
  let best: EvalResult | undefined;
  for (const a of attempts) {
    if (!best || a.passed >= best.passed) best = a;
  }
  return best;
}

function testTotals(input: GradeInput): { passed: number; total: number } {
  const best = bestAttempt(input.attempts);
  if (best) return { passed: best.passed, total: best.total };
  return { passed: 0, total: input.problem.tests.length };
}

/* ----------------------------- LLM grading ----------------------------- */

function gradingMessages(input: GradeInput, passed: number, total: number) {
  const transcript = input.turns
    .filter((t) => t.content.trim())
    .map((t) => `${t.role === "candidate" ? "CANDIDATE" : "INTERVIEWER"}${t.kind === "hint" ? ` (hint ${t.hintLevel})` : ""}: ${t.content}`)
    .join("\n");
  const dims = REVIEW_DIMENSIONS.join(", ");
  const schema = `Return ONLY JSON with this exact shape:
{
  "score": <integer 0-10 calibrated to the L5 bar>,
  "summary": <2-3 sentence verdict, terse, no praise-padding>,
  "biggestMistake": <one sentence, root-cause phrasing>,
  "biggestTakeaway": <one sentence, actionable>,
  "patternConfidence": <integer 1-5, how solidly they showed the ${input.problem.pattern} pattern>,
  "dimensions": [ {"name": <one of: ${dims}>, "verdict": "pass"|"warn"|"fail", "note": <short>} ]  // pick the 8 MOST RELEVANT,
  "nextProblems": [ {"title": <problem title>, "reason": <why it targets the weakness>} ]  // exactly 3,
  "recallGrade": <integer 0-5 spaced-repetition grade: 5=effortless+optimal, 0=failed>
}`;
  return [
    {
      role: "system" as const,
      content:
        "You are a Staff Engineer grading a coding interview to the L5 bar. Be exacting and honest; do not inflate. No praise-padding, no emojis. Output valid JSON only.",
    },
    {
      role: "user" as const,
      content: [
        `PROBLEM: ${input.problem.title} (${input.problem.difficulty}, pattern: ${input.problem.pattern}).`,
        `HIDDEN TESTS: ${passed}/${total} passed. HINTS USED: ${input.hintsUsed}/3. DURATION: ${input.durationSec}s.`,
        `FINAL CODE:\n${input.code || "(none submitted)"}`,
        `TRANSCRIPT:\n${transcript || "(no discussion)"}`,
        schema,
      ].join("\n\n"),
    },
  ];
}

interface ParsedGrade {
  score: number;
  summary: string;
  biggestMistake: string;
  biggestTakeaway: string;
  patternConfidence: number;
  dimensions: ScorecardDimension[];
  nextProblems: { title: string; reason: string }[];
  recallGrade: number;
}

function validateGrade(raw: unknown): ParsedGrade | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.score !== "number" ||
    typeof o.summary !== "string" ||
    typeof o.patternConfidence !== "number" ||
    typeof o.recallGrade !== "number" ||
    !Array.isArray(o.dimensions) ||
    !Array.isArray(o.nextProblems)
  ) {
    return null;
  }
  const dimensions: ScorecardDimension[] = [];
  for (const d of o.dimensions as unknown[]) {
    if (!d || typeof d !== "object") continue;
    const dd = d as Record<string, unknown>;
    const verdict = dd.verdict === "pass" || dd.verdict === "warn" || dd.verdict === "fail" ? dd.verdict : "warn";
    if (typeof dd.name !== "string") continue;
    dimensions.push({ name: dd.name, verdict, note: typeof dd.note === "string" ? dd.note : "" });
  }
  if (dimensions.length === 0) return null;
  const nextProblems: { title: string; reason: string }[] = [];
  for (const p of o.nextProblems as unknown[]) {
    if (!p || typeof p !== "object") continue;
    const pp = p as Record<string, unknown>;
    if (typeof pp.title === "string") {
      nextProblems.push({ title: pp.title, reason: typeof pp.reason === "string" ? pp.reason : "" });
    }
  }
  return {
    score: clamp(Math.round(o.score), 0, 10),
    summary: o.summary,
    biggestMistake: typeof o.biggestMistake === "string" ? o.biggestMistake : "",
    biggestTakeaway: typeof o.biggestTakeaway === "string" ? o.biggestTakeaway : "",
    patternConfidence: clamp(Math.round(o.patternConfidence), 1, 5),
    dimensions: dimensions.slice(0, 8),
    nextProblems: nextProblems.slice(0, 3),
    recallGrade: clamp(Math.round(o.recallGrade), 0, 5),
  };
}

/** Grade a finished session. Never throws — always returns a scorecard. */
export async function gradeScorecard(input: GradeInput): Promise<InterviewScorecard> {
  const { passed, total } = testTotals(input);
  const once = input.once ?? localOnce;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await once({
        messages: gradingMessages(input, passed, total),
        format: "json",
        timeoutMs: 45_000,
      });
      const parsed = validateGrade(JSON.parse(raw));
      if (parsed) return assemble(input, parsed, passed, total, false);
    } catch {
      break; // adapter threw (daemon down / cloud error) — offline fallback
    }
  }
  return assemble(input, fallbackGrade(input, passed, total), passed, total, true);
}

function assemble(
  input: GradeInput,
  g: ParsedGrade,
  passed: number,
  total: number,
  offline: boolean,
): InterviewScorecard {
  const nextProblems = g.nextProblems.length ? g.nextProblems : suggestNextProblems(input.problem);
  const patternConfidence = g.patternConfidence as 1 | 2 | 3 | 4 | 5;
  return {
    sessionId: input.session.id,
    score: g.score,
    bar: "L5",
    summary: offline ? `Graded offline (Ollama unavailable): ${g.summary}` : g.summary,
    biggestMistake: g.biggestMistake,
    biggestTakeaway: g.biggestTakeaway,
    pattern: input.problem.pattern,
    patternConfidence,
    dimensions: g.dimensions,
    nextProblems,
    recallGrade: g.recallGrade,
    nextReviewDate: nextReviewDate(g.recallGrade, input.endISO),
    hintsUsed: input.hintsUsed,
    testsPassed: passed,
    testsTotal: total,
    durationSec: input.durationSec,
    memoryWrites: [],
    createdAt: input.endISO,
  };
}

/* --------------------------- offline fallback -------------------------- */

export function fallbackGrade(input: GradeInput, passed: number, total: number): ParsedGrade {
  const best = bestAttempt(input.attempts);
  const ratio = total > 0 ? passed / total : 0;
  const score = clamp(Math.round(ratio * 8) - input.hintsUsed, 0, 8);
  const patternConfidence = clamp(Math.round(ratio * 4) + 1 - (input.hintsUsed >= 2 ? 1 : 0), 1, 5);
  const recallGrade = clamp(Math.round(ratio * 5) - (input.hintsUsed > 0 ? 1 : 0), 0, 5);
  const allPassed = total > 0 && passed === total;
  const perf = best?.results.find((r) => /perf/i.test(r.name));
  const compileFailed = Boolean(best?.compileError);

  const verdict = (ok: boolean): ScorecardDimension["verdict"] => (ok ? "pass" : "fail");
  const dimensions: ScorecardDimension[] = [
    { name: "correctness", verdict: compileFailed ? "fail" : verdict(allPassed), note: `${passed}/${total} hidden tests passed.` },
    { name: "hidden bugs", verdict: allPassed ? "pass" : "warn", note: allPassed ? "No failing tests." : "Some tests failed — logic gaps remain." },
    { name: "edge cases", verdict: allPassed ? "pass" : "warn", note: allPassed ? "Edge tests passed." : "Review empty/size-1/duplicate cases." },
    { name: "performance", verdict: perf ? verdict(perf.passed) : "warn", note: perf ? (perf.passed ? "Large input within time." : "Timed out / too slow on the large case.") : "No perf signal." },
    { name: "complexity justification", verdict: "warn", note: "Not assessed offline." },
    { name: "readability", verdict: "warn", note: "Not assessed offline." },
    { name: "naming", verdict: "warn", note: "Not assessed offline." },
    { name: "interview quality", verdict: input.hintsUsed > 0 ? "warn" : "pass", note: `${input.hintsUsed} hint(s) used.` },
  ];

  let biggestMistake: string;
  if (compileFailed) biggestMistake = "Submitted code that did not compile or run — verify it executes before declaring done.";
  else if (!allPassed) biggestMistake = `Correctness gap: ${total - passed} of ${total} hidden tests failed, likely on edge or performance cases.`;
  else if (input.hintsUsed > 0) biggestMistake = `Reached a working solution but needed ${input.hintsUsed} hint(s) to recognize the ${input.problem.pattern} pattern.`;
  else biggestMistake = "No blocking mistake on tests; deepen the complexity justification to raise the bar.";

  const biggestTakeaway = allPassed && input.hintsUsed === 0
    ? `Solid on ${input.problem.pattern}. Rehearse the complexity derivation out loud to convert competence into a clean interview signal.`
    : `Drill the ${input.problem.pattern} pattern so recognition is automatic and hint-free.`;

  return {
    score,
    summary: `${passed}/${total} hidden tests passed with ${input.hintsUsed} hint(s) over ${input.durationSec}s. Test-based grading only.`,
    biggestMistake,
    biggestTakeaway,
    patternConfidence,
    dimensions,
    nextProblems: suggestNextProblems(input.problem),
    recallGrade,
  };
}

/** Three follow-ups: prefer the same pattern, then the same difficulty. */
export function suggestNextProblems(problem: BankProblem): { title: string; reason: string }[] {
  const pool = PROBLEMS.filter((p) => p.id !== problem.id);
  const samePattern = pool.filter((p) => p.pattern === problem.pattern);
  const sameDifficulty = pool.filter((p) => p.difficulty === problem.difficulty && p.pattern !== problem.pattern);
  const rest = pool.filter((p) => p.pattern !== problem.pattern && p.difficulty !== problem.difficulty);
  const ordered = [...samePattern, ...sameDifficulty, ...rest].slice(0, 3);
  return ordered.map((p) => ({
    title: p.title,
    reason:
      p.pattern === problem.pattern
        ? `Reinforces the ${problem.pattern} pattern.`
        : `Broadens ${p.difficulty} range with the ${p.pattern} pattern.`,
  }));
}

/* --------------------------- memory writeback -------------------------- */

export type SaveFn = (input: SaveMemoryInput) => Promise<SaveMemoryResult>;

const DATE_ONLY = (iso: string): string => iso.slice(0, 10);

/**
 * Write the scorecard's durable takeaways back into long-term memory via the
 * existing upsert service (§2.3): a pattern-confidence skill, the root-cause
 * mistake, and the actionable learning. Returns the visible memoryWrites list;
 * the memory.saved events fire as a side effect (desired — drives the moment).
 */
export async function writeScorecardMemories(
  sc: InterviewScorecard,
  problem: BankProblem,
  save: SaveFn,
): Promise<InterviewScorecard["memoryWrites"]> {
  const date = DATE_ONLY(sc.createdAt);
  const writes: InterviewScorecard["memoryWrites"] = [];

  const skillTags = ["interview", "pattern", problem.pattern];
  if (sc.patternConfidence <= 2) skillTags.push("weakness");
  else if (sc.patternConfidence >= 4) skillTags.push("strength");

  const jobs: SaveMemoryInput[] = [
    {
      type: "skill",
      title: `Pattern: ${problem.pattern}`,
      body: `Confidence ${sc.patternConfidence}/5 on the ${problem.pattern} pattern after ${problem.title} (score ${sc.score}/10, ${sc.testsPassed}/${sc.testsTotal} tests, ${sc.hintsUsed} hints, ${date}).`,
      source: "interview",
      tags: skillTags,
      confidence: sc.patternConfidence / 5,
    },
  ];
  if (sc.biggestMistake.trim()) {
    jobs.push({
      type: "mistake",
      title: sc.biggestMistake.trim().slice(0, 60),
      body: `${sc.biggestMistake.trim()} (from ${problem.title}, ${date}).`,
      source: "interview",
      tags: ["interview", problem.pattern],
      confidence: 0.7,
    });
  }
  if (sc.biggestTakeaway.trim()) {
    jobs.push({
      type: "learning",
      title: sc.biggestTakeaway.trim().slice(0, 60),
      body: `${sc.biggestTakeaway.trim()} (from ${problem.title}, ${date}).`,
      source: "interview",
      tags: ["interview", problem.pattern],
      confidence: 0.7,
    });
  }

  for (const job of jobs) {
    try {
      const res = await save(job);
      writes.push({
        id: res.record.id,
        type: res.record.type,
        title: res.record.title,
        action: res.action,
      });
    } catch {
      /* a failed writeback must not sink the scorecard */
    }
  }
  return writes;
}
