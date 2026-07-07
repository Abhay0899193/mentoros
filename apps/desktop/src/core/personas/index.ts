import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PersonaStore, SqlitePersonaRepo, type ActivePersonaSettings } from "./store.js";

export interface PersonaSystem {
  store: PersonaStore;
  close(): void;
}

/**
 * Build the persona subsystem on the shared MentorOS database (own connection,
 * WAL — mirror of the memory/kb/interview/settings subsystems, §2.5). The
 * settings store is injected so deleting the active custom persona can reset
 * settings.activePersona to 'staff-engineer' in the same request.
 */
export function createPersonaSystem(
  dataDir: string,
  settings?: ActivePersonaSettings,
): PersonaSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const store = new PersonaStore(new SqlitePersonaRepo(db), settings);
  return {
    store,
    close() {
      db.close();
    },
  };
}

export {
  PersonaStore,
  SqlitePersonaRepo,
  migratePersonas,
  normalizePersonaInput,
  slugifyPersona,
  isPersonaStyle,
  builtinBlurb,
  BUILTIN_PERSONAS,
  BUILTIN_PERSONA_IDS,
  PersonaValidationError,
  PersonaNotFoundError,
  PersonaForbiddenError,
  type PersonaRepo,
  type PersonaRow,
  type ActivePersonaSettings,
} from "./store.js";
export { systemPrompt, MARKER_INSTRUCTIONS, type BlurbResolver } from "./prompt.js";
export {
  generatePersonaDraft,
  clampDraft,
  extractFirstJsonObject,
  PersonaDraftError,
  type PersonaDraftOnce,
} from "./draft.js";
export { registerPersonaRoutes, type PersonaDeps } from "./routes.js";
