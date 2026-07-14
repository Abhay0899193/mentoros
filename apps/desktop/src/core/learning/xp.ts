import type { TaskKind } from "../types.js";

/**
 * XP / level math for the learning module. Everything here is a PURE function:
 * XP is always *derived* from stored facts (task completion, doc read markers,
 * mission/streak dates) and never persisted. Unit-tested in xp.test.ts.
 *
 * Design notes:
 *  - Task XP is weighted by kind and (for LeetCode) difficulty so a Hard problem
 *    is worth meaningfully more than a reading.
 *  - Doc reads award XP by KB tag (the learning module never imports the KB — the
 *    server injects a lister; see engine.ts / importer's injected-dependency
 *    pattern).
 *  - Bonuses are milestone rewards derived from completion history.
 *  - The level curve is a per-level cost (costToNext) accumulated by levelForXp.
 */

/* -------------------------------- task XP -------------------------------- */

const LEETCODE_XP: Record<"Easy" | "Medium" | "Hard", number> = {
  Easy: 50,
  Medium: 150,
  Hard: 300,
};
/** Unlabelled LeetCode (no difficulty on the row). */
export const LEETCODE_UNLABELLED_XP = 50;
export const REVIEW_XP = 75;
export const READING_XP = 75; // reading / video / docs / book / course / article
export const PROJECT_XP = 100; // hands-on / project work
export const DEFAULT_TASK_XP = 50; // anything else
/** A weakness drill in the daily mission (no backing task). */
export const DRILL_XP = 50;

/** XP earned by completing one learning task. */
export function xpForTask(task: {
  kind: TaskKind;
  difficulty?: "Easy" | "Medium" | "Hard";
}): number {
  if (task.kind === "leetcode") {
    return task.difficulty
      ? LEETCODE_XP[task.difficulty]
      : LEETCODE_UNLABELLED_XP;
  }
  switch (task.kind) {
    case "review":
      return REVIEW_XP;
    case "video":
    case "article":
    case "docs":
    case "book":
    case "course":
      return READING_XP;
    case "hands-on":
      return PROJECT_XP;
    default:
      return DEFAULT_TASK_XP;
  }
}

/* ------------------------------ doc-read XP ------------------------------ */

export const STUDY_GUIDE_READ_XP = 75;
export const QUICK_REVIEW_READ_XP = 40;

/**
 * XP for having read a KB doc, keyed off the source's tags:
 *  - a study-guide part → 75
 *  - a quick-review sheet → 40
 *  - anything else → 0 (non-3mc docs don't feed the learning curve).
 * study-guide wins if a doc somehow carries both tags.
 */
export function xpForDocRead(tags: string[]): number {
  if (tags.includes("study-guide")) return STUDY_GUIDE_READ_XP;
  if (tags.includes("quick-review")) return QUICK_REVIEW_READ_XP;
  return 0;
}

/* -------------------------------- bonuses -------------------------------- */

export const PERFECT_DAY_XP = 50;
export const WEEK_COMPLETE_XP = 250;

/** Streak-length milestones (one-time each, cumulative once the best run crosses). */
export const STREAK_MILESTONES: ReadonlyArray<{ days: number; xp: number }> = [
  { days: 7, xp: 100 },
  { days: 14, xp: 200 },
  { days: 30, xp: 500 },
];

/** +50 per fully-completed plan day. */
export function perfectDayBonus(perfectDays: number): number {
  return Math.max(0, perfectDays) * PERFECT_DAY_XP;
}

/** +250 per fully-completed plan week. */
export function weekCompleteBonus(completeWeeks: number): number {
  return Math.max(0, completeWeeks) * WEEK_COMPLETE_XP;
}

/** Cumulative milestone XP the user has unlocked for their best-ever streak. */
export function streakMilestoneBonus(bestStreak: number): number {
  return STREAK_MILESTONES.reduce(
    (sum, m) => sum + (bestStreak >= m.days ? m.xp : 0),
    0,
  );
}

/* ------------------------------ level curve ----------------------------- */

export const LEVEL_CAP = 60;

const round50 = (n: number): number => Math.round(n / 50) * 50;

/**
 * XP required to advance FROM `level` to `level + 1`.
 * round-to-nearest-50 of 0.25·level² + 10·level + 140. At/above the cap the
 * next step is unreachable (Infinity), which pins levelForXp at LEVEL_CAP.
 */
export function costToNext(level: number): number {
  if (level >= LEVEL_CAP) return Number.POSITIVE_INFINITY;
  return round50(0.25 * level * level + 10 * level + 140);
}

export interface LevelInfo {
  level: number;
  /** XP accrued inside the current level. */
  xpIntoLevel: number;
  /** XP still needed to reach the next level (0 at the cap). */
  xpToNext: number;
}

/** Resolve total XP into a level plus intra-level progress, capped at LEVEL_CAP. */
export function levelForXp(totalXp: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (level < LEVEL_CAP) {
    const cost = costToNext(level);
    if (remaining < cost) break;
    remaining -= cost;
    level += 1;
  }
  const xpToNext = level >= LEVEL_CAP ? 0 : costToNext(level);
  return { level, xpIntoLevel: remaining, xpToNext };
}

/* ------------------------- mission-item (quest) XP ---------------------- */

/**
 * XP reward attached to a daily-mission item ("quest"). Task-backed items use
 * their task's XP; a due review is worth REVIEW_XP, a weakness drill DRILL_XP,
 * and anything else falls back to its kind's task value.
 */
export function xpForMissionItem(
  item: { kind: TaskKind | "drill"; taskId?: string },
  task?: { kind: TaskKind; difficulty?: "Easy" | "Medium" | "Hard" },
): number {
  if (item.taskId && task) return xpForTask(task);
  if (item.kind === "drill") return DRILL_XP;
  if (item.kind === "review") return REVIEW_XP;
  return xpForTask({ kind: item.kind });
}

/* ------------------------------ XP by date ------------------------------ */

/** An XP-earning activity anchored to a calendar day (YYYY-MM-DD). */
export interface XpEvent {
  date: string;
  xp: number;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Total XP earned on `today` (calendar day, timezone-naive on the date prefix). */
export function xpOnDay(events: XpEvent[], today: string): number {
  const key = dayKey(today);
  return events.reduce((sum, e) => (dayKey(e.date) === key ? sum + e.xp : sum), 0);
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = dayKey(iso).split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * XP totals for the trailing `weeks` 7-day buckets ending on `today`.
 * Returned oldest-first; the last element is the current (in-progress) week.
 */
export function weeklyXpBuckets(
  events: XpEvent[],
  weeks: number,
  today: string,
): number[] {
  const buckets = new Array<number>(weeks).fill(0);
  const end = dayKey(today);
  // Bucket i covers [start_i, start_i + 6]; bucket weeks-1 ends on `today`.
  const starts: string[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    starts.push(addDays(end, -(i * 7 + 6)));
  }
  for (const e of events) {
    const k = dayKey(e.date);
    if (k > end) continue;
    for (let i = weeks - 1; i >= 0; i -= 1) {
      if (k >= starts[i]) {
        buckets[i] += e.xp;
        break;
      }
    }
  }
  return buckets;
}
