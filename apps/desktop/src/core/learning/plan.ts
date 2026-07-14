import type { LearningDay, LearningTask, TaskKind } from "../types.js";

/**
 * Pure logic for the learning plan: parsing the 3-month-challenge export,
 * XP/level math, and day-state derivation. No I/O, no DB — unit-tested in
 * isolation (plan.test.ts). The importer/store/engine layer supplies data.
 */

/* ------------------------------- parsing -------------------------------- */

interface RawTask {
  id?: string;
  title?: string;
  url?: string;
  type?: string;
  lcDifficulty?: string;
  difficulty?: string;
  completed?: boolean;
}
interface RawDay {
  day?: number;
  title?: string;
  tasks?: RawTask[];
}
interface RawWeek {
  week?: number;
  phase?: number;
  days?: RawDay[];
}
interface RawPhase {
  phase?: number;
  weeks?: RawWeek[];
}

export interface ParsedDay {
  id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  /** Week-level topic from the plan's `focus` field. */
  focus?: string | null;
}
export interface ParsedTask {
  id: string;
  dayId: string;
  kind: TaskKind;
  title: string;
  url?: string;
  difficulty?: "Easy" | "Medium" | "Hard";
}
export interface ParsedPlan {
  days: ParsedDay[];
  tasks: ParsedTask[];
}

const KNOWN_KINDS = new Set<TaskKind>([
  "leetcode",
  "video",
  "article",
  "docs",
  "book",
  "hands-on",
  "course",
  "review",
  "other",
]);

function normalizeKind(type: string | undefined): TaskKind {
  const t = (type ?? "").toLowerCase().trim();
  if (KNOWN_KINDS.has(t as TaskKind)) return t as TaskKind;
  if (t === "handson" || t === "hands_on" || t === "practice") return "hands-on";
  return "other";
}

function normalizeDifficulty(
  raw: string | undefined,
): "Easy" | "Medium" | "Hard" | undefined {
  const d = (raw ?? "").toLowerCase().trim();
  if (d === "easy") return "Easy";
  if (d === "medium" || d === "med") return "Medium";
  if (d === "hard") return "Hard";
  return undefined;
}

/**
 * Parse the 3mc export (array of phases → weeks → days → tasks). Day ids are
 * derived as `phase-P-week-W-day-D` (every task id shares this prefix), giving
 * a stable pk even though the raw days carry no id of their own.
 */
export function parsePlan(root: unknown): ParsedPlan {
  const phases: RawPhase[] = Array.isArray(root) ? (root as RawPhase[]) : [];
  const days: ParsedDay[] = [];
  const tasks: ParsedTask[] = [];

  for (const ph of phases) {
    const phase = Number(ph.phase) || 0;
    for (const wk of ph.weeks ?? []) {
      const week = Number(wk.week) || 0;
      const focus = (wk as { focus?: string }).focus?.trim() || undefined;
      for (const d of wk.days ?? []) {
        const day = Number(d.day) || 0;
        const dayId = `phase-${phase}-week-${week}-day-${day}`;
        const title = d.title?.trim() || `Phase ${phase} · Week ${week} · Day ${day}`;
        const parsed: ParsedDay = { id: dayId, phase, week, day, title };
        if (focus) parsed.focus = focus;
        days.push(parsed);
        for (const t of d.tasks ?? []) {
          const id = t.id?.trim();
          if (!id) continue;
          const task: ParsedTask = {
            id,
            dayId,
            kind: normalizeKind(t.type),
            title: t.title?.trim() || id,
          };
          if (t.url) task.url = t.url;
          const diff = normalizeDifficulty(t.lcDifficulty ?? t.difficulty);
          if (diff) task.difficulty = diff;
          tasks.push(task);
        }
      }
    }
  }
  return { days, tasks };
}

/* ------------------------------ day state ------------------------------- */

/** Plan order comparator: phase, then (global) week, then day. */
export function dayOrder(a: ParsedDay, b: ParsedDay): number {
  return a.phase - b.phase || a.week - b.week || a.day - b.day;
}

export interface DayProgress {
  id: string;
  taskCount: number;
  doneCount: number;
}

/**
 * Derive per-day state from ordered days + their progress:
 *  - done: all tasks complete (taskCount > 0)
 *  - current: first not-done day in plan order
 *  - everything else: available — the whole path is browsable ahead of order
 */
export function computeDayStates(
  ordered: Array<ParsedDay & DayProgress>,
): { states: Map<string, LearningDay["state"]>; currentDayId: string | null } {
  const isDone = (d: DayProgress) => d.taskCount > 0 && d.doneCount >= d.taskCount;
  const currentDayId = ordered.find((d) => !isDone(d))?.id ?? null;

  const states = new Map<string, LearningDay["state"]>();
  for (const d of ordered) {
    if (isDone(d)) states.set(d.id, "done");
    else states.set(d.id, d.id === currentDayId ? "current" : "available");
  }
  return { states, currentDayId };
}

/* ------------------------------ heatmap --------------------------------- */

/** Build a dense day-by-day heatmap for the trailing `days` window (UTC dates). */
export function buildHeatmap(
  completionDates: string[],
  days: number,
  today: Date = new Date(),
): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const raw of completionDates) {
    const date = raw.slice(0, 10);
    if (date) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const out: { date: string; count: number }[] = [];
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/* -------------------------------- streak -------------------------------- */

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * Streak over the set of dates that had ≥1 completed mission item.
 *  - current: run of consecutive days ending today (or yesterday, if today has
 *    no completion yet — the day isn't "broken" until it ends).
 *  - best: longest consecutive run anywhere in history.
 */
export function computeStreak(
  dates: string[],
  today: string,
): { current: number; best: number } {
  const set = new Set(dates);

  // best
  const sorted = [...set].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev !== null && addDays(prev, 1) === d) run += 1;
    else run = 1;
    if (run > best) best = run;
    prev = d;
  }

  // current: anchor at today if present, else yesterday.
  let anchor: string | null = null;
  if (set.has(today)) anchor = today;
  else if (set.has(addDays(today, -1))) anchor = addDays(today, -1);
  let current = 0;
  let cursor = anchor;
  while (cursor && set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, best };
}

/* ----------------------- progress import (3mc UI) ----------------------- */

export interface ProgressEntry {
  taskId: string;
  /** YYYY-MM-DD completion date from the export, when present. */
  date: string | null;
}

/**
 * Parse the study-ui `study-progress` localStorage payload:
 * `Record<taskId, { completed: boolean; date?: "YYYY-MM-DD" }>`.
 * Task ids follow the same `phase-P-week-W-day-D-…` scheme our importer uses,
 * so entries map 1:1 onto learning_tasks. Only completed entries survive;
 * malformed values are dropped, never thrown.
 */
export function parseProgressExport(root: unknown): ProgressEntry[] {
  if (typeof root !== "object" || root === null || Array.isArray(root)) return [];
  const out: ProgressEntry[] = [];
  for (const [taskId, raw] of Object.entries(root as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as { completed?: unknown; date?: unknown };
    if (entry.completed !== true) continue;
    const date =
      typeof entry.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
        ? entry.date
        : null;
    out.push({ taskId, date });
  }
  return out;
}

/* --------------------------- review parsing ----------------------------- */

/** Parse "next review YYYY-MM-DD" and "grade G/5" out of a review-queue body. */
export function parseReviewBody(body: string): {
  due: string | null;
  lastGrade: number | null;
} {
  const dueMatch = body.match(/next review\s+(\d{4}-\d{2}-\d{2})/i);
  const gradeMatch = body.match(/grade\s+(\d)\/5/i);
  return {
    due: dueMatch ? dueMatch[1] : null,
    lastGrade: gradeMatch ? Number.parseInt(gradeMatch[1], 10) : null,
  };
}

/** Strip a "Review: " prefix for display titles. */
export function reviewTitle(title: string): string {
  return title.replace(/^review:\s*/i, "").trim() || title;
}

export type { LearningTask };
