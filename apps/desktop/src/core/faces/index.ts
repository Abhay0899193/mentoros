import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { CoreEvents } from "../types.js";
import { FaceStore, SqliteFaceRepo } from "./store.js";
import { createRealFaceOps } from "./ops.js";
import { defaultToolchainProbe } from "./toolchain.js";
import { facesRoot } from "./paths.js";
import { FaceService, type ActiveFaceSettings } from "./service.js";

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

export interface FaceSystem {
  store: FaceStore;
  service: FaceService;
  close(): void;
}

/**
 * Build the custom-face subsystem on the shared MentorOS database (own
 * connection, WAL — mirror of the other §2.5 subsystems). The GPU step is
 * swapped for an instant tinted stub when MENTOROS_FACES_FAKE=1, so the UI can
 * be verified end-to-end without a ~1h GPU run.
 */
export function createFaceSystem(
  dataDir: string,
  broadcast: Broadcast,
  settings?: ActiveFaceSettings,
): FaceSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const store = new FaceStore(new SqliteFaceRepo(db));
  const fakeGeneration = process.env.MENTOROS_FACES_FAKE === "1";
  const ops = createRealFaceOps(join(facesRoot(dataDir), ".scripts"), { fakeGeneration });
  const service = new FaceService({
    dataDir,
    store,
    ops,
    broadcast,
    toolchainProbe: defaultToolchainProbe(),
    ...(settings ? { settings } : {}),
  });

  return {
    store,
    service,
    close() {
      db.close();
    },
  };
}

export { registerFaceRoutes, type FaceDeps } from "./routes.js";
export { sipsProbe } from "./ops.js";
export { FaceStore, type FaceLookup } from "./store.js";
export type { ActiveFaceSettings } from "./service.js";
export {
  parseConfig,
  synthesizeLegacyConfig,
  validateConfigUpdate,
  validateManualInput,
} from "./config.js";
