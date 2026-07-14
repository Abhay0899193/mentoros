import { randomUUID } from "node:crypto";
import type {
  HeatCell,
  LearningDay,
  LearningSummary,
  LearningTask,
  LearningWeek,
  MissionItem,
  ProgressImportResult,
  Quest,
  ReviewItem,
  TodayMission,
} from "../types.js";
import type { MemoryEngine } from "../memory/engine.js";
import {
  buildHeatmap,
  computeDayStates,
  computeStreak,
  parseProgressExport,
  parseReviewBody,
  reviewTitle,
  todayIso,
} from "./plan.js";
import {
  levelForXp,
  perfectDayBonus,
  streakMilestoneBonus,
  weekCompleteBonus,
  weeklyXpBuckets,
  xpForDocRead,
  xpForMissionItem,
  xpForTask,
  xpOnDay,
  type XpEvent,
} from "./xp.js";
import type { DayProgressRow, LearningStore } from "./store.js";

/**
 * Lists KB sources the user has marked read, with their tags + read timestamp.
 * Injected by the server (wired to the KB engine) so the learning module never
 * imports the KB — mirrors the importer's injected `listDocSources` pattern.
 */
export type ReadDocLister = () => { tags: string[]; readAt: string | null }[];

/** Trailing weeks shown in the weeklyXp sparkline. */
const WEEKLY_XP_WEEKS = 8;

/**
 * Learning engine — daily-loop brains. Combines the plan store with the memory
 * engine (reviews come from spaced-repetition memory records; the weakness drill
 * comes from the derived mistake profile) to assemble a right-sized 4–5 item
 * mission per day (§ daily loop). Framework-agnostic; no Electron.
 */
export class LearningEngine {
  private readDocs: ReadDocLister | null = null;

  constructor(
    private readonly store: LearningStore,
    private readonly memory: MemoryEngine,
    readDocs?: ReadDocLister,
  ) {
    this.readDocs = readDocs ?? null;
  }

  /**
   * Inject the read-doc lister after construction (the server builds the KB
   * engine after the learning system). Mirrors setPersonaLookup/setFaceLookup.
   */
  setReadDocLister(lister: ReadDocLister): void {
    this.readDocs = lister;
  }

  /* ------------------------------ summary -------------------------------- */

  summary(today: string = todayIso()): LearningSummary {
    const rows = this.store.dayProgress();
    const { states, currentDayId } = computeDayStates(rows);
    const doneDays = rows.filter((r) => states.get(r.id) === "done").length;
    const { totalTasks, doneTasks } = this.store.totals();

    // Task XP + per-task XP events (for today/weekly charts).
    const completed = this.store.completedTaskRecords();
    let taskXp = 0;
    const events: XpEvent[] = [];
    const completionDays = new Set<string>();
    for (const t of completed) {
      const xp = xpForTask(t);
      taskXp += xp;
      if (t.completedAt) {
        events.push({ date: t.completedAt, xp });
        completionDays.add(t.completedAt.slice(0, 10));
      }
    }

    // Doc-read XP (study-guide 75 / quick-review 40), via the injected lister.
    let docXp = 0;
    for (const d of this.readDocs?.() ?? []) {
      if (!d.readAt) continue;
      const xp = xpForDocRead(d.tags);
      if (xp <= 0) continue;
      docXp += xp;
      events.push({ date: d.readAt, xp });
    }

    // Bonuses: +50/perfect plan day, +250/complete plan week, streak milestones.
    const completeWeeks = countCompleteWeeks(rows);
    for (const date of this.store.missionCompletionDates()) {
      completionDays.add(date.slice(0, 10));
    }
    const streak = computeStreak([...completionDays], today);
    const bonusXp =
      perfectDayBonus(doneDays) +
      weekCompleteBonus(completeWeeks) +
      streakMilestoneBonus(streak.best);

    const xp = taskXp + docXp + bonusXp;
    const { level, xpIntoLevel, xpToNext } = levelForXp(xp);

    return {
      imported: rows.length > 0,
      totalDays: rows.length,
      doneDays,
      totalTasks,
      doneTasks,
      currentDayId,
      xp,
      level,
      xpIntoLevel,
      xpToNext,
      streak,
      todayXp: xpOnDay(events, today),
      weeklyXp: weeklyXpBuckets(events, WEEKLY_XP_WEEKS, today),
      quests: this.quests(today),
    };
  }

  /** Today's mission items surfaced as quests with XP rewards attached. */
  private quests(today: string): Quest[] {
    return this.store.missionItems(today).map((item) => {
      const task = item.taskId ? this.store.getTask(item.taskId) : undefined;
      return {
        id: item.id,
        label: item.label,
        kind: item.kind,
        done: item.done,
        xp: xpForMissionItem(item, task),
      };
    });
  }

  weeks(): LearningWeek[] {
    const rows = this.store.dayProgress();
    const { states } = computeDayStates(rows);
    const docsByWeek = new Map<number, { sourceId: string; title: string }[]>();
    for (const d of this.store.weekDocs()) {
      if (!docsByWeek.has(d.week)) docsByWeek.set(d.week, []);
      docsByWeek.get(d.week)!.push({ sourceId: d.sourceId, title: d.title });
    }
    const byWeek = new Map<string, LearningWeek>();
    for (const r of rows) {
      const key = `${r.phase}-${r.week}`;
      let wk = byWeek.get(key);
      if (!wk) {
        wk = { phase: r.phase, week: r.week, days: [] };
        if (r.focus) wk.focus = r.focus;
        const docs = docsByWeek.get(r.week);
        if (docs) wk.docs = docs;
        byWeek.set(key, wk);
      }
      const day: LearningDay = {
        id: r.id,
        phase: r.phase,
        week: r.week,
        day: r.day,
        title: r.title,
        state: states.get(r.id) ?? "available",
        taskCount: r.taskCount,
        doneCount: r.doneCount,
        hasNotes: r.hasNotes === 1,
      };
      wk.days.push(day);
    }
    return [...byWeek.values()].sort(
      (a, b) => a.phase - b.phase || a.week - b.week,
    );
  }

  dayTasks(dayId: string): LearningTask[] {
    return this.store.tasksForDay(dayId);
  }

  dayNotes(dayId: string): string | null {
    return this.store.dayNotes(dayId);
  }

  /**
   * Apply a pasted study-ui `study-progress` export. Only ever flips tasks TO
   * done — tasks already done here keep their completion date, and nothing is
   * un-done. Original export dates are preserved (noon UTC) so the heatmap and
   * streak reflect when the work actually happened.
   */
  importProgress(root: unknown): ProgressImportResult {
    const entries = parseProgressExport(root);
    let applied = 0;
    let alreadyDone = 0;
    let unknown = 0;
    for (const e of entries) {
      const task = this.store.getTask(e.taskId);
      if (!task) {
        unknown += 1;
        continue;
      }
      if (task.done) {
        alreadyDone += 1;
        continue;
      }
      const completedAt = e.date
        ? `${e.date}T12:00:00.000Z`
        : new Date().toISOString();
      this.store.setTaskDone(e.taskId, true, completedAt);
      applied += 1;
    }
    return {
      found: entries.length,
      applied,
      alreadyDone,
      unknown,
      summary: this.summary(),
    };
  }

  completeTask(taskId: string, done: boolean): LearningSummary | null {
    const task = this.store.getTask(taskId);
    if (!task) return null;
    this.store.setTaskDone(taskId, done, new Date().toISOString());
    return this.summary();
  }

  /* ------------------------------ reviews -------------------------------- */

  reviews(today: string = todayIso()): ReviewItem[] {
    const records = this.memory
      .listMemories({ limit: 1000 })
      .filter((r) => r.tags.includes("review-queue"));
    const out: ReviewItem[] = [];
    for (const r of records) {
      const { due, lastGrade } = parseReviewBody(r.body);
      if (!due || due > today) continue;
      out.push({
        memoryId: r.id,
        title: reviewTitle(r.title),
        due,
        lastGrade,
      });
    }
    return out.sort((a, b) => a.due.localeCompare(b.due));
  }

  /* ------------------------------ heatmap -------------------------------- */

  heatmap(days: number): HeatCell[] {
    return buildHeatmap(this.store.heatDates(), days);
  }

  /* ------------------------------ mission -------------------------------- */

  todayMission(today: string = todayIso()): TodayMission {
    if (!this.store.hasMission(today)) {
      const items = this.buildMission(today);
      if (items.length > 0) this.store.insertMissionItems(today, items);
    } else {
      this.topUpMission(today);
    }
    return this.readMission(today);
  }

  /**
   * A mission persisted before the plan was imported has no task-backed items.
   * When the plan appears mid-day, top the mission up with plan tasks (existing
   * items and their done flags untouched) instead of stranding the user until
   * tomorrow.
   */
  private topUpMission(today: string): void {
    const existing = this.store.missionItems(today);
    if (existing.some((i) => i.taskId)) return;
    const planItems = this.buildMission(today).filter((i) => i.taskId);
    if (planItems.length > 0) this.store.insertMissionItems(today, planItems);
  }

  completeMissionItem(
    itemId: string,
    done: boolean,
    today: string = todayIso(),
  ): TodayMission | null {
    const item = this.store.getMissionItem(itemId);
    if (!item) return null;
    this.store.setMissionItemDone(itemId, done);
    if (item.taskId && this.store.getTask(item.taskId)) {
      this.store.setTaskDone(item.taskId, done, new Date().toISOString());
    }
    return this.readMission(item.date ?? today);
  }

  private readMission(date: string): TodayMission {
    const items = this.store.missionItems(date);
    const streak = computeStreak(this.store.missionCompletionDates(), date);
    return { date, items, streak };
  }

  /**
   * Assemble the day's 4–5 items: 2–3 tasks from the current learning day
   * (prefer 1 leetcode + 1 non-leetcode), 1 due review, 1 weakness drill.
   */
  private buildMission(today: string): MissionItem[] {
    const rows = this.store.dayProgress();
    const { currentDayId } = computeDayStates(rows);
    const items: MissionItem[] = [];

    if (currentDayId) {
      const currentRow = rows.find((r) => r.id === currentDayId);
      const pending = this.store
        .tasksForDay(currentDayId)
        .filter((t) => !t.done);
      const chosen = pickTasks(pending);
      for (const t of chosen) {
        const item: MissionItem = {
          id: randomUUID(),
          label: t.title,
          kind: t.kind,
          reason: planReason(currentRow),
          taskId: t.id,
          done: false,
        };
        if (t.url) item.url = t.url;
        items.push(item);
      }
    }

    // 1 due review.
    const due = this.reviews(today);
    if (due.length > 0) {
      items.push({
        id: randomUUID(),
        label: `Review: ${due[0].title}`,
        kind: "review",
        reason: "Spaced repetition — due today",
        done: false,
      });
    }

    // 1 weakness drill from the top profile mistake/weakness.
    const drill = this.weaknessDrill();
    if (drill) items.push(drill);

    return items;
  }

  private weaknessDrill(): MissionItem | null {
    const profile = this.memory.profile();
    const top = profile.mistakes.find((m) => m.count > 0) ?? profile.mistakes[0];
    if (top) {
      return {
        id: randomUUID(),
        label: drillLabel(top.title),
        kind: "drill",
        reason: `Weakness: ${top.title} ×${top.count}`,
        done: false,
      };
    }
    const weak = profile.weaknesses[0];
    if (weak) {
      return {
        id: randomUUID(),
        label: drillLabel(weak.title),
        kind: "drill",
        reason: `Weakness: ${weak.title}`,
        done: false,
      };
    }
    return null;
  }
}

/* ------------------------------- helpers -------------------------------- */

/** A plan week is complete when every one of its days is fully done. */
function countCompleteWeeks(rows: DayProgressRow[]): number {
  const byWeek = new Map<string, { days: number; complete: boolean }>();
  for (const r of rows) {
    const key = `${r.phase}-${r.week}`;
    const dayDone = r.taskCount > 0 && r.doneCount >= r.taskCount;
    const wk = byWeek.get(key) ?? { days: 0, complete: true };
    wk.days += 1;
    wk.complete = wk.complete && dayDone;
    byWeek.set(key, wk);
  }
  let count = 0;
  for (const wk of byWeek.values()) if (wk.days > 0 && wk.complete) count += 1;
  return count;
}

/** Prefer 1 leetcode + 1 non-leetcode, then top up to 3 by plan order. */
function pickTasks(pending: LearningTask[]): LearningTask[] {
  const chosen: LearningTask[] = [];
  const lc = pending.find((t) => t.kind === "leetcode");
  const other = pending.find((t) => t.kind !== "leetcode");
  if (lc) chosen.push(lc);
  if (other && other.id !== lc?.id) chosen.push(other);
  for (const t of pending) {
    if (chosen.length >= 3) break;
    if (!chosen.some((c) => c.id === t.id)) chosen.push(t);
  }
  return chosen.slice(0, 3);
}

function planReason(row: DayProgressRow | undefined): string {
  if (!row) return "From your plan";
  return `From your plan — Phase ${row.phase}, Week ${row.week}`;
}

function drillLabel(weakness: string): string {
  const w = weakness.toLowerCase();
  if (w.includes("complexity")) {
    return "Drill: re-derive time/space complexity on one solved problem";
  }
  if (w.includes("edge")) {
    return "Drill: enumerate edge cases for one solved problem before coding";
  }
  if (w.includes("optim")) {
    return "Drill: find the optimal approach for one recently-solved problem";
  }
  return `Drill: revisit "${weakness}" on one solved problem`;
}
