import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePatternsLearned,
  parseProgressTracker,
  parseRecurringMistakes,
  parseReviewQueue,
  parseTables,
  stripLink,
} from "./interviewPrep.js";

test("parseTables splits header from rows and skips separators", () => {
  const md = `
| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |
`;
  const [t] = parseTables(md);
  assert.deepEqual(t.header, ["A", "B"]);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[1], ["3", "4"]);
});

test("stripLink extracts the label", () => {
  assert.equal(stripLink("[Two Sum](../x/y/)"), "Two Sum");
  assert.equal(stripLink("Plain"), "Plain");
});

test("parseRecurringMistakes: one memory per count>0 tally row, count tag + root cause", () => {
  const md = `
## 📊 Mistake Tally
| Category | Count |
|---|---|
| Off-by-one | 0 |
| Complexity miscalculation | 8 |
| Communication | 2 |

## 📝 Log

## 2026-07-02 — Called a quadratic solution "optimal"
- **Category:** Complexity miscalculation (reasoning)
- **What I did:** said optimal.
- **Root cause:** Conflated the problem's lower bound with my algorithm's cost.

## 2026-07-02 — Stated no complexity until prompted
- **Category:** Communication
- **Root cause:** Treating "the code works" as the finish line.
`;
  const out = parseRecurringMistakes(md);
  assert.equal(out.length, 2, "zero-count rows are skipped");
  const complexity = out.find((m) => m.title === "Complexity miscalculation");
  assert.ok(complexity);
  assert.equal(complexity.type, "mistake");
  assert.equal(complexity.confidence, 0.9);
  assert.ok((complexity.tags ?? []).includes("count:8"));
  assert.ok((complexity.tags ?? []).includes("import"));
  assert.match(complexity.body, /lower bound/, "body pulls the matching root cause");
});

test("parseReviewQueue: table rows → learning records", () => {
  const md = `
## ⏰ Due Today
| Next review | Problem | Type | Last grade | Mastery |
|---|---|---|---|---|
| 2026-06-28 | [Two Sum](../x/) | DSA | — (new) | 🔴 New |
| 2026-07-01 | [Number of Islands](../y/) | DSA | 3 | 🟠 Learning |

### Review log
| Date | Problem | Grade | Next | New mastery |
|---|---|---|---|---|
| 2026-06-27 | Two Sum | new | 2026-06-28 | 🔴 New |
`;
  const out = parseReviewQueue(md);
  assert.equal(out.length, 2, "only the queue table, not the review log");
  const noi = out.find((r) => r.title === "Review: Number of Islands");
  assert.ok(noi);
  assert.equal(noi.type, "learning");
  assert.ok((noi.tags ?? []).includes("review-queue"));
  assert.match(noi.body, /grade 3\/5/);
  assert.match(noi.body, /next review 2026-07-01/);
});

test("parsePatternsLearned: strengths vs weaknesses, placeholders skipped", () => {
  const md = `
## DSA Patterns
| Pattern | Playbook | Confidence | Last reinforced | Notes |
|---|---|---|---|---|
| Dijkstra | [link](../d.md) | 4 | 2026-06-29 | min-heap |
| Hashing | [link](../h.md) | 2 | 2026-06-27 | via Two Sum |
| Two pointers | _todo_ | 1 | — | |
`;
  const out = parsePatternsLearned(md);
  assert.equal(out.length, 2, "conf-1 no-notes placeholder skipped");
  const dij = out.find((s) => s.title === "Dijkstra pattern");
  assert.ok(dij);
  assert.ok((dij.tags ?? []).includes("strength"), "confidence >= 4 → strength");
  assert.match(dij.body, /confidence 4\/5/);
  const hash = out.find((s) => s.title === "Hashing pattern");
  assert.ok((hash?.tags ?? []).includes("weakness"), "confidence < 4 → weakness");
});

test("parseProgressTracker: one achievement record", () => {
  const md = `
## Snapshot
- **Last updated:** 2026-07-02
- **Total problems solved:** 10 DSA + 1 System Design = 11
- **Current streak (days):** 3
- **Mock interviews done:** 0
`;
  const out = parseProgressTracker(md);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "achievement");
  assert.match(out[0].body, /11/);
  assert.match(out[0].body, /streak 3 days/);
});

test("re-parse is stable (idempotency precondition: identical inputs)", () => {
  const md = `
| Category | Count |
|---|---|
| Complexity miscalculation | 8 |
`;
  assert.deepEqual(parseRecurringMistakes(md), parseRecurringMistakes(md));
});
