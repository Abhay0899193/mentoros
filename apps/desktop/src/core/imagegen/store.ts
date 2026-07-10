import type Database from "better-sqlite3";
import type { ImageGenHistoryItem } from "../types.js";

/**
 * Persistence for Image Lab generation history. One row per finished job; the
 * PNG lives on disk (file = `<id>.png` under imagegenRoot) and is served by the
 * art route. Kept behind {@link ImageGenRepo} so the CRUD is unit testable
 * without the native better-sqlite3 addon; production wires
 * {@link SqliteImageGenRepo}.
 */

export interface ImageGenHistoryRow {
  id: string;
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  file: string;
  createdAt: string;
}

export interface ImageGenRepo {
  insert(row: ImageGenHistoryRow): void;
  list(): ImageGenHistoryRow[];
  get(id: string): ImageGenHistoryRow | null;
  delete(id: string): boolean;
}

/** SQLite-backed repo over the shared MentorOS database. */
export class SqliteImageGenRepo implements ImageGenRepo {
  constructor(private readonly db: Database.Database) {
    migrateImageGen(db);
  }

  insert(row: ImageGenHistoryRow): void {
    this.db
      .prepare(
        `INSERT INTO imagegen_history
           (id, model_id, prompt, width, height, steps, seed, file, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.modelId,
        row.prompt,
        row.width,
        row.height,
        row.steps,
        row.seed,
        row.file,
        row.createdAt,
      );
  }

  list(): ImageGenHistoryRow[] {
    return this.db
      .prepare(imagegenSelect(`ORDER BY created_at DESC, rowid DESC`))
      .all()
      .map((r) => toRow(r as RawRow));
  }

  get(id: string): ImageGenHistoryRow | null {
    const row = this.db.prepare(imagegenSelect(`WHERE id = ?`)).get(id) as RawRow | undefined;
    return row ? toRow(row) : null;
  }

  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM imagegen_history WHERE id = ?`).run(id).changes > 0;
  }
}

interface RawRow {
  id: string;
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  file: string;
  createdAt: string;
}
function imagegenSelect(tail: string): string {
  return `SELECT id, model_id AS modelId, prompt, width, height, steps, seed,
                 file, created_at AS createdAt
          FROM imagegen_history ${tail}`;
}
function toRow(r: RawRow): ImageGenHistoryRow {
  return {
    id: r.id,
    modelId: r.modelId,
    prompt: r.prompt,
    width: r.width,
    height: r.height,
    steps: r.steps,
    seed: r.seed,
    file: r.file,
    createdAt: r.createdAt,
  };
}

export function migrateImageGen(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS imagegen_history (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      steps INTEGER NOT NULL,
      seed INTEGER NOT NULL,
      file TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

/** Server-relative art URL (the client absolutizes it). */
export function serializeHistory(row: ImageGenHistoryRow): ImageGenHistoryItem {
  return {
    id: row.id,
    modelId: row.modelId,
    prompt: row.prompt,
    width: row.width,
    height: row.height,
    steps: row.steps,
    seed: row.seed,
    url: artUrl(row.file),
    createdAt: row.createdAt,
  };
}

/** The server-relative URL for a stored art file. */
export function artUrl(file: string): string {
  return `/imagegen/art/${file}`;
}
