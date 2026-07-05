import type Database from "better-sqlite3";

/**
 * KbVectorIndex — the nearest-neighbour seam for KB chunk embeddings, parallel
 * to the memory VectorIndex. Same rationale (see memory/vectorIndex.ts): a
 * brute-force cosine scan over Float32 BLOBs stored in the same SQLite database
 * beats adding a second native ANN backend (LanceDB) that cannot load under the
 * arm64 Electron runtime. Vectors are stored L2-normalized, so cosine == dot.
 *
 * The `source_id` is denormalized onto the vector row so a source-scoped search
 * is a single-table scan with no join, and so re-ingest can wipe a source's
 * vectors in one statement.
 */

export interface KbVectorHit {
  chunkId: string;
  score: number;
}

export interface KbVectorIndex {
  upsertVector(chunkId: string, sourceId: string, vec: number[]): void;
  removeForSource(sourceId: string): void;
  search(vec: number[], k: number, sourceIds?: string[]): KbVectorHit[];
}

function toBlob(vec: number[]): Buffer {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function fromBlob(buf: Buffer): Float32Array {
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

/** cosine of two already-normalized vectors (== dot product). */
function dot(a: Float32Array, b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

export class SqliteKbVectorIndex implements KbVectorIndex {
  constructor(private readonly db: Database.Database) {}

  upsertVector(chunkId: string, sourceId: string, vec: number[]): void {
    this.db
      .prepare(
        `INSERT INTO kb_chunk_vectors (chunk_id, source_id, dim, vec)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chunk_id) DO UPDATE SET
           source_id = excluded.source_id, dim = excluded.dim, vec = excluded.vec`,
      )
      .run(chunkId, sourceId, vec.length, toBlob(vec));
  }

  removeForSource(sourceId: string): void {
    this.db
      .prepare(`DELETE FROM kb_chunk_vectors WHERE source_id = ?`)
      .run(sourceId);
  }

  search(vec: number[], k: number, sourceIds?: string[]): KbVectorHit[] {
    let sql = `SELECT chunk_id AS chunkId, vec FROM kb_chunk_vectors`;
    const params: unknown[] = [];
    if (sourceIds && sourceIds.length) {
      sql += ` WHERE source_id IN (${sourceIds.map(() => "?").join(",")})`;
      params.push(...sourceIds);
    }
    const rows = this.db.prepare(sql).all(...params) as Array<{
      chunkId: string;
      vec: Buffer;
    }>;
    const scored: KbVectorHit[] = rows.map((r) => ({
      chunkId: r.chunkId,
      score: dot(fromBlob(r.vec), vec),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, k));
  }
}
