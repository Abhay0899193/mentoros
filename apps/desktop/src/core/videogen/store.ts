import type Database from "better-sqlite3";
import type { VideoGenHistoryItem } from "../types.js";

/**
 * Persistence for Video Lab generation history. One row per finished job; the
 * mp4 lives on disk (file = `<id>.mp4` under videogenArtDir) and is served by
 * the art route. Kept behind {@link VideoGenRepo} so the CRUD is unit testable
 * without the native better-sqlite3 addon; production wires
 * {@link SqliteVideoGenRepo}.
 */

export interface VideoGenHistoryRow {
  id: string;
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number;
  hasSourceImage: boolean;
  durationMs: number;
  file: string;
  createdAt: string;
}

export interface VideoGenRepo {
  insert(row: VideoGenHistoryRow): void;
  list(): VideoGenHistoryRow[];
  get(id: string): VideoGenHistoryRow | null;
  delete(id: string): boolean;
}

/** SQLite-backed repo over the shared MentorOS database. */
export class SqliteVideoGenRepo implements VideoGenRepo {
  constructor(private readonly db: Database.Database) {
    migrateVideoGen(db);
  }

  insert(row: VideoGenHistoryRow): void {
    this.db
      .prepare(
        `INSERT INTO videogen_history
           (id, model_id, prompt, width, height, num_frames, fps, seed,
            has_source_image, duration_ms, file, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.modelId,
        row.prompt,
        row.width,
        row.height,
        row.numFrames,
        row.fps,
        row.seed,
        row.hasSourceImage ? 1 : 0,
        row.durationMs,
        row.file,
        row.createdAt,
      );
  }

  list(): VideoGenHistoryRow[] {
    return this.db
      .prepare(videogenSelect(`ORDER BY created_at DESC, rowid DESC`))
      .all()
      .map((r) => toRow(r as RawRow));
  }

  get(id: string): VideoGenHistoryRow | null {
    const row = this.db.prepare(videogenSelect(`WHERE id = ?`)).get(id) as RawRow | undefined;
    return row ? toRow(row) : null;
  }

  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM videogen_history WHERE id = ?`).run(id).changes > 0;
  }
}

interface RawRow {
  id: string;
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number;
  hasSourceImage: number;
  durationMs: number;
  file: string;
  createdAt: string;
}
function videogenSelect(tail: string): string {
  return `SELECT id, model_id AS modelId, prompt, width, height,
                 num_frames AS numFrames, fps, seed,
                 has_source_image AS hasSourceImage, duration_ms AS durationMs,
                 file, created_at AS createdAt
          FROM videogen_history ${tail}`;
}
function toRow(r: RawRow): VideoGenHistoryRow {
  return {
    id: r.id,
    modelId: r.modelId,
    prompt: r.prompt,
    width: r.width,
    height: r.height,
    numFrames: r.numFrames,
    fps: r.fps,
    seed: r.seed,
    hasSourceImage: r.hasSourceImage !== 0,
    durationMs: r.durationMs,
    file: r.file,
    createdAt: r.createdAt,
  };
}

export function migrateVideoGen(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videogen_history (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      num_frames INTEGER NOT NULL,
      fps INTEGER NOT NULL,
      seed INTEGER NOT NULL,
      has_source_image INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      file TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

/** Server-relative art URL (the client absolutizes it). */
export function serializeHistory(row: VideoGenHistoryRow): VideoGenHistoryItem {
  return {
    id: row.id,
    modelId: row.modelId,
    prompt: row.prompt,
    width: row.width,
    height: row.height,
    numFrames: row.numFrames,
    fps: row.fps,
    seed: row.seed,
    hasSourceImage: row.hasSourceImage,
    durationMs: row.durationMs,
    url: artUrl(row.file),
    createdAt: row.createdAt,
  };
}

/** The server-relative URL for a stored art file. */
export function artUrl(file: string): string {
  return `/videogen/art/${file}`;
}
