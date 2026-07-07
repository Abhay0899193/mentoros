import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import type { InterviewProblemDraft } from "../types.js";
import { runTests } from "./runner.js";
import { MemImportStore } from "./importStore.js";
import {
  DraftGenerationError,
  draftShapeErrors,
  extractFirstJsonObject,
  generateDraft,
  saveDraft,
  validateDraft,
} from "./importer.js";
import { InterviewEngine } from "./engine.js";
import { registerInterviewRoutes } from "./routes.js";
import type { ScorecardOnce } from "./scorecard.js";

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "iv-import-"));
}

const REFERENCE = [
  "def twoSum(nums, target):",
  "    seen = {}",
  "    for i, n in enumerate(nums):",
  "        if target - n in seen:",
  "            return [seen[target - n], i]",
  "        seen[n] = i",
  "    return []",
  "",
].join("\n");

function validDraft(overrides: Partial<InterviewProblemDraft> = {}): InterviewProblemDraft {
  return {
    title: "Two Sum",
    difficulty: "easy",
    pattern: "arrays-and-hashing",
    tags: ["array", "hash-map"],
    functionName: "twoSum",
    promptMd: "Return indices of the two numbers adding to target.\n\n**Constraints**\n- n>=2\n\n**Examples**\n```\ntwoSum([2,7],9) -> [0,1]\n```",
    starterCode: {
      python: "def twoSum(nums, target):\n    pass\n",
      javascript: "function twoSum(nums, target) {\n  // your code here\n}\n",
    },
    hints: [
      "You are looking for a complement as you scan.",
      "A hash map from value to index makes the lookup O(1).",
      "Check target - nums[i] before inserting the current number.",
    ],
    tests: [
      { name: "example 1", args: [[2, 7, 11, 15], 9], expected: [0, 1], normalize: "sortInner" },
      { name: "example 2", args: [[3, 2, 4], 6], expected: [1, 2], normalize: "sortInner" },
      { name: "duplicates", args: [[3, 3], 6], expected: [0, 1], normalize: "sortInner" },
    ],
    referenceSolution: REFERENCE,
    ...overrides,
  };
}

/* ------------------------------ shape errors ----------------------------- */

test("draftShapeErrors: flags every structural defect", () => {
  const bad = validDraft({
    title: "  ",
    functionName: "2bad",
    hints: ["only one"] as unknown as [string, string, string],
    tests: [{ name: "t", args: [1], expected: 1, normalize: null }],
    referenceSolution: "",
  });
  const errors = draftShapeErrors(bad);
  assert.ok(errors.some((e) => /title/.test(e)));
  assert.ok(errors.some((e) => /identifier/.test(e)));
  assert.ok(errors.some((e) => /3 non-empty hints/.test(e)));
  assert.ok(errors.some((e) => /at least 3 tests/.test(e)));
  assert.ok(errors.some((e) => /referenceSolution/.test(e)));
});

test("draftShapeErrors: a well-formed draft has no shape errors", () => {
  assert.deepEqual(draftShapeErrors(validDraft()), []);
});

test("draftShapeErrors: functionName absent from starters + reference", () => {
  const bad = validDraft({
    functionName: "solve",
    starterCode: { python: "def foo(): pass", javascript: "function foo(){}" },
    referenceSolution: "def foo(): return 0",
  });
  const errors = draftShapeErrors(bad);
  assert.ok(errors.some((e) => /missing from both starter/.test(e)));
  assert.ok(errors.some((e) => /missing from the reference/.test(e)));
});

/* ------------------------------- validation ------------------------------ */

test("validateDraft: correct reference passes every test → ok:true", async () => {
  const root = await tmpRoot();
  const v = await validateDraft(validDraft(), runTests, root);
  assert.equal(v.ok, true);
  assert.equal(v.errors.length, 0);
  assert.equal(v.tests.length, 3);
  assert.ok(v.tests.every((t) => t.passed));
});

test("validateDraft: a wrong expected fails that test with a detail", async () => {
  const root = await tmpRoot();
  const draft = validDraft({
    tests: [
      { name: "example 1", args: [[2, 7, 11, 15], 9], expected: [0, 1], normalize: "sortInner" },
      { name: "example 2", args: [[3, 2, 4], 6], expected: [1, 2], normalize: "sortInner" },
      { name: "wrong expected", args: [[1, 2], 3], expected: [5, 6], normalize: "sortInner" },
    ],
  });
  const v = await validateDraft(draft, runTests, root);
  assert.equal(v.ok, false);
  const failed = v.tests.find((t) => t.name === "wrong expected");
  assert.ok(failed);
  assert.equal(failed?.passed, false);
  assert.ok(failed?.detail && failed.detail.length > 0);
  assert.ok(v.tests.filter((t) => t.name !== "wrong expected").every((t) => t.passed));
});

test("validateDraft: a broken reference reports every test failed", async () => {
  const root = await tmpRoot();
  const v = await validateDraft(
    validDraft({ referenceSolution: "def twoSum(nums, target)\n    return []" }),
    runTests,
    root,
  );
  assert.equal(v.ok, false);
  assert.ok(v.tests.length === 3 && v.tests.every((t) => !t.passed));
});

/* --------------------------- save / list / get --------------------------- */

test("saveDraft: roundtrip sets custom:true and strips referenceSolution", async () => {
  const root = await tmpRoot();
  const store = new MemImportStore();
  const v = await validateDraft(validDraft(), runTests, root);
  const saved = saveDraft(validDraft(), v, store);

  assert.equal(saved.id, "custom-two-sum");
  assert.equal(saved.custom, true);
  assert.equal((saved as unknown as Record<string, unknown>).referenceSolution, undefined);

  const got = store.get("custom-two-sum");
  assert.ok(got);
  assert.equal(got?.custom, true);
  assert.equal(got?.tests.length, 3, "hidden tests persist server-side");
  assert.equal((got as unknown as Record<string, unknown>).referenceSolution, undefined);

  assert.equal(store.list().length, 1);
  assert.equal(store.delete("custom-two-sum"), true);
  assert.equal(store.delete("custom-two-sum"), false);
  assert.equal(store.get("custom-two-sum"), undefined);
});

test("saveDraft: id dedupes against bank and existing customs", async () => {
  const root = await tmpRoot();
  const store = new MemImportStore();
  const v = await validateDraft(validDraft(), runTests, root);
  const a = saveDraft(validDraft(), v, store);
  const b = saveDraft(validDraft(), v, store);
  const c = saveDraft(validDraft(), v, store);
  assert.equal(a.id, "custom-two-sum");
  assert.equal(b.id, "custom-two-sum-2");
  assert.equal(c.id, "custom-two-sum-3");
});

test("saveDraft: refuses to persist an invalid validation", () => {
  const store = new MemImportStore();
  assert.throws(
    () => saveDraft(validDraft(), { ok: false, tests: [], errors: ["nope"] }, store),
    /validation/,
  );
  assert.equal(store.list().length, 0);
});

/* ---------------------------- draft generation --------------------------- */

const onceReturning = (text: string): ScorecardOnce => async () => text;

test("generateDraft: parses a clean JSON object", async () => {
  const draft = validDraft();
  const out = await generateDraft("paste", onceReturning(JSON.stringify(draft)));
  assert.equal(out.title, "Two Sum");
  assert.equal(out.functionName, "twoSum");
  assert.equal(out.hints.length, 3);
  assert.equal(out.tests.length, 3);
});

test("generateDraft: parses JSON wrapped in a code fence and prose", async () => {
  const draft = validDraft();
  const wrapped = "Sure, here is the problem:\n```json\n" + JSON.stringify(draft) + "\n```\nDone.";
  const out = await generateDraft("paste", onceReturning(wrapped));
  assert.equal(out.functionName, "twoSum");
  assert.equal(out.pattern, "arrays-and-hashing");
});

test("generateDraft: unparseable output throws the designed error", async () => {
  await assert.rejects(
    () => generateDraft("paste", onceReturning("I'm sorry, I cannot help with that.")),
    DraftGenerationError,
  );
});

test("extractFirstJsonObject: balances braces inside strings", () => {
  const src = 'noise {"a":"has } brace","b":{"c":1}} trailing';
  assert.equal(extractFirstJsonObject(src), '{"a":"has } brace","b":{"c":1}}');
});

/* ------------------------------ route: delete ---------------------------- */

function makeRouteEngine() {
  const store = new MemImportStore();
  const engine = new InterviewEngine({
    store: {} as never,
    broadcast: (() => {}) as never,
    dataDir: join(tmpdir(), "iv-import-engine"),
    importStore: store,
    interviewer: { streamTurn: async () => {} },
    runFn: async () => ({ passed: 0, total: 0, results: [], durationMs: 0, ranAt: "now" }),
  });
  return { engine, store };
}

test("DELETE /interview/problems/:id — 403 for a built-in, 204/404 for customs", async () => {
  const { engine, store } = makeRouteEngine();
  const root = await tmpRoot();
  const v = await validateDraft(validDraft(), runTests, root);
  const saved = saveDraft(validDraft(), v, store);

  const app = Fastify();
  registerInterviewRoutes(app, { engine });
  await app.ready();

  const builtin = await app.inject({ method: "DELETE", url: "/interview/problems/two-sum" });
  assert.equal(builtin.statusCode, 403);

  const custom = await app.inject({ method: "DELETE", url: `/interview/problems/${saved.id}` });
  assert.equal(custom.statusCode, 204);

  const gone = await app.inject({ method: "DELETE", url: `/interview/problems/${saved.id}` });
  assert.equal(gone.statusCode, 404);

  await app.close();
});
