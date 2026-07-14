import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHeatmap,
  computeDayStates,
  computeStreak,
  dayOrder,
  parsePlan,
  parseProgressExport,
  parseReviewBody,
  type ParsedDay,
} from "./plan.js";

/* --------------------------------- parse -------------------------------- */

const RAW = [
  {
    phase: 1,
    weeks: [
      {
        week: 1,
        days: [
          {
            day: 1,
            tasks: [
              {
                id: "phase-1-week-1-day-1-lc-1",
                title: "LeetCode 1",
                url: "https://leetcode.com/problems/two-sum/",
                type: "leetcode",
                lcDifficulty: "Easy",
              },
              { id: "phase-1-week-1-day-1-res-2", title: "Video", type: "video" },
              { id: "x", title: "Unknown kind", type: "podcast" },
            ],
          },
        ],
      },
    ],
  },
];

test("parsePlan derives stable day ids and normalizes kinds/difficulty", () => {
  const { days, tasks } = parsePlan(RAW);
  assert.equal(days.length, 1);
  assert.equal(days[0].id, "phase-1-week-1-day-1");
  assert.equal(days[0].phase, 1);
  assert.equal(days[0].week, 1);
  assert.equal(tasks.length, 3);
  const lc = tasks[0];
  assert.equal(lc.dayId, "phase-1-week-1-day-1");
  assert.equal(lc.kind, "leetcode");
  assert.equal(lc.difficulty, "Easy");
  assert.equal(tasks[2].kind, "other"); // podcast → other
});

/* ------------------------------ day states ------------------------------ */

function day(id: string, week: number, d: number): ParsedDay {
  return { id, phase: 1, week, day: d, title: id };
}

test("computeDayStates: done / current / future days stay available (no locking)", () => {
  const ordered = [
    { ...day("d1", 1, 1), taskCount: 2, doneCount: 2 }, // done
    { ...day("d2", 1, 2), taskCount: 3, doneCount: 1 }, // current (first not-done)
    { ...day("d3", 1, 3), taskCount: 2, doneCount: 0 }, // future, untouched → available
    { ...day("d4", 1, 4), taskCount: 2, doneCount: 1 }, // future, partial → available
  ];
  const { states, currentDayId } = computeDayStates(ordered);
  assert.equal(currentDayId, "d2");
  assert.equal(states.get("d1"), "done");
  assert.equal(states.get("d2"), "current");
  assert.equal(states.get("d3"), "available");
  assert.equal(states.get("d4"), "available");
});

test("computeDayStates: skipped not-done day before current is available", () => {
  const ordered = [
    { ...day("d1", 1, 1), taskCount: 2, doneCount: 0 }, // not done, but a later day is done
    { ...day("d2", 1, 2), taskCount: 2, doneCount: 2 }, // done
  ];
  const { states, currentDayId } = computeDayStates(ordered);
  assert.equal(currentDayId, "d1");
  assert.equal(states.get("d1"), "current");
  assert.equal(states.get("d2"), "done");
});

/* --------------------------- progress import ----------------------------- */

test("parseProgressExport keeps completed entries with valid dates", () => {
  const entries = parseProgressExport({
    "phase-1-week-1-day-1-lc-1": { completed: true, date: "2026-05-04" },
    "phase-1-week-1-day-1-res-0": { completed: true }, // no date
    "phase-1-week-1-day-2-lc-20": { completed: true, date: "bogus" },
  });
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], {
    taskId: "phase-1-week-1-day-1-lc-1",
    date: "2026-05-04",
  });
  assert.equal(entries[1].date, null);
  assert.equal(entries[2].date, null); // malformed date dropped, entry kept
});

test("parseProgressExport drops non-completed and malformed entries", () => {
  const entries = parseProgressExport({
    a: { completed: false, date: "2026-05-04" },
    b: "nope",
    c: null,
    d: { completed: "yes" },
  });
  assert.equal(entries.length, 0);
  assert.deepEqual(parseProgressExport(null), []);
  assert.deepEqual(parseProgressExport([1, 2]), []);
  assert.deepEqual(parseProgressExport("{}"), []);
});

test("dayOrder sorts by phase, week, day", () => {
  const a = day("a", 2, 1);
  const b = day("b", 1, 7);
  assert.ok(dayOrder(a, b) > 0);
});

/* -------------------------------- streak -------------------------------- */

test("computeStreak: consecutive run ending today", () => {
  const s = computeStreak(
    ["2026-07-03", "2026-07-04", "2026-07-05"],
    "2026-07-05",
  );
  assert.equal(s.current, 3);
  assert.equal(s.best, 3);
});

test("computeStreak: anchors on yesterday when today missing", () => {
  const s = computeStreak(["2026-07-03", "2026-07-04"], "2026-07-05");
  assert.equal(s.current, 2);
});

test("computeStreak: broken run resets current, best is max", () => {
  const s = computeStreak(
    ["2026-07-01", "2026-07-02", "2026-07-04", "2026-07-05"],
    "2026-07-05",
  );
  assert.equal(s.current, 2);
  assert.equal(s.best, 2);
});

test("computeStreak: no completion today or yesterday ⇒ current 0", () => {
  const s = computeStreak(["2026-07-01"], "2026-07-05");
  assert.equal(s.current, 0);
  assert.equal(s.best, 1);
});

/* ------------------------------- reviews -------------------------------- */

test("parseReviewBody extracts due date and numeric grade", () => {
  const a = parseReviewBody("Spaced repetition [DSA] — grade 3/5, next review 2026-07-01");
  assert.equal(a.due, "2026-07-01");
  assert.equal(a.lastGrade, 3);
  const b = parseReviewBody("Spaced repetition — grade — (new), next review 2026-06-28");
  assert.equal(b.due, "2026-06-28");
  assert.equal(b.lastGrade, null);
});

/* ------------------------------- heatmap -------------------------------- */

test("buildHeatmap yields a dense window with counts", () => {
  const cells = buildHeatmap(
    ["2026-07-05", "2026-07-05", "2026-07-04"],
    3,
    new Date("2026-07-05T12:00:00Z"),
  );
  assert.equal(cells.length, 3);
  assert.equal(cells[2].date, "2026-07-05");
  assert.equal(cells[2].count, 2);
  assert.equal(cells[1].count, 1);
  assert.equal(cells[0].count, 0);
});
