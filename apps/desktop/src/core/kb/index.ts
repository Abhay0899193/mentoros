import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { CoreEvents } from "../types.js";
import { KbEngine } from "./engine.js";
import { KbStore } from "./store.js";
import { SqliteKbVectorIndex } from "./vectorIndex.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

export interface KbSystem {
  engine: KbEngine;
  close(): void;
}

/**
 * Build the KB subsystem against the shared MentorOS database. Opens its own
 * connection (WAL supports concurrent readers/writers) so the module stays
 * decoupled while writing to the same portable file (§2.5).
 */
export function createKbSystem(dataDir: string, broadcast: Broadcast): KbSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const store = new KbStore(db);
  const vectors = new SqliteKbVectorIndex(db);
  const engine = new KbEngine(store, vectors, broadcast);

  return {
    engine,
    close() {
      db.close();
    },
  };
}

export { KbEngine } from "./engine.js";
export { KbStore, migrateKb } from "./store.js";
export { SqliteKbVectorIndex } from "./vectorIndex.js";
export type { KbVectorIndex } from "./vectorIndex.js";
