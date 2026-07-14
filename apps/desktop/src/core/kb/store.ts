import type Database from "better-sqlite3";
import type { KbKind, KbSource } from "../types.js";

/**
 * Persistence for the personal Knowledge Base (§4.7). Three tables live in the
 * shared MentorOS database:
 *
 *   kb_sources      — one row per ingested file or folder
 *   kb_chunks       — chunked text with its file/section/ord provenance
 *   kb_chunks_fts   — an FTS5 virtual table over chunk text (contentless-style:
 *                     text is stored in the FTS index and kept in sync by hand
 *                     on insert/clear, with the chunk id carried as an
 *                     UNINDEXED column for joins/deletes)
 *
 * Chunk vectors live in a sibling table owned by SqliteKbVectorIndex.
 *
 * The store is expressed against {@link IKbStore} so ingest/search stay testable
 * with an in-memory double under plain Node (the native better-sqlite3 build
 * targets the arm64 Electron runtime, not the x64 test runner).
 */

export interface KbChunkInput {
  id: string;
  filePath: string;
  section?: string;
  ord: number;
  text: string;
}

export interface KbChunkMeta {
  id: string;
  sourceId: string;
  sourceTitle: string;
  kind: KbKind;
  filePath: string;
  section?: string;
  ord: number;
  text: string;
}

export interface UpsertSourceInput {
  id: string;
  kind: KbKind;
  title: string;
  path: string;
  tags: string[];
}

export interface SourceStats {
  fileCount: number;
  chunkCount: number;
  indexedAt: string;
}

/** The persistence surface the KB engine depends on. */
export interface IKbStore {
  upsertSource(input: UpsertSourceInput): void;
  getSource(id: string): KbSource | undefined;
  listSources(): KbSource[];
  deleteSource(id: string): void;
  /** Wipe a source's chunks (and their FTS rows) ahead of a re-index. */
  clearChunks(sourceId: string): void;
  insertChunk(sourceId: string, chunk: KbChunkInput): void;
  setSourceStats(id: string, stats: SourceStats): void;
  /** Set or clear the read marker (ISO timestamp, null = unread). */
  setSourceRead(id: string, readAt: string | null): void;
  /** FTS5 MATCH, best-first, returning chunk ids only. Query is sanitized here. */
  ftsSearch(query: string, limit: number, sourceIds?: string[]): string[];
  getChunk(chunkId: string): KbChunkMeta | undefined;
  chunksForSource(sourceId: string): KbChunkMeta[];
}

export function migrateKb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      file_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      section TEXT,
      ord INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_source ON kb_chunks(source_id, ord);
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      text,
      tokenize = 'porter unicode61'
    );
    CREATE TABLE IF NOT EXISTS kb_chunk_vectors (
      chunk_id TEXT PRIMARY KEY REFERENCES kb_chunks(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vec BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunk_vectors_source
      ON kb_chunk_vectors(source_id);
  `);
  // Additive migration: per-source read marker (null = unread). Not part of the
  // upsert's ON CONFLICT update, so re-ingesting a source preserves read state.
  const cols = db.prepare(`PRAGMA table_info(kb_sources)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "read_at")) {
    db.exec(`ALTER TABLE kb_sources ADD COLUMN read_at TEXT`);
  }
}

/**
 * Turn a free-text query into safe FTS5 MATCH expressions. FTS5 treats bare
 * double-quotes, `*`, `(`, `:`, `-`, `^`, etc. as syntax; an unbalanced quote is
 * a hard error. We tokenize to alphanumerics and quote every term so any user
 * input is inert. Empty ⇒ null (caller skips the FTS leg).
 *
 * `strict` requires every term (implicit AND) — the honest lexical signal.
 * `loose` ORs the terms, but is only worth consulting for short keyword
 * queries: on longer natural-language queries a single stray term match ("my
 * favorite pizza…" hitting a doc that merely says "favorite") ranks as top
 * relevance and reads as junk — those queries are the vector leg's job.
 */
export function sanitizeFtsQuery(
  query: string,
): { strict: string; loose: string; termCount: number } | null {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  const quoted = terms.map((t) => `"${t}"`);
  return { strict: quoted.join(" "), loose: quoted.join(" OR "), termCount: terms.length };
}

/** Loose OR matching is consulted only for queries of at most this many terms. */
export const FTS_LOOSE_MAX_TERMS = 2;

interface SourceRow {
  id: string;
  kind: string;
  title: string;
  path: string;
  tags_json: string;
  file_count: number;
  chunk_count: number;
  indexed_at: string;
  read_at: string | null;
}

function rowToSource(row: SourceRow): KbSource {
  return {
    id: row.id,
    kind: row.kind as KbKind,
    title: row.title,
    path: row.path,
    tags: JSON.parse(row.tags_json) as string[],
    fileCount: row.file_count,
    chunkCount: row.chunk_count,
    indexedAt: row.indexed_at,
    readAt: row.read_at ?? null,
  };
}

export class KbStore implements IKbStore {
  constructor(private readonly db: Database.Database) {
    migrateKb(db);
  }

  upsertSource(input: UpsertSourceInput): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO kb_sources (id, kind, title, path, tags_json, indexed_at)
         VALUES (@id, @kind, @title, @path, @tags_json, @indexed_at)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind, title = excluded.title,
           path = excluded.path, tags_json = excluded.tags_json`,
      )
      .run({
        id: input.id,
        kind: input.kind,
        title: input.title,
        path: input.path,
        tags_json: JSON.stringify(input.tags),
        indexed_at: now,
      });
  }

  getSource(id: string): KbSource | undefined {
    const row = this.db
      .prepare(`SELECT * FROM kb_sources WHERE id = ?`)
      .get(id) as SourceRow | undefined;
    return row ? rowToSource(row) : undefined;
  }

  listSources(): KbSource[] {
    const rows = this.db
      .prepare(`SELECT * FROM kb_sources ORDER BY indexed_at DESC`)
      .all() as SourceRow[];
    return rows.map(rowToSource);
  }

  deleteSource(id: string): void {
    // Cascade removes kb_chunks + kb_chunk_vectors; FTS rows are cleared first.
    this.clearChunks(id);
    this.db.prepare(`DELETE FROM kb_sources WHERE id = ?`).run(id);
  }

  clearChunks(sourceId: string): void {
    const ids = this.db
      .prepare(`SELECT id FROM kb_chunks WHERE source_id = ?`)
      .all(sourceId) as Array<{ id: string }>;
    const delFts = this.db.prepare(
      `DELETE FROM kb_chunks_fts WHERE chunk_id = ?`,
    );
    for (const { id } of ids) delFts.run(id);
    // Deleting the chunk rows cascades to kb_chunk_vectors.
    this.db.prepare(`DELETE FROM kb_chunks WHERE source_id = ?`).run(sourceId);
  }

  insertChunk(sourceId: string, chunk: KbChunkInput): void {
    this.db
      .prepare(
        `INSERT INTO kb_chunks (id, source_id, file_path, section, ord, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(chunk.id, sourceId, chunk.filePath, chunk.section ?? null, chunk.ord, chunk.text);
    this.db
      .prepare(`INSERT INTO kb_chunks_fts (chunk_id, text) VALUES (?, ?)`)
      .run(chunk.id, chunk.text);
  }

  setSourceStats(id: string, stats: SourceStats): void {
    this.db
      .prepare(
        `UPDATE kb_sources SET file_count = ?, chunk_count = ?, indexed_at = ?
         WHERE id = ?`,
      )
      .run(stats.fileCount, stats.chunkCount, stats.indexedAt, id);
  }

  setSourceRead(id: string, readAt: string | null): void {
    this.db.prepare(`UPDATE kb_sources SET read_at = ? WHERE id = ?`).run(readAt, id);
  }

  ftsSearch(query: string, limit: number, sourceIds?: string[]): string[] {
    const match = sanitizeFtsQuery(query);
    if (!match) return [];
    const strict = this.runFtsMatch(match.strict, limit, sourceIds);
    if (strict.length > 0 || match.termCount > FTS_LOOSE_MAX_TERMS) return strict;
    return this.runFtsMatch(match.loose, limit, sourceIds);
  }

  private runFtsMatch(match: string, limit: number, sourceIds?: string[]): string[] {
    let sql = `SELECT f.chunk_id AS chunkId
               FROM kb_chunks_fts f
               JOIN kb_chunks c ON c.id = f.chunk_id
               WHERE kb_chunks_fts MATCH ?`;
    const params: unknown[] = [match];
    if (sourceIds && sourceIds.length) {
      sql += ` AND c.source_id IN (${sourceIds.map(() => "?").join(",")})`;
      params.push(...sourceIds);
    }
    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as Array<{ chunkId: string }>;
    return rows.map((r) => r.chunkId);
  }

  getChunk(chunkId: string): KbChunkMeta | undefined {
    const row = this.db
      .prepare(
        `SELECT c.id, c.source_id, c.file_path, c.section, c.ord, c.text,
                s.title AS source_title, s.kind AS source_kind
         FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
         WHERE c.id = ?`,
      )
      .get(chunkId) as
      | {
          id: string;
          source_id: string;
          file_path: string;
          section: string | null;
          ord: number;
          text: string;
          source_title: string;
          source_kind: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      kind: row.source_kind as KbKind,
      filePath: row.file_path,
      section: row.section ?? undefined,
      ord: row.ord,
      text: row.text,
    };
  }

  chunksForSource(sourceId: string): KbChunkMeta[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.source_id, c.file_path, c.section, c.ord, c.text,
                s.title AS source_title, s.kind AS source_kind
         FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
         WHERE c.source_id = ? ORDER BY c.ord`,
      )
      .all(sourceId) as Array<{
      id: string;
      source_id: string;
      file_path: string;
      section: string | null;
      ord: number;
      text: string;
      source_title: string;
      source_kind: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      kind: row.source_kind as KbKind,
      filePath: row.file_path,
      section: row.section ?? undefined,
      ord: row.ord,
      text: row.text,
    }));
  }
}
