import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { LearningTask, MissionItem, TaskKind } from "../types.js";
import type { ParsedDay, ParsedTask } from "./plan.js";

/**
 * Persistence for the learning plan + daily mission. Opens its own connection to
 * the shared MentorOS database (WAL supports concurrent readers/writers), mirror
 * of how the memory subsystem attaches — the whole user knowledge base stays in
 * one portable file (§2.5). Electron-free by construction.
 */

export interface DayRow extends ParsedDay {}

export interface DayProgressRow {
  id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  focus: string | null;
  taskCount: number;
  doneCount: number;
}

export class LearningStore {
  private readonly db: Database.Database;

  constructor(dataDir: string, db?: Database.Database) {
    if (db) {
      this.db = db;
    } else {
      mkdirSync(dataDir, { recursive: true });
      this.db = new Database(join(dataDir, "mentoros.db"));
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
    }
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learning_days (
        id TEXT PRIMARY KEY,
        phase INTEGER NOT NULL,
        week INTEGER NOT NULL,
        day INTEGER NOT NULL,
        title TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learning_tasks (
        id TEXT PRIMARY KEY,
        day_id TEXT NOT NULL REFERENCES learning_days(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        difficulty TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_learning_tasks_day ON learning_tasks(day_id);
      CREATE TABLE IF NOT EXISTS mission_items (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        reason TEXT NOT NULL,
        task_id TEXT,
        done INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_mission_items_date ON mission_items(date);
    `);
    // Additive migration: week-level topic (focus) carried on each day row.
    try {
      this.db.exec(`ALTER TABLE learning_days ADD COLUMN focus TEXT`);
    } catch {
      /* column already exists */
    }
  }

  close(): void {
    this.db.close();
  }

  /* ------------------------------- import -------------------------------- */

  /** Idempotent upsert of a day. Returns whether the row was newly created. */
  upsertDay(d: ParsedDay): "created" | "merged" {
    const existed =
      this.db.prepare(`SELECT 1 FROM learning_days WHERE id = ?`).get(d.id) !==
      undefined;
    this.db
      .prepare(
        `INSERT INTO learning_days (id, phase, week, day, title, focus)
         VALUES (@id, @phase, @week, @day, @title, @focus)
         ON CONFLICT(id) DO UPDATE SET
           phase = excluded.phase, week = excluded.week,
           day = excluded.day, title = excluded.title, focus = excluded.focus`,
      )
      .run({ focus: null, ...d });
    return existed ? "merged" : "created";
  }

  /**
   * Idempotent upsert of a task. NEVER touches done/completed_at on an existing
   * row (progress is sacred across re-imports).
   */
  upsertTask(t: ParsedTask): "created" | "merged" {
    const existed =
      this.db.prepare(`SELECT 1 FROM learning_tasks WHERE id = ?`).get(t.id) !==
      undefined;
    if (existed) {
      this.db
        .prepare(
          `UPDATE learning_tasks SET
             day_id = @dayId, kind = @kind, title = @title,
             url = @url, difficulty = @difficulty
           WHERE id = @id`,
        )
        .run({
          id: t.id,
          dayId: t.dayId,
          kind: t.kind,
          title: t.title,
          url: t.url ?? null,
          difficulty: t.difficulty ?? null,
        });
      return "merged";
    }
    this.db
      .prepare(
        `INSERT INTO learning_tasks (id, day_id, kind, title, url, difficulty, done, completed_at)
         VALUES (@id, @dayId, @kind, @title, @url, @difficulty, 0, NULL)`,
      )
      .run({
        id: t.id,
        dayId: t.dayId,
        kind: t.kind,
        title: t.title,
        url: t.url ?? null,
        difficulty: t.difficulty ?? null,
      });
    return "created";
  }

  /* ------------------------------- reads --------------------------------- */

  isImported(): boolean {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM learning_days`)
      .get() as { n: number };
    return row.n > 0;
  }

  /** Days with per-day task/done counts, in plan order. */
  dayProgress(): DayProgressRow[] {
    return this.db
      .prepare(
        `SELECT d.id, d.phase, d.week, d.day, d.title, d.focus,
                COUNT(t.id) AS taskCount,
                COALESCE(SUM(t.done), 0) AS doneCount
         FROM learning_days d
         LEFT JOIN learning_tasks t ON t.day_id = d.id
         GROUP BY d.id
         ORDER BY d.phase, d.week, d.day`,
      )
      .all() as DayProgressRow[];
  }

  tasksForDay(dayId: string): LearningTask[] {
    const rows = this.db
      .prepare(
        `SELECT id, day_id, kind, title, url, difficulty, done, completed_at
         FROM learning_tasks WHERE day_id = ? ORDER BY rowid ASC`,
      )
      .all(dayId) as TaskRow[];
    return rows.map(rowToTask);
  }

  getTask(id: string): LearningTask | undefined {
    const row = this.db
      .prepare(
        `SELECT id, day_id, kind, title, url, difficulty, done, completed_at
         FROM learning_tasks WHERE id = ?`,
      )
      .get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  setTaskDone(id: string, done: boolean, completedAt: string | null): void {
    this.db
      .prepare(`UPDATE learning_tasks SET done = ?, completed_at = ? WHERE id = ?`)
      .run(done ? 1 : 0, done ? completedAt : null, id);
  }

  /** Totals for the summary. */
  totals(): { totalTasks: number; doneTasks: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS totalTasks, COALESCE(SUM(done),0) AS doneTasks
         FROM learning_tasks`,
      )
      .get() as { totalTasks: number; doneTasks: number };
    return row;
  }

  /** All completed tasks (id, kind, difficulty) — for XP totals. */
  completedTasks(): Array<{
    kind: TaskKind;
    difficulty?: "Easy" | "Medium" | "Hard";
  }> {
    const rows = this.db
      .prepare(
        `SELECT kind, difficulty FROM learning_tasks WHERE done = 1`,
      )
      .all() as Array<{ kind: string; difficulty: string | null }>;
    return rows.map((r) => ({
      kind: r.kind as TaskKind,
      ...(r.difficulty ? { difficulty: r.difficulty as "Easy" | "Medium" | "Hard" } : {}),
    }));
  }

  /** Dates (YYYY-MM-DD) that count toward the heatmap. */
  heatDates(): string[] {
    const taskDates = (
      this.db
        .prepare(
          `SELECT completed_at FROM learning_tasks
           WHERE done = 1 AND completed_at IS NOT NULL`,
        )
        .all() as Array<{ completed_at: string }>
    ).map((r) => r.completed_at);
    // Non-task mission items (drills/reviews) count on their mission date.
    const missionDates = (
      this.db
        .prepare(
          `SELECT date FROM mission_items WHERE done = 1 AND task_id IS NULL`,
        )
        .all() as Array<{ date: string }>
    ).map((r) => r.date);
    return [...taskDates, ...missionDates];
  }

  /* ------------------------------ mission -------------------------------- */

  missionItems(date: string): MissionItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, kind, reason, task_id, done
         FROM mission_items WHERE date = ? ORDER BY rowid ASC`,
      )
      .all(date) as MissionRow[];
    return rows.map(rowToMission);
  }

  hasMission(date: string): boolean {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM mission_items WHERE date = ?`)
      .get(date) as { n: number };
    return row.n > 0;
  }

  insertMissionItems(date: string, items: MissionItem[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO mission_items (id, date, label, kind, reason, task_id, done)
       VALUES (@id, @date, @label, @kind, @reason, @task_id, @done)`,
    );
    const tx = this.db.transaction((rows: MissionItem[]) => {
      for (const it of rows) {
        stmt.run({
          id: it.id,
          date,
          label: it.label,
          kind: it.kind,
          reason: it.reason,
          task_id: it.taskId ?? null,
          done: it.done ? 1 : 0,
        });
      }
    });
    tx(items);
  }

  getMissionItem(id: string): (MissionItem & { date: string }) | undefined {
    const row = this.db
      .prepare(
        `SELECT id, date, label, kind, reason, task_id, done
         FROM mission_items WHERE id = ?`,
      )
      .get(id) as (MissionRow & { date: string }) | undefined;
    if (!row) return undefined;
    return { ...rowToMission(row), date: row.date };
  }

  setMissionItemDone(id: string, done: boolean): void {
    this.db
      .prepare(`UPDATE mission_items SET done = ? WHERE id = ?`)
      .run(done ? 1 : 0, id);
  }

  /** Distinct dates (YYYY-MM-DD) with ≥1 completed mission item — for streaks. */
  missionCompletionDates(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT date FROM mission_items WHERE done = 1 ORDER BY date ASC`,
      )
      .all() as Array<{ date: string }>;
    return rows.map((r) => r.date);
  }
}

interface TaskRow {
  id: string;
  day_id: string;
  kind: string;
  title: string;
  url: string | null;
  difficulty: string | null;
  done: number;
  completed_at: string | null;
}

function rowToTask(row: TaskRow): LearningTask {
  const task: LearningTask = {
    id: row.id,
    dayId: row.day_id,
    kind: row.kind as TaskKind,
    title: row.title,
    done: row.done === 1,
  };
  if (row.url) task.url = row.url;
  if (row.difficulty) task.difficulty = row.difficulty as "Easy" | "Medium" | "Hard";
  if (row.completed_at) task.completedAt = row.completed_at;
  return task;
}

interface MissionRow {
  id: string;
  label: string;
  kind: string;
  reason: string;
  task_id: string | null;
  done: number;
}

function rowToMission(row: MissionRow): MissionItem {
  const item: MissionItem = {
    id: row.id,
    label: row.label,
    kind: row.kind as MissionItem["kind"],
    reason: row.reason,
    done: row.done === 1,
  };
  if (row.task_id) item.taskId = row.task_id;
  return item;
}
