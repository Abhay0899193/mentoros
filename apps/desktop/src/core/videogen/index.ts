import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { CoreEvents } from "../types.js";
import { SqliteVideoGenRepo } from "./store.js";
import { defaultVideoGenProbe } from "./toolchain.js";
import { VideoGenService } from "./service.js";

/**
 * Build the Video Lab subsystem on the shared MentorOS database (own connection,
 * WAL — mirror of the other §2.5 subsystems). Text/image-to-video generation
 * with the local LTX-2.3 (mlx-video) backend; jobs stream progress over the
 * `videogen.job` websocket event.
 */
type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

export interface VideoGenSystem {
  service: VideoGenService;
  close(): void;
}

export function createVideoGenSystem(dataDir: string, broadcast: Broadcast): VideoGenSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const repo = new SqliteVideoGenRepo(db);
  const service = new VideoGenService({
    dataDir,
    repo,
    broadcast,
    probe: defaultVideoGenProbe(),
  });

  return {
    service,
    close() {
      db.close();
    },
  };
}

export { registerVideoGenRoutes, type VideoGenDeps } from "./routes.js";
export { VideoGenService, VideoGenBusyError } from "./service.js";
