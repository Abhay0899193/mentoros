import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { SettingsStore } from "../settings/store.js";
import { EndpointStore, SqliteEndpointKv } from "./endpoints.js";
import { KeyStore, SqliteKeyKv } from "./keys.js";
import { ModelRouter, type RouterEndpoints } from "./router.js";

export interface LlmSystem {
  keys: KeyStore;
  endpoints: EndpointStore;
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
  const endpoints = new EndpointStore(new SqliteEndpointKv(db));
  // Compose config (EndpointStore) + secret (KeyStore) into the router's view.
  const routerEndpoints: RouterEndpoints = {
    get(id) {
      const cfg = endpoints.get(id);
      if (!cfg) return null;
      return {
        kind: cfg.kind,
        baseUrl: cfg.baseUrl,
        auth: cfg.auth,
        token: keys.getEndpointToken(id),
      };
    },
  };
  const router = new ModelRouter(settings, keys, routerEndpoints);
  return {
    keys,
    endpoints,
    router,
    close() {
      db.close();
    },
  };
}

export { KeyStore, SqliteKeyKv, maskAnthropicKey, maskKey, type KeyKv } from "./keys.js";
export {
  EndpointStore,
  SqliteEndpointKv,
  validateEndpointInput,
  slugify,
  EndpointValidationError,
  type EndpointKv,
  type EndpointConfig,
  type EndpointInput,
} from "./endpoints.js";
export { ModelRouter, type RouterEndpoints, type ResolvedEndpoint } from "./router.js";
export {
  CLOUD_CATALOG,
  isCloudModel,
  toAnthropicRequest,
  validateAnthropicKey,
  listAnthropicModels,
  humanizeAnthropicError,
} from "./anthropic.js";
export {
  openaiStream,
  openaiOnce,
  listOpenAiModels,
  parseSseLine,
  SseBuffer,
  humanizeStatus,
} from "./openai.js";
export { registerModelRoutes, type ModelRoutesDeps } from "./routes.js";
