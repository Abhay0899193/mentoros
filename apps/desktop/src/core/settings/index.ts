import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SettingsStore, SqliteSettingsKv } from "./store.js";

export interface SettingsSystem {
  store: SettingsStore;
  close(): void;
}

/**
 * Build the settings subsystem on the shared MentorOS database (own connection,
 * WAL — mirror of the memory/kb/interview subsystems, §2.5).
 */
export function createSettingsSystem(dataDir: string): SettingsSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const store = new SettingsStore(new SqliteSettingsKv(db));
  return {
    store,
    close() {
      db.close();
    },
  };
}

export {
  SettingsStore,
  SqliteSettingsKv,
  SettingsValidationError,
  DEFAULT_SETTINGS,
  type SettingsKv,
} from "./store.js";
export { registerSettingsRoutes, type SettingsDeps } from "./routes.js";
