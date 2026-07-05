import type Database from "better-sqlite3";
import type { MemoryType } from "../types.js";

/**
 * VectorIndex — the clean seam between memory logic and the nearest-neighbour
 * backend. The interface is deliberately backend-agnostic so a LanceDB (or any
 * ANN) implementation can drop in later without touching callers.
 *
 * Backend deviation (reported): we do NOT use `@lancedb/lancedb`. The dev
 * toolchain runs Node under Rosetta (x64) while Electron is arm64; LanceDB
 * ships Rust/napi prebuilds selected at install time by the installing arch
 * (darwin-x64), which the arm64 Electron runtime cannot load — and unlike
 * better-sqlite3 there is no electron-rebuild path for it. At our scale
 * (thousands of records) a brute-force cosine scan over Float32 BLOBs stored in
 * the same SQLite database is simpler, has zero extra native surface, and is
 * plenty fast. Vectors are stored L2-normalized, so cosine == dot product.
 */

export interface VectorHit {
  id: string;
  score: number;
}

export interface VectorSearchOpts {
  types?: MemoryType[];
}

export interface VectorIndex {
  upsertVector(id: string, vec: number[]): void;
  removeVector(id: string): void;
  search(vec: number[], k: number, opts?: VectorSearchOpts): VectorHit[];
}

function toBlob(vec: number[]): Buffer {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function fromBlob(buf: Buffer): Float32Array {
  // Copy into an aligned buffer; SQLite BLOBs are not guaranteed 4-byte aligned.
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

/** cosine similarity of two already-normalized vectors (== dot product). */
function dot(a: Float32Array, b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

export class SqliteVectorIndex implements VectorIndex {
  constructor(private readonly db: Database.Database) {}

  upsertVector(id: string, vec: number[]): void {
    this.db
      .prepare(
        `INSERT INTO memory_vectors (id, dim, vec) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET dim = excluded.dim, vec = excluded.vec`,
      )
      .run(id, vec.length, toBlob(vec));
  }

  removeVector(id: string): void {
    this.db.prepare(`DELETE FROM memory_vectors WHERE id = ?`).run(id);
  }

  search(vec: number[], k: number, opts: VectorSearchOpts = {}): VectorHit[] {
    const types = opts.types;
    let sql = `SELECT v.id AS id, v.vec AS vec FROM memory_vectors v JOIN memories m ON m.id = v.id`;
    const params: unknown[] = [];
    if (types && types.length) {
      sql += ` WHERE m.type IN (${types.map(() => "?").join(",")})`;
      params.push(...types);
    }
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      vec: Buffer;
    }>;
    const scored: VectorHit[] = rows.map((r) => ({
      id: r.id,
      score: dot(fromBlob(r.vec), vec),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, k));
  }
}
