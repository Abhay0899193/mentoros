import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { CoreEvents } from "../types.js";
import { MemoryEngine } from "./engine.js";
import { MemoryStore } from "./store.js";
import { SqliteVectorIndex } from "./vectorIndex.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

export interface MemorySystem {
  engine: MemoryEngine;
  close(): void;
}

/**
 * Build the memory subsystem against the shared MentorOS database. Opens its own
 * connection (WAL supports concurrent readers/writers) so the module stays
 * decoupled from the chat Store while writing to the same portable file.
 */
export function createMemorySystem(
  dataDir: string,
  broadcast?: Broadcast,
): MemorySystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const store = new MemoryStore(db);
  const vectors = new SqliteVectorIndex(db);
  const engine = new MemoryEngine(store, vectors, undefined, broadcast);
  engine.startBackgroundReembed();

  return {
    engine,
    close() {
      engine.close();
      db.close();
    },
  };
}

export { MemoryEngine, SIMILARITY_MERGE_THRESHOLD, RECALL_MIN_SCORE } from "./engine.js";
export { MemoryStore, migrateMemory } from "./store.js";
export { SqliteVectorIndex } from "./vectorIndex.js";
export type { VectorIndex } from "./vectorIndex.js";
