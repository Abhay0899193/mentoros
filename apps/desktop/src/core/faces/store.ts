import type Database from "better-sqlite3";
import type { CustomFacePreset, FaceJobStatus } from "../types.js";
import { FRAME_FILES } from "./paths.js";

/**
 * Persistence for custom face presets and their generation jobs. Presets are
 * only written when a job finishes (a cancelled/failed job never leaves a preset
 * row), so re-submitting the same name resumes into the same `face-<slug>` id
 * and its skip-if-exists work dir. The jobs table survives an app restart so
 * GET /faces/jobs/active can report the last job.
 *
 * Persistence is behind {@link FaceRepo} so the CRUD/state-machine logic is unit
 * testable without the native better-sqlite3 addon; production wires
 * {@link SqliteFaceRepo}.
 */

/* --------------------------------- errors --------------------------------- */

/** Attempt to mutate a built-in preset (→ HTTP 403). */
export class FaceForbiddenError extends Error {
  constructor(message = "built-in face presets cannot be deleted") {
    super(message);
    this.name = "FaceForbiddenError";
  }
}

/** Unknown custom preset id (→ HTTP 404). */
export class FaceNotFoundError extends Error {
  constructor(message = "face preset not found") {
    super(message);
    this.name = "FaceNotFoundError";
  }
}

/** A generation job is already running (→ HTTP 409). */
export class FaceBusyError extends Error {
  constructor(message = "a preset is already generating") {
    super(message);
    this.name = "FaceBusyError";
  }
}

/* ------------------------------- built-ins -------------------------------- */

/** Ids owned by the app — not deletable, never a custom `face-<slug>`. */
export const BUILTIN_FACE_IDS = new Set<string>([
  "aura",
  "nova",
  "ivy",
  "rae",
  "lena",
  "sienna",
  "kira",
]);

/* ------------------------------ persistence ------------------------------- */

export interface PresetRow {
  id: string;
  name: string;
  accent: string;
  hasFull: boolean;
  createdAt: string;
}

export type JobState = FaceJobStatus["state"];

export interface JobRow {
  id: string;
  presetId: string;
  name: string;
  state: JobState;
  step: string;
  completedFrames: number;
  totalFrames: number;
  error: string | null;
  startedAt: string;
}

export interface FaceRepo {
  listPresets(): PresetRow[];
  getPreset(id: string): PresetRow | null;
  insertPreset(row: PresetRow): void;
  deletePreset(id: string): boolean;

  insertJob(row: JobRow): void;
  updateJob(id: string, patch: Partial<Omit<JobRow, "id">>): void;
  getJob(id: string): JobRow | null;
  latestJob(): JobRow | null;
  /** Live jobs (queued/generating/compositing) → error; returns affected ids. */
  sweepLiveJobs(error: string): string[];
}

const LIVE_STATES: JobState[] = ["queued", "generating", "compositing"];

/** SQLite-backed repo over the shared MentorOS database. */
export class SqliteFaceRepo implements FaceRepo {
  constructor(private readonly db: Database.Database) {
    migrateFaces(db);
  }

  listPresets(): PresetRow[] {
    return this.db
      .prepare(
        `SELECT id, name, accent, has_full AS hasFull, created_at AS createdAt
         FROM face_presets ORDER BY created_at ASC, rowid ASC`,
      )
      .all()
      .map((r) => toPresetRow(r as RawPresetRow));
  }

  getPreset(id: string): PresetRow | null {
    const row = this.db
      .prepare(
        `SELECT id, name, accent, has_full AS hasFull, created_at AS createdAt
         FROM face_presets WHERE id = ?`,
      )
      .get(id) as RawPresetRow | undefined;
    return row ? toPresetRow(row) : null;
  }

  insertPreset(row: PresetRow): void {
    this.db
      .prepare(
        `INSERT INTO face_presets (id, name, accent, has_full, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, accent = excluded.accent,
           has_full = excluded.has_full, created_at = excluded.created_at`,
      )
      .run(row.id, row.name, row.accent, row.hasFull ? 1 : 0, row.createdAt);
  }

  deletePreset(id: string): boolean {
    return this.db.prepare(`DELETE FROM face_presets WHERE id = ?`).run(id).changes > 0;
  }

  insertJob(row: JobRow): void {
    this.db
      .prepare(
        `INSERT INTO face_jobs
           (id, preset_id, name, state, step, completed_frames, total_frames, error, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.presetId,
        row.name,
        row.state,
        row.step,
        row.completedFrames,
        row.totalFrames,
        row.error,
        row.startedAt,
      );
  }

  updateJob(id: string, patch: Partial<Omit<JobRow, "id">>): void {
    const cols: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, string> = {
      presetId: "preset_id",
      name: "name",
      state: "state",
      step: "step",
      completedFrames: "completed_frames",
      totalFrames: "total_frames",
      error: "error",
      startedAt: "started_at",
    };
    for (const [k, v] of Object.entries(patch)) {
      const col = map[k];
      if (!col) continue;
      cols.push(`${col} = ?`);
      vals.push(v);
    }
    if (cols.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE face_jobs SET ${cols.join(", ")} WHERE id = ?`).run(...vals);
  }

  getJob(id: string): JobRow | null {
    const row = this.db.prepare(jobSelect(`WHERE id = ?`)).get(id) as RawJobRow | undefined;
    return row ? toJobRow(row) : null;
  }

  latestJob(): JobRow | null {
    const row = this.db
      .prepare(jobSelect(`ORDER BY started_at DESC, rowid DESC LIMIT 1`))
      .get() as RawJobRow | undefined;
    return row ? toJobRow(row) : null;
  }

  sweepLiveJobs(error: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM face_jobs WHERE state IN ('queued','generating','compositing')`,
      )
      .all() as Array<{ id: string }>;
    if (rows.length === 0) return [];
    this.db
      .prepare(
        `UPDATE face_jobs SET state = 'error', error = ?
         WHERE state IN ('queued','generating','compositing')`,
      )
      .run(error);
    return rows.map((r) => r.id);
  }
}

interface RawPresetRow {
  id: string;
  name: string;
  accent: string;
  hasFull: number;
  createdAt: string;
}
function toPresetRow(r: RawPresetRow): PresetRow {
  return { id: r.id, name: r.name, accent: r.accent, hasFull: !!r.hasFull, createdAt: r.createdAt };
}

interface RawJobRow {
  id: string;
  presetId: string;
  name: string;
  state: string;
  step: string;
  completedFrames: number;
  totalFrames: number;
  error: string | null;
  startedAt: string;
}
function jobSelect(tail: string): string {
  return `SELECT id, preset_id AS presetId, name, state, step,
                 completed_frames AS completedFrames, total_frames AS totalFrames,
                 error, started_at AS startedAt
          FROM face_jobs ${tail}`;
}
function toJobRow(r: RawJobRow): JobRow {
  return {
    id: r.id,
    presetId: r.presetId,
    name: r.name,
    state: (LIVE_STATES.includes(r.state as JobState) ||
    ["done", "error", "cancelled"].includes(r.state)
      ? r.state
      : "error") as JobState,
    step: r.step,
    completedFrames: r.completedFrames,
    totalFrames: r.totalFrames,
    error: r.error,
    startedAt: r.startedAt,
  };
}

export function migrateFaces(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS face_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      accent TEXT NOT NULL,
      has_full INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS face_jobs (
      id TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      step TEXT NOT NULL,
      completed_frames INTEGER NOT NULL DEFAULT 0,
      total_frames INTEGER NOT NULL DEFAULT 4,
      error TEXT,
      started_at TEXT NOT NULL
    );
  `);
}

/* --------------------------------- slug ----------------------------------- */

export function slugifyFace(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "mentor";
}

/* --------------------------- serialization -------------------------------- */

/** Server-relative art URLs (the client absolutizes them). */
export function serializePreset(row: PresetRow): CustomFacePreset {
  const art = (file: string): string => `/faces/art/${row.id}/${file}`;
  const preset: CustomFacePreset = {
    id: row.id,
    name: row.name,
    accent: row.accent,
    portrait: {
      base: art(FRAME_FILES.base),
      mouthSmall: art(FRAME_FILES.m1),
      mouthOpen: art(FRAME_FILES.m2),
      mouthWide: art(FRAME_FILES.m3),
      blink: art(FRAME_FILES.blink),
    },
    createdAt: row.createdAt,
  };
  if (row.hasFull) preset.full = art(FRAME_FILES.full);
  return preset;
}

export function jobRowToStatus(row: JobRow): FaceJobStatus {
  const status: FaceJobStatus = {
    jobId: row.id,
    presetId: row.presetId,
    name: row.name,
    state: row.state,
    step: row.step,
    completedFrames: row.completedFrames,
    totalFrames: row.totalFrames,
    startedAt: row.startedAt,
  };
  if (row.error) status.error = row.error;
  return status;
}

/** Lookup consumed by settings/personas so `face-<slug>` ids validate. */
export interface FaceLookup {
  has(id: string): boolean;
}

/** Face-preset data store (persistence + slug dedupe). */
export class FaceStore implements FaceLookup {
  constructor(private readonly repo: FaceRepo) {}

  list(): PresetRow[] {
    return this.repo.listPresets();
  }

  listCustom(): CustomFacePreset[] {
    return this.repo.listPresets().map(serializePreset);
  }

  get(id: string): PresetRow | null {
    return this.repo.getPreset(id);
  }

  /** FaceLookup: a known CUSTOM preset id (built-ins are validated separately). */
  has(id: string): boolean {
    return this.repo.getPreset(id) !== null;
  }

  insertPreset(row: PresetRow): void {
    this.repo.insertPreset(row);
  }

  deletePresetRow(id: string): boolean {
    return this.repo.deletePreset(id);
  }

  /** A fresh, unused `face-<slug>` id (dedupes against persisted presets only). */
  uniqueId(name: string): string {
    const base = `face-${slugifyFace(name)}`;
    const taken = (id: string): boolean => BUILTIN_FACE_IDS.has(id) || this.repo.getPreset(id) !== null;
    if (!taken(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!taken(candidate)) return candidate;
    }
  }

  insertJob(row: JobRow): void {
    this.repo.insertJob(row);
  }
  updateJob(id: string, patch: Partial<Omit<JobRow, "id">>): void {
    this.repo.updateJob(id, patch);
  }
  getJob(id: string): JobRow | null {
    return this.repo.getJob(id);
  }
  latestJob(): JobRow | null {
    return this.repo.latestJob();
  }
  sweepLiveJobs(error: string): string[] {
    return this.repo.sweepLiveJobs(error);
  }
}
