import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteKeyKv } from "../llm/keys.js";
import { defaultToolchainProbe } from "../faces/toolchain.js";
import { FalKeyStore } from "./keys.js";
import { SqliteImageGenRepo } from "./store.js";
import { defaultImageGenProbe } from "./toolchain.js";
import { ImageGenService } from "./service.js";

/**
 * Build the Image Lab subsystem on the shared MentorOS database (own connection,
 * WAL — mirror of the other §2.5 subsystems). Text-to-image generation with
 * selectable local (mflux) / hosted (fal.ai) backends; the fal key rides the
 * same secret KV as the Anthropic key.
 */
export interface ImageGenSystem {
  service: ImageGenService;
  keys: FalKeyStore;
  close(): void;
}

export function createImageGenSystem(dataDir: string): ImageGenSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const keys = new FalKeyStore(new SqliteKeyKv(db));
  const repo = new SqliteImageGenRepo(db);
  const service = new ImageGenService({
    dataDir,
    repo,
    falKeys: keys,
    probe: defaultImageGenProbe(),
    kontextProbe: defaultToolchainProbe(),
  });

  return {
    service,
    keys,
    close() {
      db.close();
    },
  };
}

export { registerImageGenRoutes, type ImageGenDeps } from "./routes.js";
export { FalKeyStore, maskFalKey } from "./keys.js";
export { ImageGenService, ImageGenBusyError } from "./service.js";
