import type Database from "better-sqlite3";
import {
  getBankProblem,
  PROBLEMS,
  type BankProblem,
} from "./problems.js";

/**
 * Persistence for user-imported ("custom") interview problems (§4.5 importer).
 * A single table in the shared MentorOS database:
 *
 *   interview_custom_problems — one BankProblem-shaped JSON row per import.
 *
 * Hidden data (tests + graduated hints) is stored server-side exactly like the
 * static bank, so a candidate can never read the answer key. The draft's
 * `referenceSolution` is validation-only and is NEVER persisted; `custom` is
 * omitted from the stored JSON and re-applied on read (store-sourced problems
 * are always custom). Expressed against {@link IImportStore} so the engine's
 * merge logic stays unit-testable with an in-memory double (better-sqlite3 is
 * built for the arm64 Electron runtime, not the x64 test runner).
 */

export interface IImportStore {
  list(): BankProblem[];
  get(id: string): BankProblem | undefined;
  save(problem: BankProblem): void;
  delete(id: string): boolean;
}

export function migrateImportStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interview_custom_problems (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      created_at TEXT
    );
  `);
}

/**
 * Serialize a BankProblem for storage: drop `custom` (re-applied on read) and
 * any stray `referenceSolution` a caller may have leaked onto the object. The
 * BankProblem type has no referenceSolution field, so this is belt-and-braces.
 */
function serialize(problem: BankProblem): string {
  const clean: Record<string, unknown> = { ...problem };
  delete clean.custom;
  delete clean.referenceSolution;
  return JSON.stringify(clean);
}

/** Parse a stored row back into a BankProblem, forcing `custom: true`. */
function parse(json: string): BankProblem {
  const p = JSON.parse(json) as BankProblem;
  p.custom = true;
  return p;
}

export class InterviewImportStore implements IImportStore {
  constructor(private readonly db: Database.Database) {
    migrateImportStore(db);
  }

  list(): BankProblem[] {
    const rows = this.db
      .prepare(`SELECT json FROM interview_custom_problems ORDER BY created_at ASC, rowid ASC`)
      .all() as Array<{ json: string }>;
    return rows.map((r) => parse(r.json));
  }

  get(id: string): BankProblem | undefined {
    const row = this.db
      .prepare(`SELECT json FROM interview_custom_problems WHERE id = ?`)
      .get(id) as { json: string } | undefined;
    return row ? parse(row.json) : undefined;
  }

  save(problem: BankProblem): void {
    this.db
      .prepare(
        `INSERT INTO interview_custom_problems (id, json, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      )
      .run(problem.id, serialize(problem), new Date().toISOString());
  }

  delete(id: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM interview_custom_problems WHERE id = ?`)
      .run(id);
    return info.changes > 0;
  }
}

/* ----------------------- bank + custom merge accessors ---------------------- */

/** Static bank first, then custom problems — the pool every consumer sees. */
export function allProblems(store: IImportStore): BankProblem[] {
  return [...PROBLEMS, ...store.list()];
}

/** Resolve an id across the static bank and the custom store. */
export function findProblem(store: IImportStore, id: string): BankProblem | undefined {
  return getBankProblem(id) ?? store.get(id);
}

/** True for a static-bank id (built-ins are never deletable). */
export function isBuiltInProblem(id: string): boolean {
  return getBankProblem(id) !== undefined;
}

/** In-memory {@link IImportStore} for tests (no better-sqlite3 dependency). */
export class MemImportStore implements IImportStore {
  private readonly rows = new Map<string, string>();

  list(): BankProblem[] {
    return [...this.rows.values()].map(parse);
  }
  get(id: string): BankProblem | undefined {
    const json = this.rows.get(id);
    return json ? parse(json) : undefined;
  }
  save(problem: BankProblem): void {
    this.rows.set(problem.id, serialize(problem));
  }
  delete(id: string): boolean {
    return this.rows.delete(id);
  }
}
