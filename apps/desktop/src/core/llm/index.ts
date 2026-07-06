import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { SettingsStore } from "../settings/store.js";
import { KeyStore, SqliteKeyKv } from "./keys.js";
import { ModelRouter } from "./router.js";

export interface LlmSystem {
  keys: KeyStore;
  router: ModelRouter;
  close(): void;
}

/**
 * Build the LLM routing subsystem: the secret KeyStore (own SQLite connection on
 * the shared DB, WAL — mirror of the other subsystems, §2.5) and the ModelRouter
 * that reads it plus the passed-in SettingsStore.
 */
export function createLlmSystem(dataDir: string, settings: SettingsStore): LlmSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const keys = new KeyStore(new SqliteKeyKv(db));
  const router = new ModelRouter(settings, keys);
  return {
    keys,
    router,
    close() {
      db.close();
    },
  };
}

export { KeyStore, SqliteKeyKv, maskAnthropicKey, type KeyKv } from "./keys.js";
export { ModelRouter } from "./router.js";
export {
  CLOUD_CATALOG,
  isCloudModel,
  toAnthropicRequest,
  validateAnthropicKey,
  humanizeAnthropicError,
} from "./anthropic.js";
export { registerModelRoutes, type ModelRoutesDeps } from "./routes.js";
