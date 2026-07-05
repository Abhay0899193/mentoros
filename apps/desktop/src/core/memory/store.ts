import type Database from "better-sqlite3";
import type { MemoryRecord, MemoryType } from "../types.js";

/**
 * Persistence for typed memory records + their embedding vectors. Shares the
 * same SQLite database as chat (passed in by the caller), so the whole of a
 * user's knowledge lives in one portable file (§2.5).
 *
 * Records are stored in `memories`; vectors live in a sibling `memory_vectors`
 * table as raw Float32 BLOBs. The split keeps the record schema exactly as the
 * contract specifies while letting the vector index (below) do a brute-force
 * cosine scan — fine at our scale of thousands of records.
 */

export interface MemoryRow {
  id: string;
  type: string;
  title: string;
  body: string;
  confidence: number;
  source: string;
  tags_json: string;
  links_json: string;
  history_json: string;
  created_at: string;
  updated_at: string;
  needs_embedding: number;
}

export function migrateMemory(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      links_json TEXT NOT NULL DEFAULT '[]',
      history_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      needs_embedding INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type, updated_at);
    CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
    CREATE TABLE IF NOT EXISTS memory_vectors (
      id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      dim INTEGER NOT NULL,
      vec BLOB NOT NULL
    );
  `);
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    type: row.type as MemoryType,
    title: row.title,
    body: row.body,
    confidence: row.confidence,
    source: row.source,
    tags: JSON.parse(row.tags_json) as string[],
    links: JSON.parse(row.links_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: JSON.parse(row.history_json) as { at: string; body: string }[],
  };
}

export interface ListOpts {
  type?: MemoryType;
  q?: string;
  limit?: number;
}

/**
 * The persistence surface MemoryEngine depends on. Extracting it as an interface
 * keeps the engine testable with an in-memory double under plain Node (the
 * native better-sqlite3 build targets the arm64 Electron runtime, not the x64
 * test runner).
 */
export interface IMemoryStore {
  insert(record: MemoryRecord, needsEmbedding: boolean): void;
  update(record: MemoryRecord, needsEmbedding?: boolean): void;
  get(id: string): MemoryRecord | undefined;
  all(): MemoryRecord[];
  list(opts?: ListOpts): MemoryRecord[];
  likeSearch(query: string, types: MemoryType[] | undefined, limit: number): MemoryRecord[];
  delete(id: string): void;
  pendingEmbedding(): MemoryRecord[];
  setNeedsEmbedding(id: string, needs: boolean): void;
}

const DEFAULT_LIMIT = 200;

export class MemoryStore implements IMemoryStore {
  constructor(private readonly db: Database.Database) {
    migrateMemory(db);
  }

  insert(record: MemoryRecord, needsEmbedding: boolean): void {
    this.db
      .prepare(
        `INSERT INTO memories
          (id, type, title, body, confidence, source, tags_json, links_json,
           history_json, created_at, updated_at, needs_embedding)
         VALUES (@id, @type, @title, @body, @confidence, @source, @tags_json,
                 @links_json, @history_json, @created_at, @updated_at, @needs_embedding)`,
      )
      .run({
        id: record.id,
        type: record.type,
        title: record.title,
        body: record.body,
        confidence: record.confidence,
        source: record.source,
        tags_json: JSON.stringify(record.tags),
        links_json: JSON.stringify(record.links),
        history_json: JSON.stringify(record.history),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        needs_embedding: needsEmbedding ? 1 : 0,
      });
  }

  update(record: MemoryRecord, needsEmbedding?: boolean): void {
    const setNeeds = needsEmbedding === undefined ? "" : ", needs_embedding = @needs_embedding";
    this.db
      .prepare(
        `UPDATE memories SET
           type = @type, title = @title, body = @body, confidence = @confidence,
           source = @source, tags_json = @tags_json, links_json = @links_json,
           history_json = @history_json, updated_at = @updated_at${setNeeds}
         WHERE id = @id`,
      )
      .run({
        id: record.id,
        type: record.type,
        title: record.title,
        body: record.body,
        confidence: record.confidence,
        source: record.source,
        tags_json: JSON.stringify(record.tags),
        links_json: JSON.stringify(record.links),
        history_json: JSON.stringify(record.history),
        updated_at: record.updatedAt,
        needs_embedding: needsEmbedding ? 1 : 0,
      });
  }

  get(id: string): MemoryRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM memories WHERE id = ?`)
      .get(id) as MemoryRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  all(): MemoryRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories ORDER BY updated_at DESC`)
      .all() as MemoryRow[];
    return rows.map(rowToRecord);
  }

  list(opts: ListOpts = {}): MemoryRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.type) {
      clauses.push(`type = ?`);
      params.push(opts.type);
    }
    if (opts.q && opts.q.trim().length > 0) {
      clauses.push(`(title LIKE ? OR body LIKE ?)`);
      const like = `%${opts.q.trim()}%`;
      params.push(like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = opts.limit && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;
    const rows = this.db
      .prepare(
        `SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...params, limit) as MemoryRow[];
    return rows.map(rowToRecord);
  }

  /** LIKE fallback used by recall when embeddings are unavailable. */
  likeSearch(query: string, types: MemoryType[] | undefined, limit: number): MemoryRecord[] {
    const clauses: string[] = [`(title LIKE ? OR body LIKE ?)`];
    const like = `%${query.trim()}%`;
    const params: unknown[] = [like, like];
    if (types && types.length) {
      clauses.push(`type IN (${types.map(() => "?").join(",")})`);
      params.push(...types);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...params, limit) as MemoryRow[];
    return rows.map(rowToRecord);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM memory_vectors WHERE id = ?`).run(id);
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  }

  pendingEmbedding(): MemoryRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE needs_embedding = 1`)
      .all() as MemoryRow[];
    return rows.map(rowToRecord);
  }

  setNeedsEmbedding(id: string, needs: boolean): void {
    this.db
      .prepare(`UPDATE memories SET needs_embedding = ? WHERE id = ?`)
      .run(needs ? 1 : 0, id);
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM memories`).get() as {
      n: number;
    };
    return row.n;
  }
}
