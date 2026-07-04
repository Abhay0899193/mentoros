import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
  ChatMessage,
  Persona,
  SegmentBlock,
  ThreadSummary,
} from "./types.js";

/**
 * SQLite persistence for chat threads and messages. Deliberately Electron-free:
 * the caller passes a data directory (Electron main passes app userData; the
 * default keeps core runnable headless). Messages store their typed segments as
 * JSON so the teaching-posture structure round-trips.
 */

const TITLE_MAX = 60;

export interface StoredMessage extends ChatMessage {}

export function defaultDataDir(): string {
  return join(homedir(), ".mentoros", "data");
}

export class Store {
  private readonly db: Database.Database;

  constructor(dataDir: string = defaultDataDir()) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, "mentoros.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        persona TEXT,
        segments_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread
        ON messages(thread_id, created_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  /* ------------------------------- threads ------------------------------- */

  createThread(title?: string): ThreadSummary {
    const id = randomUUID();
    const now = new Date().toISOString();
    const trimmed = title?.trim() || null;
    this.db
      .prepare(
        `INSERT INTO threads (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, trimmed, now, now);
    return { id, title: displayTitle(trimmed), updatedAt: now, messageCount: 0 };
  }

  listThreads(): ThreadSummary[] {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.title, t.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS messageCount
         FROM threads t
         ORDER BY t.updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      title: string | null;
      updatedAt: string;
      messageCount: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      title: displayTitle(r.title),
      updatedAt: r.updatedAt,
      messageCount: r.messageCount,
    }));
  }

  threadExists(id: string): boolean {
    return (
      this.db.prepare(`SELECT 1 FROM threads WHERE id = ?`).get(id) !== undefined
    );
  }

  deleteThread(id: string): void {
    this.db.prepare(`DELETE FROM threads WHERE id = ?`).run(id);
  }

  /** Bump updated_at; set the title from the first user message if untitled. */
  private touchThread(id: string, firstUserContent?: string): void {
    const now = new Date().toISOString();
    const row = this.db
      .prepare(`SELECT title FROM threads WHERE id = ?`)
      .get(id) as { title: string | null } | undefined;
    if (row && (row.title === null || row.title === "") && firstUserContent) {
      this.db
        .prepare(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`)
        .run(truncateTitle(firstUserContent), now, id);
    } else {
      this.db
        .prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`)
        .run(now, id);
    }
  }

  /* ------------------------------ messages ------------------------------- */

  getMessages(threadId: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, thread_id, role, persona, segments_json, created_at
         FROM messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(threadId) as Array<{
      id: string;
      thread_id: string;
      role: "user" | "assistant";
      persona: string | null;
      segments_json: string;
      created_at: string;
    }>;
    return rows.map(rowToMessage);
  }

  /** Persist a user message and (re)title the thread on first turn. */
  addUserMessage(
    threadId: string,
    content: string,
    persona: Persona,
  ): ChatMessage {
    const id = randomUUID();
    const now = new Date().toISOString();
    const segments: SegmentBlock[] = [{ segment: "prose", content }];
    this.db
      .prepare(
        `INSERT INTO messages (id, thread_id, role, persona, segments_json, created_at)
         VALUES (?, ?, 'user', ?, ?, ?)`,
      )
      .run(id, threadId, persona, JSON.stringify(segments), now);
    this.touchThread(threadId, content);
    return {
      id,
      threadId,
      role: "user",
      persona,
      createdAt: now,
      segments,
    };
  }

  /** Create the empty assistant row that streaming will fill in. */
  addAssistantPlaceholder(threadId: string, persona: Persona): ChatMessage {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO messages (id, thread_id, role, persona, segments_json, created_at)
         VALUES (?, ?, 'assistant', ?, '[]', ?)`,
      )
      .run(id, threadId, persona, now);
    return {
      id,
      threadId,
      role: "assistant",
      persona,
      createdAt: now,
      segments: [],
    };
  }

  updateMessageSegments(id: string, segments: SegmentBlock[]): void {
    this.db
      .prepare(`UPDATE messages SET segments_json = ? WHERE id = ?`)
      .run(JSON.stringify(segments), id);
    const row = this.db
      .prepare(`SELECT thread_id FROM messages WHERE id = ?`)
      .get(id) as { thread_id: string } | undefined;
    if (row) this.touchThread(row.thread_id);
  }
}

function displayTitle(title: string | null): string {
  return title && title.length > 0 ? title : "New chat";
}

function truncateTitle(content: string): string {
  const clean = content.trim().replace(/\s+/g, " ");
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}…` : clean;
}

function rowToMessage(row: {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  persona: string | null;
  segments_json: string;
  created_at: string;
}): ChatMessage {
  const message: ChatMessage = {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    createdAt: row.created_at,
    segments: JSON.parse(row.segments_json) as SegmentBlock[],
  };
  if (row.persona) message.persona = row.persona as Persona;
  return message;
}

export { truncateTitle };
