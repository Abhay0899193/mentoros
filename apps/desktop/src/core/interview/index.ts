import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { CoreEvents } from "../types.js";
import type { ModelRouter } from "../llm/router.js";
import { InterviewEngine, type InterviewMemory } from "./engine.js";
import { InterviewStore } from "./store.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

export interface InterviewSystem {
  engine: InterviewEngine;
  close(): void;
}

/**
 * Build the interview subsystem against the shared MentorOS database. Opens its
 * own connection (WAL supports concurrent readers/writers) — mirror of the KB /
 * memory subsystems — so the module stays decoupled while writing to the same
 * portable file (§2.5).
 */
export function createInterviewSystem(
  dataDir: string,
  broadcast: Broadcast,
  memory?: InterviewMemory,
  router?: ModelRouter,
): InterviewSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const store = new InterviewStore(db);
  const engine = new InterviewEngine({ store, broadcast, dataDir, memory, router });

  return {
    engine,
    close() {
      db.close();
    },
  };
}

export { InterviewEngine } from "./engine.js";
export { InterviewStore, migrateInterview } from "./store.js";
export type { InterviewMemory } from "./engine.js";
