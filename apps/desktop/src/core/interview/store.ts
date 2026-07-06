import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  EvalResult,
  InterviewLanguage,
  InterviewPhase,
  InterviewScorecard,
  InterviewSession,
  InterviewTurn,
  InterviewType,
} from "../types.js";

/**
 * Persistence for the interview platform (§4.5). Four tables live in the shared
 * MentorOS database (§2.5):
 *
 *   interview_sessions   — one row per attempt (phase, latest code, timings)
 *   interview_turns      — the framing/coding/interrogation transcript + hints
 *   interview_attempts   — each /run's EvalResult, as JSON
 *   interview_scorecards — the terminal §3.6 scorecard, one per session
 *
 * Expressed against {@link IInterviewStore} so the engine's session/phase logic
 * stays unit-testable with an in-memory double under plain Node (better-sqlite3
 * is built for the arm64 Electron runtime, not the x64 test runner).
 */

export interface CreateSessionInput {
  type: InterviewType;
  problemId: string;
  language: InterviewLanguage;
}

export interface AddTurnInput {
  sessionId: string;
  role: InterviewTurn["role"];
  kind: InterviewTurn["kind"];
  hintLevel?: 1 | 2 | 3;
  content: string;
}

export interface IInterviewStore {
  createSession(input: CreateSessionInput): InterviewSession;
  getSession(id: string): InterviewSession | undefined;
  listSessions(): InterviewSession[];
  setPhase(id: string, phase: InterviewPhase): void;
  setCode(id: string, code: string): void;
  /** Latest submitted code (not part of the public session shape). */
  getCode(id: string): string | undefined;
  incHints(id: string): number;
  setEnded(id: string, endedAt: string): void;

  addTurn(input: AddTurnInput): InterviewTurn;
  updateTurnContent(id: string, content: string): void;
  getTurns(sessionId: string): InterviewTurn[];

  addAttempt(sessionId: string, result: EvalResult): void;
  getAttempts(sessionId: string): EvalResult[];

  setScorecard(scorecard: InterviewScorecard): void;
  getScorecard(sessionId: string): InterviewScorecard | undefined;
}

export function migrateInterview(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interview_sessions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      language TEXT NOT NULL,
      phase TEXT NOT NULL,
      hints_used INTEGER NOT NULL DEFAULT 0,
      code TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_interview_sessions_started
      ON interview_sessions(started_at DESC);
    CREATE TABLE IF NOT EXISTS interview_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      hint_level INTEGER,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_interview_turns_session
      ON interview_turns(session_id, created_at);
    CREATE TABLE IF NOT EXISTS interview_attempts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_interview_attempts_session
      ON interview_attempts(session_id, created_at);
    CREATE TABLE IF NOT EXISTS interview_scorecards (
      session_id TEXT PRIMARY KEY REFERENCES interview_sessions(id) ON DELETE CASCADE,
      scorecard_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

interface SessionRow {
  id: string;
  type: string;
  problem_id: string;
  language: string;
  phase: string;
  hints_used: number;
  code: string | null;
  started_at: string;
  ended_at: string | null;
}

interface TurnRow {
  id: string;
  session_id: string;
  role: string;
  kind: string;
  hint_level: number | null;
  content: string;
  created_at: string;
}

function rowToSession(r: SessionRow): InterviewSession {
  const s: InterviewSession = {
    id: r.id,
    type: r.type as InterviewType,
    problemId: r.problem_id,
    language: r.language as InterviewLanguage,
    phase: r.phase as InterviewPhase,
    hintsUsed: r.hints_used,
    startedAt: r.started_at,
  };
  if (r.code !== null) s.code = r.code;
  if (r.ended_at) s.endedAt = r.ended_at;
  return s;
}

function rowToTurn(r: TurnRow): InterviewTurn {
  const t: InterviewTurn = {
    id: r.id,
    sessionId: r.session_id,
    role: r.role as InterviewTurn["role"],
    kind: r.kind as InterviewTurn["kind"],
    content: r.content,
    createdAt: r.created_at,
  };
  if (r.hint_level) t.hintLevel = r.hint_level as 1 | 2 | 3;
  return t;
}

export class InterviewStore implements IInterviewStore {
  constructor(private readonly db: Database.Database) {
    migrateInterview(db);
  }

  createSession(input: CreateSessionInput): InterviewSession {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO interview_sessions
           (id, type, problem_id, language, phase, hints_used, code, started_at, ended_at)
         VALUES (?, ?, ?, ?, 'framing', 0, NULL, ?, NULL)`,
      )
      .run(id, input.type, input.problemId, input.language, now);
    return {
      id,
      type: input.type,
      problemId: input.problemId,
      language: input.language,
      phase: "framing",
      hintsUsed: 0,
      startedAt: now,
    };
  }

  getSession(id: string): InterviewSession | undefined {
    const row = this.db
      .prepare(`SELECT * FROM interview_sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  listSessions(): InterviewSession[] {
    const rows = this.db
      .prepare(`SELECT * FROM interview_sessions ORDER BY started_at DESC, rowid DESC`)
      .all() as SessionRow[];
    return rows.map(rowToSession);
  }

  setPhase(id: string, phase: InterviewPhase): void {
    this.db.prepare(`UPDATE interview_sessions SET phase = ? WHERE id = ?`).run(phase, id);
  }

  setCode(id: string, code: string): void {
    this.db.prepare(`UPDATE interview_sessions SET code = ? WHERE id = ?`).run(code, id);
  }

  getCode(id: string): string | undefined {
    const row = this.db
      .prepare(`SELECT code FROM interview_sessions WHERE id = ?`)
      .get(id) as { code: string | null } | undefined;
    return row?.code ?? undefined;
  }

  incHints(id: string): number {
    this.db
      .prepare(`UPDATE interview_sessions SET hints_used = hints_used + 1 WHERE id = ?`)
      .run(id);
    const row = this.db
      .prepare(`SELECT hints_used FROM interview_sessions WHERE id = ?`)
      .get(id) as { hints_used: number } | undefined;
    return row?.hints_used ?? 0;
  }

  setEnded(id: string, endedAt: string): void {
    this.db.prepare(`UPDATE interview_sessions SET ended_at = ? WHERE id = ?`).run(endedAt, id);
  }

  addTurn(input: AddTurnInput): InterviewTurn {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO interview_turns
           (id, session_id, role, kind, hint_level, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.sessionId, input.role, input.kind, input.hintLevel ?? null, input.content, now);
    const t: InterviewTurn = {
      id,
      sessionId: input.sessionId,
      role: input.role,
      kind: input.kind,
      content: input.content,
      createdAt: now,
    };
    if (input.hintLevel) t.hintLevel = input.hintLevel;
    return t;
  }

  updateTurnContent(id: string, content: string): void {
    this.db.prepare(`UPDATE interview_turns SET content = ? WHERE id = ?`).run(content, id);
  }

  getTurns(sessionId: string): InterviewTurn[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM interview_turns WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sessionId) as TurnRow[];
    return rows.map(rowToTurn);
  }

  addAttempt(sessionId: string, result: EvalResult): void {
    this.db
      .prepare(
        `INSERT INTO interview_attempts (id, session_id, result_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(result.attemptId, sessionId, JSON.stringify(result), result.ranAt);
  }

  getAttempts(sessionId: string): EvalResult[] {
    const rows = this.db
      .prepare(
        `SELECT result_json FROM interview_attempts WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sessionId) as Array<{ result_json: string }>;
    return rows.map((r) => JSON.parse(r.result_json) as EvalResult);
  }

  setScorecard(scorecard: InterviewScorecard): void {
    this.db
      .prepare(
        `INSERT INTO interview_scorecards (session_id, scorecard_json, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET scorecard_json = excluded.scorecard_json`,
      )
      .run(scorecard.sessionId, JSON.stringify(scorecard), scorecard.createdAt);
  }

  getScorecard(sessionId: string): InterviewScorecard | undefined {
    const row = this.db
      .prepare(`SELECT scorecard_json FROM interview_scorecards WHERE session_id = ?`)
      .get(sessionId) as { scorecard_json: string } | undefined;
    return row ? (JSON.parse(row.scorecard_json) as InterviewScorecard) : undefined;
  }
}
