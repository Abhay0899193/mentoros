import type Database from "better-sqlite3";
import type { ApiKeyState } from "../types.js";

/**
 * Secret store for provider API keys. Backed by the same `settings(key,value)`
 * KV table as SettingsStore but under a reserved `keys.` prefix — the key is a
 * SECRET, never a setting: it must never appear in AppSettings / GET /settings,
 * and SettingsStore rejects any `keys.*` patch. Kept behind {@link KeyKv} so the
 * logic is unit-testable without the native better-sqlite3 addon.
 *
 * Rows:
 *   keys.anthropic        → the raw key
 *   keys.anthropic.state  → 'valid' | 'invalid'
 *   keys.anthropic.error  → human validation error (optional)
 *   keys.endpoint.<id>    → the raw token for a custom endpoint (no state row —
 *                           endpoint token validation is the /test route's job,
 *                           ephemeral, so we don't persist a valid/invalid flag)
 */

const KEY = "keys.anthropic";
const STATE = "keys.anthropic.state";
const ERROR = "keys.anthropic.error";
const ENDPOINT_PREFIX = "keys.endpoint.";

/** KV persistence contract for secrets (adds delete over SettingsKv). */
export interface KeyKv {
  readAll(): Array<{ key: string; value: string }>;
  writeMany(entries: Array<[string, string]>): void;
  deleteKeys(keys: string[]): void;
}

/** SQLite-backed secret KV over the shared `settings(key,value)` table. */
export class SqliteKeyKv implements KeyKv {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  readAll(): Array<{ key: string; value: string }> {
    return this.db
      .prepare(`SELECT key, value FROM settings WHERE key LIKE 'keys.%'`)
      .all() as Array<{ key: string; value: string }>;
  }

  writeMany(entries: Array<[string, string]>): void {
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    const tx = this.db.transaction(() => {
      for (const [key, value] of entries) stmt.run(key, value);
    });
    tx();
  }

  deleteKeys(keys: string[]): void {
    const stmt = this.db.prepare(`DELETE FROM settings WHERE key = ?`);
    const tx = this.db.transaction(() => {
      for (const key of keys) stmt.run(key);
    });
    tx();
  }
}

/** Display mask for a key: 'sk-ant-…' + its last 4 chars (short-string safe). */
export function maskAnthropicKey(key: string): string {
  return `sk-ant-…${key.slice(-4)}`;
}

/** Generic secret mask: '…' + last 4 chars (for custom-endpoint tokens). */
export function maskKey(key: string): string {
  return `…${key.slice(-4)}`;
}

export class KeyStore {
  constructor(private readonly kv: KeyKv) {}

  private read(): Map<string, string> {
    return new Map(this.kv.readAll().map(({ key, value }) => [key, value]));
  }

  /** The stored raw key, or null when none is set. */
  getKey(): string | null {
    const v = this.read().get(KEY);
    return v && v.length > 0 ? v : null;
  }

  /** Validation state: 'none' when no key stored, else the persisted state. */
  getState(): ApiKeyState {
    const rows = this.read();
    if (!rows.get(KEY)) return "none";
    const s = rows.get(STATE);
    return s === "valid" || s === "invalid" ? s : "invalid";
  }

  getError(): string | undefined {
    return this.read().get(ERROR) || undefined;
  }

  /** Masked display form, or undefined when no key is stored. */
  getMask(): string | undefined {
    const key = this.getKey();
    return key ? maskAnthropicKey(key) : undefined;
  }

  /** Store the key + its validation result (clears any stale error). */
  setKey(key: string, state: "valid" | "invalid", error?: string): void {
    this.kv.deleteKeys([ERROR]);
    const entries: Array<[string, string]> = [
      [KEY, key],
      [STATE, state],
    ];
    if (error) entries.push([ERROR, error]);
    this.kv.writeMany(entries);
  }

  /** Forget the key and all its metadata rows. */
  clear(): void {
    this.kv.deleteKeys([KEY, STATE, ERROR]);
  }

  /* ------------------------- custom-endpoint tokens ------------------------ */

  /** The stored raw token for a custom endpoint, or null when none is set. */
  getEndpointToken(id: string): string | null {
    const v = this.read().get(ENDPOINT_PREFIX + id);
    return v && v.length > 0 ? v : null;
  }

  /** Store (or overwrite) a custom endpoint's token. */
  setEndpointToken(id: string, token: string): void {
    this.kv.writeMany([[ENDPOINT_PREFIX + id, token]]);
  }

  /** Forget a custom endpoint's token (no-op when absent). */
  clearEndpointToken(id: string): void {
    this.kv.deleteKeys([ENDPOINT_PREFIX + id]);
  }

  /** Masked display form of a custom endpoint token, or undefined when unset. */
  endpointTokenMask(id: string): string | undefined {
    const token = this.getEndpointToken(id);
    return token ? maskKey(token) : undefined;
  }
}
