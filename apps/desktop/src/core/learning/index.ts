import type { MemoryEngine } from "../memory/engine.js";
import { LearningEngine } from "./engine.js";
import { LearningStore } from "./store.js";

/**
 * Build the learning subsystem against the shared MentorOS database. Opens its
 * own connection (WAL supports concurrent readers/writers), mirror of the memory
 * subsystem — keeps the module decoupled while writing to the same portable file.
 */
export interface LearningSystem {
  engine: LearningEngine;
  store: LearningStore;
  close(): void;
}

export function createLearningSystem(
  dataDir: string,
  memory: MemoryEngine,
): LearningSystem {
  const store = new LearningStore(dataDir);
  const engine = new LearningEngine(store, memory);
  return {
    engine,
    store,
    close() {
      store.close();
    },
  };
}

export { LearningEngine } from "./engine.js";
export { LearningStore } from "./store.js";
export { import3mc, type SkillDocIngest } from "./importer.js";
export { computeSourceDigest } from "./digest.js";
export {
  createGuideGenerator,
  GuideError,
  type GuideProgress,
  type GuideRouter,
  type GuideDocIngest,
} from "./guides.js";
