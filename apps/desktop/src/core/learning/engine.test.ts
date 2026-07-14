import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryEngine } from "../memory/engine.js";
import type { LearningTask, MissionItem, TaskKind } from "../types.js";
import { LearningEngine, type ReadDocLister } from "./engine.js";
import type {
  CompletedTaskRecord,
  DayProgressRow,
  LearningStore,
} from "./store.js";

/* ------------------------------ test doubles ---------------------------- */

interface StoreState {
  dayRows: DayProgressRow[];
  completed: CompletedTaskRecord[];
  missionDates: string[];
  missionItems: MissionItem[];
  tasks: Map<string, LearningTask>;
}

/**
 * In-memory LearningStore covering only the read surface engine.summary()
 * touches — the native sqlite binding can't load under the test runner (see
 * importer.test.ts). Faithful to the real store's return shapes.
 */
function fakeStore(state: Partial<StoreState>): LearningStore {
  const s: StoreState = {
    dayRows: [],
    completed: [],
    missionDates: [],
    missionItems: [],
    tasks: new Map(),
    ...state,
  };
  const totalTasks = s.dayRows.reduce((n, r) => n + r.taskCount, 0);
  const doneTasks = s.dayRows.reduce((n, r) => n + r.doneCount, 0);
  const fake = {
    dayProgress: () => s.dayRows,
    totals: () => ({ totalTasks, doneTasks }),
    completedTaskRecords: () => s.completed,
    missionCompletionDates: () => s.missionDates,
    missionItems: () => s.missionItems,
    getTask: (id: string) => s.tasks.get(id),
  };
  return fake as unknown as LearningStore;
}

const noMemory = {} as unknown as MemoryEngine;

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/* --------------------------- summary v2 contract ------------------------- */

test("summary v2 exposes derived level/streak/xp/quests without a doc lister", () => {
  const today = "2026-07-15";
  const store = fakeStore({
    dayRows: [
      day("phase-1-week-1-day-1", 1, 1, 1, 2, 2),
      day("phase-1-week-1-day-2", 1, 1, 2, 2, 1), // partial → not a perfect day
    ],
    completed: [
      { kind: "leetcode", difficulty: "Medium", completedAt: `${today}T12:00:00.000Z` },
      { kind: "article", completedAt: `${addDays(today, -1)}T12:00:00.000Z` },
      { kind: "review", completedAt: `${today}T09:00:00.000Z` },
    ],
    missionDates: [addDays(today, -1), today],
    missionItems: [
      mission("q1", "Solve Two Sum", "leetcode", "t-lc", true),
      mission("q2", "Weakness drill", "drill", undefined, false),
    ],
    tasks: new Map([
      ["t-lc", task("t-lc", "leetcode", "Hard")],
    ]),
  });
  const engine = new LearningEngine(store, noMemory);
  const sum = engine.summary(today);

  // task XP: 150 (LC med) + 75 (article) + 75 (review) = 300; +50 perfect day (day-1).
  assert.equal(sum.xp, 350);
  assert.equal(sum.level, 3); // 150→L2, +150→L3 (reach L3 at 300), +50 into L3
  assert.equal(sum.imported, true);
  assert.equal(sum.doneDays, 1);
  // streak: two consecutive days ending today.
  assert.deepEqual(sum.streak, { current: 2, best: 2 });
  // todayXp: LC medium 150 + review 75 completed today.
  assert.equal(sum.todayXp, 225);
  assert.equal(sum.weeklyXp.length, 8);
  assert.equal(sum.weeklyXp[7], 300); // all three completions inside this week
  // quests mirror mission items with XP rewards.
  assert.equal(sum.quests.length, 2);
  assert.deepEqual(sum.quests[0], {
    id: "q1",
    label: "Solve Two Sum",
    kind: "leetcode",
    done: true,
    xp: 300, // task-backed Hard LC
  });
  assert.equal(sum.quests[1].xp, 50); // drill
  // level fields are internally consistent.
  assert.ok(sum.xpIntoLevel >= 0 && sum.xpToNext > 0);
});

test("summary v2 awards doc-read XP through the injected lister", () => {
  const today = "2026-07-15";
  const store = fakeStore({ dayRows: [], completed: [] });
  const readDocs: ReadDocLister = () => [
    { tags: ["3mc", "study-guide", "part:1"], readAt: `${today}T08:00:00.000Z` },
    { tags: ["3mc", "quick-review", "week:2"], readAt: `${today}T08:30:00.000Z` },
    { tags: ["some-other-doc"], readAt: `${today}T09:00:00.000Z` }, // no XP
    { tags: ["3mc", "study-guide"], readAt: null }, // unread → ignored
  ];
  const engine = new LearningEngine(store, noMemory, readDocs);
  const sum = engine.summary(today);
  assert.equal(sum.xp, 115); // 75 + 40
  assert.equal(sum.todayXp, 115);
});

/* --------------------- whole-plan acceptance (level band) ---------------- */

interface FixtureTask {
  kind: TaskKind;
  difficulty?: "Easy" | "Medium" | "Hard";
}

/** A believable daily rhythm for the 3-month plan (21 weeks × 7 days). */
function dayTemplate(dayOfWeek: number, phase: number): FixtureTask[] {
  switch (dayOfWeek) {
    case 1:
      return [
        { kind: "leetcode", difficulty: phase === 1 ? "Easy" : "Medium" },
        { kind: "article" },
      ];
    case 2:
      return [{ kind: "leetcode", difficulty: "Easy" }, { kind: "video" }];
    case 3:
      return [{ kind: "leetcode", difficulty: "Easy" }];
    case 4:
      return [{ kind: "article" }, { kind: "hands-on" }];
    case 5:
      return [{ kind: "leetcode", difficulty: phase === 3 ? "Hard" : "Medium" }];
    case 6:
      return [{ kind: "review" }];
    default:
      return [{ kind: "leetcode", difficulty: "Easy" }];
  }
}

/**
 * Build a fully-completed 147-day / 21-week / 3-phase plan (each week 7 days,
 * phases of 7 weeks). Every task done on its own consecutive calendar day so
 * the streak runs the full 147 days (all milestones unlocked).
 */
function buildCompletedPlan(today: string) {
  const dayRows: DayProgressRow[] = [];
  const completed: CompletedTaskRecord[] = [];
  const missionDates: string[] = [];
  const totalDays = 147;
  let idx = 0;
  for (let week = 1; week <= 21; week += 1) {
    const phase = Math.ceil(week / 7);
    for (let dow = 1; dow <= 7; dow += 1) {
      const date = addDays(today, -(totalDays - 1 - idx));
      const tasks = dayTemplate(dow, phase);
      dayRows.push({
        id: `phase-${phase}-week-${week}-day-${dow}`,
        phase,
        week,
        day: dow,
        title: `Day ${idx + 1}`,
        focus: null,
        taskCount: tasks.length,
        doneCount: tasks.length, // fully done
        hasNotes: 0,
      });
      for (const t of tasks) {
        completed.push({ ...t, completedAt: `${date}T12:00:00.000Z` });
      }
      missionDates.push(date);
      idx += 1;
    }
  }
  return { dayRows, completed, missionDates };
}

test("acceptance: completing the whole imported plan lands at level ~45–55", () => {
  const today = "2026-07-15";
  const { dayRows, completed, missionDates } = buildCompletedPlan(today);
  const store = fakeStore({ dayRows, completed, missionDates });
  const engine = new LearningEngine(store, noMemory);
  const sum = engine.summary(today);

  // Streak spans the full plan; every day/week complete.
  assert.equal(sum.streak.current, 147);
  assert.equal(sum.streak.best, 147);
  assert.equal(sum.doneDays, 147);

  // Landing level must sit inside the design band. Fixture math pins it at 51.
  assert.ok(
    sum.level >= 45 && sum.level <= 55,
    `expected level 45–55, got ${sum.level} (xp ${sum.xp})`,
  );
  assert.equal(sum.level, 51);
});

/* -------------------------------- helpers -------------------------------- */

function day(
  id: string,
  phase: number,
  week: number,
  d: number,
  taskCount: number,
  doneCount: number,
): DayProgressRow {
  return {
    id,
    phase,
    week,
    day: d,
    title: id,
    focus: null,
    taskCount,
    doneCount,
    hasNotes: 0,
  };
}

function task(
  id: string,
  kind: TaskKind,
  difficulty?: "Easy" | "Medium" | "Hard",
): LearningTask {
  return {
    id,
    dayId: "d",
    kind,
    title: id,
    done: true,
    xpWorth: 0,
    ...(difficulty ? { difficulty } : {}),
  };
}

function mission(
  id: string,
  label: string,
  kind: TaskKind | "drill",
  taskId: string | undefined,
  done: boolean,
): MissionItem {
  return { id, label, kind, reason: "test", done, ...(taskId ? { taskId } : {}) };
}
