import type {
  DraftValidation,
  EvalResult,
  ImportedTestDraft,
  InterviewLanguage,
  InterviewProblemDraft,
} from "../types.js";
import type { BankProblem, HiddenTest, Normalize } from "./problems.js";
import { PROBLEMS } from "./problems.js";
import type { ScorecardOnce } from "./scorecard.js";
import type { RunTestsOpts } from "./runner.js";
import type { IImportStore } from "./importStore.js";

/**
 * Interview problem importer (§4.5): paste an LC-style statement, have the local
 * model draft a full bank problem (own-words prompt, dual-language starters, a
 * graduated hint ladder, hidden tests, and a reference solution), then VALIDATE
 * by executing that reference solution against the drafted tests in the same
 * out-of-process runner the candidate faces. Only a draft whose reference passes
 * every test is savable. `referenceSolution` is validation-only — it is stripped
 * before the problem is persisted and never reaches a candidate session.
 */

/** Runner surface reused from the eval sandbox (python execution of the reference). */
export type DraftRunFn = (opts: RunTestsOpts) => Promise<Omit<EvalResult, "attemptId">>;

/** Thrown when the model returns output we cannot turn into a draft (→ HTTP 502). */
export class DraftGenerationError extends Error {
  constructor(message = "model returned an unusable draft — try again") {
    super(message);
    this.name = "DraftGenerationError";
  }
}

/** Thrown by saveDraft when server-side re-validation fails (→ HTTP 422). */
export class DraftInvalidError extends Error {
  constructor(readonly validation: DraftValidation) {
    super("draft failed validation");
    this.name = "DraftInvalidError";
  }
}

/** The pattern slugs the static bank uses — the model must pick from this set. */
export const BANK_PATTERNS: readonly string[] = [
  ...new Set(PROBLEMS.map((p) => p.pattern)),
].sort();

/* ----------------------------- draft generation ----------------------------- */

function systemPrompt(): string {
  return [
    "You convert a pasted coding-interview problem statement into a single strict JSON object describing a complete practice problem. Output JSON ONLY — no prose, no markdown fences.",
    "",
    "The JSON MUST have exactly this shape:",
    "{",
    '  "title": string,                       // concise problem title',
    '  "lcNumber": number (optional),         // LeetCode number if clearly identifiable, else omit',
    '  "difficulty": "easy" | "medium" | "hard",',
    `  "pattern": one of ${BANK_PATTERNS.map((p) => JSON.stringify(p)).join(", ")},`,
    '  "tags": string[],                      // 2-4 short topical tags',
    '  "functionName": string,                // the function the candidate implements (valid identifier, camelCase)',
    '  "promptMd": string,                    // YOUR OWN WORDS. Markdown with a "**Constraints**" bullet section and an "**Examples**" fenced block, matching a clean textbook style. Never copy the source verbatim.',
    '  "starterCode": { "python": string, "javascript": string },  // both define/declare functionName with a docstring or comment; empty body',
    '  "hints": [string, string, string],     // EXACTLY 3 graduated hints: [1] recognition signal, [2] approach shape, [3] key insight. NEVER full code or a line-by-line solution.',
    '  "tests": [ { "name": string, "args": any[], "expected": any, "normalize": "sortInner" | "sortOuter" | null } ],  // 6-12 tests: cover the examples plus edges (empty/size-1/duplicates/negatives/large). args and expected MUST be plain JSON. Use normalize ONLY when the answer is order-insensitive, else null.',
    '  "referenceSolution": string            // a CORRECT python implementation of functionName that passes every test above',
    "}",
    "",
    'Rules: functionName must be identical across starterCode.python, starterCode.javascript, and referenceSolution. args are spread as positional arguments into functionName, so every test\'s args must contain exactly one JSON value per parameter — an empty-string input is [""] never [] (an empty args array calls the function with zero arguments). Keep everything JSON-serializable. Return the JSON object and nothing else.',
  ].join("\n");
}

/**
 * Extract the first balanced JSON object from a model response (tolerating code
 * fences and surrounding prose), respecting string literals and escapes.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function asTests(v: unknown): ImportedTestDraft[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw, i) => {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const norm =
      o.normalize === "sortInner" || o.normalize === "sortOuter" ? o.normalize : null;
    return {
      name: typeof o.name === "string" && o.name.trim() ? o.name : `test ${i + 1}`,
      args: Array.isArray(o.args) ? o.args : [],
      expected: o.expected,
      normalize: norm,
    };
  });
}

/** Turn a validated JSON object into an InterviewProblemDraft (lenient coercion). */
function coerceDraft(o: Record<string, unknown>): InterviewProblemDraft {
  const hintsRaw = Array.isArray(o.hints) ? o.hints.map(asString) : [];
  const sc = (o.starterCode && typeof o.starterCode === "object"
    ? o.starterCode
    : {}) as Record<string, unknown>;
  const difficulty =
    o.difficulty === "easy" || o.difficulty === "medium" || o.difficulty === "hard"
      ? o.difficulty
      : ("medium" as const);
  const draft: InterviewProblemDraft = {
    title: asString(o.title),
    difficulty,
    pattern: asString(o.pattern),
    tags: asStringArray(o.tags),
    functionName: asString(o.functionName),
    promptMd: asString(o.promptMd),
    starterCode: { python: asString(sc.python), javascript: asString(sc.javascript) },
    hints: hintsRaw as [string, string, string],
    tests: asTests(o.tests),
    referenceSolution: asString(o.referenceSolution),
  };
  if (typeof o.lcNumber === "number" && Number.isFinite(o.lcNumber)) {
    draft.lcNumber = o.lcNumber;
  }
  if (typeof o.slug === "string" && o.slug.trim()) draft.slug = o.slug.trim();
  return draft;
}

/**
 * Local models often serialize a single empty-string input as `args: []`
 * (observed with llama3.1). When every other test establishes the function
 * takes exactly one string argument, an empty args array can only mean `""` —
 * repair it so validation doesn't fail on a TypeError the user must hand-fix.
 */
export function repairEmptyStringArgs(
  draft: InterviewProblemDraft,
): InterviewProblemDraft {
  const withArgs = draft.tests.filter((t) => t.args.length > 0);
  if (withArgs.length === 0 || withArgs.length === draft.tests.length) return draft;
  const singleStringArity = withArgs.every(
    (t) => t.args.length === 1 && typeof t.args[0] === "string",
  );
  if (!singleStringArity) return draft;
  return {
    ...draft,
    tests: draft.tests.map((t) => (t.args.length === 0 ? { ...t, args: [""] } : t)),
  };
}

/**
 * Ask the model once for a draft. Strict parse: extract the first JSON object
 * and require an object shape; anything unparseable throws {@link
 * DraftGenerationError} (no silent fallback).
 */
export async function generateDraft(
  sourceText: string,
  once: ScorecardOnce,
): Promise<InterviewProblemDraft> {
  const raw = await once({
    messages: [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: `Convert this problem statement into the JSON described above:\n\n${sourceText}`,
      },
    ],
    format: "json",
    timeoutMs: 60_000,
  });
  const jsonText = extractFirstJsonObject(raw);
  if (!jsonText) throw new DraftGenerationError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new DraftGenerationError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DraftGenerationError();
  }
  return repairEmptyStringArgs(coerceDraft(parsed as Record<string, unknown>));
}

/* ------------------------------- validation -------------------------------- */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isJsonSerializable(v: unknown): boolean {
  try {
    JSON.stringify(v);
    return true;
  } catch {
    return false;
  }
}

/** Static shape checks — everything that does not require executing code. */
export function draftShapeErrors(draft: InterviewProblemDraft): string[] {
  const errors: string[] = [];
  if (!draft.title.trim()) errors.push("title is required");
  if (!draft.promptMd.trim()) errors.push("promptMd is required");
  if (!draft.pattern.trim()) errors.push("pattern is required");
  if (
    draft.difficulty !== "easy" &&
    draft.difficulty !== "medium" &&
    draft.difficulty !== "hard"
  ) {
    errors.push("difficulty must be easy, medium, or hard");
  }

  const fn = draft.functionName;
  if (!fn.trim()) {
    errors.push("functionName is required");
  } else if (!IDENTIFIER.test(fn)) {
    errors.push("functionName is not a valid identifier");
  } else {
    const inPy = draft.starterCode.python.includes(fn);
    const inJs = draft.starterCode.javascript.includes(fn);
    if (!inPy && !inJs) errors.push("functionName is missing from both starter templates");
    if (!draft.referenceSolution.includes(fn)) {
      errors.push("functionName is missing from the reference solution");
    }
  }

  if (!draft.referenceSolution.trim()) errors.push("referenceSolution is required");

  if (draft.hints.length !== 3 || draft.hints.some((h) => !h || !h.trim())) {
    errors.push("exactly 3 non-empty hints are required");
  }

  if (draft.tests.length < 3) {
    errors.push("at least 3 tests are required");
  }
  for (const t of draft.tests) {
    if (!isJsonSerializable(t.args) || !isJsonSerializable(t.expected)) {
      errors.push(`test "${t.name}" has non-JSON-serializable args or expected`);
    }
  }
  return errors;
}

function toHiddenTests(tests: ImportedTestDraft[]): HiddenTest[] {
  return tests.map((t) => {
    const h: HiddenTest = { name: t.name, args: t.args, expected: t.expected };
    if (t.normalize) h.normalize = t.normalize as Normalize;
    return h;
  });
}

/**
 * Full validation: shape errors + execution of `referenceSolution` (python)
 * against every drafted test in the shared runner. Comparison semantics
 * (incl. normalize) come entirely from the runner harness — we do not fork it.
 * `ok` iff there are no shape errors AND every test passes.
 */
export async function validateDraft(
  draft: InterviewProblemDraft,
  run: DraftRunFn,
  tmpRoot: string,
): Promise<DraftValidation> {
  const errors = draftShapeErrors(draft);

  const canRun =
    draft.referenceSolution.trim().length > 0 &&
    draft.tests.length > 0 &&
    IDENTIFIER.test(draft.functionName);

  if (!canRun) {
    return { ok: false, tests: [], errors };
  }

  const result = await run({
    language: "python",
    functionName: draft.functionName,
    tests: toHiddenTests(draft.tests),
    code: draft.referenceSolution,
    tmpRoot,
  });

  let tests: DraftValidation["tests"];
  if (result.compileError) {
    tests = draft.tests.map((t) => ({
      name: t.name,
      passed: false,
      detail: `reference solution error: ${result.compileError}`,
    }));
  } else {
    const byName = new Map(result.results.map((r) => [r.name, r]));
    tests = draft.tests.map((t) => {
      const r = byName.get(t.name);
      const passed = r?.passed ?? false;
      const entry: DraftValidation["tests"][number] = { name: t.name, passed };
      if (!passed) {
        if (r?.error) entry.detail = r.error;
        else entry.detail = `expected ${JSON.stringify(t.expected)}, got ${r?.actual ?? "(no result)"}`;
      }
      return entry;
    });
  }

  const ok = errors.length === 0 && tests.length > 0 && tests.every((t) => t.passed);
  return { ok, tests, errors };
}

/* --------------------------------- saving ---------------------------------- */

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "problem";
}

/** Choose a unique `custom-<slug>` id, deduping against bank + custom store. */
function uniqueId(title: string, store: IImportStore): string {
  const base = `custom-${slugify(title)}`;
  const taken = new Set<string>([
    ...PROBLEMS.map((p) => p.id),
    ...store.list().map((p) => p.id),
  ]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Build a BankProblem from a validated draft and persist it. Requires
 * `validation.ok` — callers must re-validate server-side (never trust the
 * client). `referenceSolution` is dropped; `custom` is applied by the store on
 * read (never written into the stored JSON).
 */
export function saveDraft(
  draft: InterviewProblemDraft,
  validation: DraftValidation,
  store: IImportStore,
): BankProblem {
  if (!validation.ok) throw new DraftInvalidError(validation);

  const id = uniqueId(draft.title, store);
  const starterCode: Record<InterviewLanguage, string> = {
    python: draft.starterCode.python,
    javascript: draft.starterCode.javascript,
  };
  const problem: BankProblem = {
    id,
    title: draft.title,
    difficulty: draft.difficulty,
    pattern: draft.pattern,
    tags: [...draft.tags],
    functionName: draft.functionName,
    promptMd: draft.promptMd,
    starterCode,
    hints: [draft.hints[0], draft.hints[1], draft.hints[2]],
    tests: toHiddenTests(draft.tests),
  };
  if (draft.lcNumber !== undefined) problem.lcNumber = draft.lcNumber;
  if (draft.slug?.trim()) problem.slug = draft.slug.trim();

  store.save(problem);
  // Reflect what a consumer sees (custom flag applied on read).
  const stored = store.get(id);
  return stored ?? { ...problem, custom: true };
}
