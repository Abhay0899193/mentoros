import type Database from "better-sqlite3";
import { isKnownTtsVoice } from "../voice/voices.js";
import { STT_MODELS } from "../voice/sttModels.js";
import type { AppSettings, SttModelId } from "../types.js";

/**
 * Typed settings over a plain KV backend (`settings(key,value)`). Values are
 * validated on write so bad input never persists; unknown/stored-garbage keys
 * are ignored on read. `settings.changed` is broadcast by the route layer.
 *
 * Persistence is behind {@link SettingsKv} so the validation/merge logic is unit
 * testable without loading the native better-sqlite3 addon; production wires the
 * SQLite-backed {@link SqliteSettingsKv}.
 */

export const DEFAULT_SETTINGS: AppSettings = {
  ttsVoice: "af_heart",
  sttModel: "small.en",
  mentorIdentity: "orb",
};

const STT_MODEL_IDS = new Set<string>(STT_MODELS.map((m) => m.id));
const MENTOR_IDENTITIES = new Set<string>(["orb", "face"]);
const ALLOWED_KEYS = new Set<keyof AppSettings>(["ttsVoice", "sttModel", "mentorIdentity"]);

/** Minimal KV persistence contract for settings. */
export interface SettingsKv {
  readAll(): Array<{ key: string; value: string }>;
  writeMany(entries: Array<[string, string]>): void;
}

/** 400-worthy rejection of an invalid patch (unknown key or bad value). */
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

/** SQLite-backed KV over the shared `settings(key,value)` table. */
export class SqliteSettingsKv implements SettingsKv {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  readAll(): Array<{ key: string; value: string }> {
    return this.db.prepare(`SELECT key, value FROM settings`).all() as Array<{
      key: string;
      value: string;
    }>;
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
}

export class SettingsStore {
  constructor(private readonly kv: SettingsKv) {}

  /** Full settings: stored values merged over defaults (invalid values dropped). */
  get(): AppSettings {
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    for (const { key, value } of this.kv.readAll()) {
      if (key === "ttsVoice" && isKnownTtsVoice(value)) settings.ttsVoice = value;
      else if (key === "sttModel" && STT_MODEL_IDS.has(value)) settings.sttModel = value as SttModelId;
      else if (key === "mentorIdentity" && MENTOR_IDENTITIES.has(value))
        settings.mentorIdentity = value as AppSettings["mentorIdentity"];
    }
    return settings;
  }

  /**
   * Validate + persist a partial patch, returning the full merged settings.
   * Throws {@link SettingsValidationError} on any unknown key or invalid value —
   * nothing is persisted when validation fails.
   */
  patch(input: unknown): AppSettings {
    if (input === null || typeof input !== "object") {
      throw new SettingsValidationError("settings patch must be an object");
    }
    const patch = input as Record<string, unknown>;
    const entries: Array<[string, string]> = [];

    for (const [key, value] of Object.entries(patch)) {
      if (!ALLOWED_KEYS.has(key as keyof AppSettings)) {
        throw new SettingsValidationError(`unknown setting: ${key}`);
      }
      if (key === "ttsVoice") {
        if (typeof value !== "string" || !isKnownTtsVoice(value)) {
          throw new SettingsValidationError(`unknown voice: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "sttModel") {
        if (typeof value !== "string" || !STT_MODEL_IDS.has(value)) {
          throw new SettingsValidationError(`unknown STT model: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "mentorIdentity") {
        if (typeof value !== "string" || !MENTOR_IDENTITIES.has(value)) {
          throw new SettingsValidationError(`invalid mentorIdentity: ${String(value)}`);
        }
        entries.push([key, value]);
      }
    }

    if (entries.length > 0) this.kv.writeMany(entries);
    return this.get();
  }
}
