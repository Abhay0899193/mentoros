import type Database from "better-sqlite3";
import type {
  BuiltinPersonaId,
  FacePresetId,
  Persona,
  PersonaInput,
  PersonaRecord,
  PersonaStyle,
} from "../types.js";

/**
 * Custom-persona store (Settings → Personas). The 4 built-ins are code-defined,
 * read-only records; customs live in the `personas` table. A persona's blurb
 * adjusts TONE only — the teaching-ladder instructions are appended by the
 * prompt module for every persona and are never persona-configurable.
 *
 * Persistence is behind {@link PersonaRepo} so the CRUD/validation logic is unit
 * testable without loading the native better-sqlite3 addon; production wires the
 * SQLite-backed {@link SqlitePersonaRepo}.
 */

/* --------------------------------- errors --------------------------------- */

/** Invalid create/update input (→ HTTP 422). */
export class PersonaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonaValidationError";
  }
}

/** Unknown persona id (→ HTTP 404). */
export class PersonaNotFoundError extends Error {
  constructor(message = "persona not found") {
    super(message);
    this.name = "PersonaNotFoundError";
  }
}

/** Attempt to mutate a built-in persona (→ HTTP 403). */
export class PersonaForbiddenError extends Error {
  constructor(message = "built-in personas cannot be modified") {
    super(message);
    this.name = "PersonaForbiddenError";
  }
}

/* ------------------------------- built-ins -------------------------------- */

const STYLES = new Set<PersonaStyle>(["strict", "balanced", "supportive"]);
export function isPersonaStyle(v: unknown): v is PersonaStyle {
  return typeof v === "string" && STYLES.has(v as PersonaStyle);
}

// Kept in lock-step with the settings store's face-preset validation.
const FACE_PRESETS = new Set<string>([
  "aura",
  "nova",
  "ivy",
  "rae",
  "lena",
  "sienna",
  "kira",
]);

/**
 * The built-in personas. Their blurbs are the single source of truth for
 * {@link builtinBlurb} / the system prompt; name/tagline/style/domains give the
 * pickers something real to render.
 */
export const BUILTIN_PERSONAS: PersonaRecord[] = [
  {
    id: "staff-engineer",
    name: "Staff Engineer",
    tagline: "Warm, pragmatic mentor for a strong SDE3",
    style: "balanced",
    domains: ["system design", "trade-offs", "production"],
    builtIn: true,
    blurb:
      "You are a warm, pragmatic Staff Engineer mentoring a strong SDE3. You reason from first principles, weigh trade-offs, and reference real production experience without lecturing.",
  },
  {
    id: "interviewer",
    name: "Interviewer",
    tagline: "Rigorous senior technical interviewer",
    style: "strict",
    domains: ["edge cases", "complexity", "problem-solving"],
    builtIn: true,
    blurb:
      "You are a senior technical interviewer at a top company. You are encouraging but rigorous: you probe edge cases, ask the engineer to justify choices, and nudge rather than hand over answers.",
  },
  {
    id: "teacher",
    name: "Teacher",
    tagline: "Patient CS teacher who builds intuition",
    style: "supportive",
    domains: ["fundamentals", "intuition", "examples"],
    builtIn: true,
    blurb:
      "You are a patient CS teacher. You build intuition from the ground up, use small concrete examples and analogies, and check understanding before moving on.",
  },
  {
    id: "architect",
    name: "Architect",
    tagline: "Systems architect thinking in constraints & scale",
    style: "balanced",
    domains: ["distributed systems", "scalability", "failure modes"],
    builtIn: true,
    blurb:
      "You are a systems architect. You think in terms of constraints, scale, failure modes, and long-term evolution, and you make the reasoning behind each decision explicit.",
  },
];

export const BUILTIN_PERSONA_IDS = new Set<string>(
  BUILTIN_PERSONAS.map((p) => p.id),
);

const BUILTIN_BLURBS: Record<string, string> = Object.fromEntries(
  BUILTIN_PERSONAS.map((p) => [p.id, p.blurb]),
);

/** Resolve a built-in (or unknown) id to its tone blurb; unknown → staff-engineer. */
export function builtinBlurb(id: Persona): string {
  return BUILTIN_BLURBS[id] ?? BUILTIN_BLURBS["staff-engineer"];
}

/* ------------------------------ persistence ------------------------------- */

export interface PersonaRow {
  id: string;
  name: string;
  tagline: string;
  style: string;
  domainsJson: string;
  blurb: string;
  mentorFace: string | null;
  ttsVoice: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Minimal persistence contract for custom personas. */
export interface PersonaRepo {
  /** Customs only, oldest first (created_at ASC). */
  all(): PersonaRow[];
  get(id: string): PersonaRow | null;
  insert(row: PersonaRow): void;
  update(row: PersonaRow): void;
  /** True when a row was removed. */
  delete(id: string): boolean;
}

/** SQLite-backed persona repo over the shared MentorOS database. */
export class SqlitePersonaRepo implements PersonaRepo {
  constructor(private readonly db: Database.Database) {
    migratePersonas(db);
  }

  all(): PersonaRow[] {
    return (
      this.db
        .prepare(
          `SELECT id, name, tagline, style, domains_json AS domainsJson, blurb,
                  mentor_face AS mentorFace, tts_voice AS ttsVoice,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM personas ORDER BY created_at ASC, rowid ASC`,
        )
        .all() as PersonaRow[]
    );
  }

  get(id: string): PersonaRow | null {
    const row = this.db
      .prepare(
        `SELECT id, name, tagline, style, domains_json AS domainsJson, blurb,
                mentor_face AS mentorFace, tts_voice AS ttsVoice,
                created_at AS createdAt, updated_at AS updatedAt
         FROM personas WHERE id = ?`,
      )
      .get(id) as PersonaRow | undefined;
    return row ?? null;
  }

  insert(row: PersonaRow): void {
    this.db
      .prepare(
        `INSERT INTO personas
           (id, name, tagline, style, domains_json, blurb, mentor_face, tts_voice, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.name,
        row.tagline,
        row.style,
        row.domainsJson,
        row.blurb,
        row.mentorFace,
        row.ttsVoice,
        row.createdAt,
        row.updatedAt,
      );
  }

  update(row: PersonaRow): void {
    this.db
      .prepare(
        `UPDATE personas SET
           name = ?, tagline = ?, style = ?, domains_json = ?, blurb = ?,
           mentor_face = ?, tts_voice = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        row.name,
        row.tagline,
        row.style,
        row.domainsJson,
        row.blurb,
        row.mentorFace,
        row.ttsVoice,
        row.updatedAt,
        row.id,
      );
  }

  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM personas WHERE id = ?`).run(id).changes > 0;
  }
}

export function migratePersonas(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      style TEXT NOT NULL,
      domains_json TEXT NOT NULL,
      blurb TEXT NOT NULL,
      mentor_face TEXT,
      tts_voice TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

/* ------------------------------- validation ------------------------------- */

/**
 * Strict validation + normalization of a full persona input. Throws
 * {@link PersonaValidationError} on any bad field. Shared by create (raw input)
 * and update (existing record merged with the patch).
 */
export function normalizePersonaInput(input: unknown): PersonaInput {
  if (!input || typeof input !== "object") {
    throw new PersonaValidationError("persona payload must be an object");
  }
  const o = input as Record<string, unknown>;

  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (name.length < 1 || name.length > 60) {
    throw new PersonaValidationError("name must be 1-60 characters");
  }

  const tagline = typeof o.tagline === "string" ? o.tagline.trim() : "";
  if (tagline.length > 120) {
    throw new PersonaValidationError("tagline must be at most 120 characters");
  }

  if (!isPersonaStyle(o.style)) {
    throw new PersonaValidationError("style must be strict, balanced, or supportive");
  }
  const style = o.style;

  const blurb = typeof o.blurb === "string" ? o.blurb.trim() : "";
  if (blurb.length < 20 || blurb.length > 1200) {
    throw new PersonaValidationError("blurb must be 20-1200 characters");
  }

  if (!Array.isArray(o.domains)) {
    throw new PersonaValidationError("domains must be an array of strings");
  }
  const domains = o.domains
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => d.length > 0);
  if (domains.length > 8) {
    throw new PersonaValidationError("at most 8 domains are allowed");
  }
  if (domains.some((d) => d.length > 40)) {
    throw new PersonaValidationError("each domain must be at most 40 characters");
  }

  const rec: PersonaInput = { name, tagline, style, domains, blurb };

  if (o.mentorFace !== undefined && o.mentorFace !== null) {
    if (typeof o.mentorFace !== "string" || !FACE_PRESETS.has(o.mentorFace)) {
      throw new PersonaValidationError("mentorFace must be a known face preset");
    }
    rec.mentorFace = o.mentorFace as FacePresetId;
  }
  if (o.ttsVoice !== undefined && o.ttsVoice !== null) {
    if (typeof o.ttsVoice !== "string" || o.ttsVoice.trim().length === 0) {
      throw new PersonaValidationError("ttsVoice must be a non-empty string");
    }
    rec.ttsVoice = o.ttsVoice.trim();
  }
  return rec;
}

/* --------------------------------- slug ----------------------------------- */

export function slugifyPersona(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "mentor";
}

/* --------------------------------- store ---------------------------------- */

/** The slice of the settings store the persona store touches on delete. */
export interface ActivePersonaSettings {
  get(): { activePersona: Persona };
  patch(input: { activePersona: Persona }): unknown;
}

function rowToRecord(row: PersonaRow): PersonaRecord {
  const rec: PersonaRecord = {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    style: (isPersonaStyle(row.style) ? row.style : "balanced") as PersonaStyle,
    domains: safeDomains(row.domainsJson),
    blurb: row.blurb,
    builtIn: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.mentorFace && FACE_PRESETS.has(row.mentorFace)) {
    rec.mentorFace = row.mentorFace as FacePresetId;
  }
  if (row.ttsVoice) rec.ttsVoice = row.ttsVoice;
  return rec;
}

function recordToInput(rec: PersonaRecord): PersonaInput {
  const input: PersonaInput = {
    name: rec.name,
    tagline: rec.tagline,
    style: rec.style,
    domains: [...rec.domains],
    blurb: rec.blurb,
  };
  if (rec.mentorFace) input.mentorFace = rec.mentorFace;
  if (rec.ttsVoice) input.ttsVoice = rec.ttsVoice;
  return input;
}

function inputToRow(id: string, input: PersonaInput, createdAt: string, updatedAt: string): PersonaRow {
  return {
    id,
    name: input.name,
    tagline: input.tagline,
    style: input.style,
    domainsJson: JSON.stringify(input.domains),
    blurb: input.blurb,
    mentorFace: input.mentorFace ?? null,
    ttsVoice: input.ttsVoice ?? null,
    createdAt,
    updatedAt,
  };
}

function safeDomains(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export class PersonaStore {
  constructor(
    private readonly repo: PersonaRepo,
    private readonly settings?: ActivePersonaSettings,
  ) {}

  /** Built-ins first (fixed order), then customs by createdAt. */
  list(): PersonaRecord[] {
    return [...BUILTIN_PERSONAS, ...this.repo.all().map(rowToRecord)];
  }

  /** Resolve a persona by id (built-in or custom); null if unknown. */
  get(id: Persona): PersonaRecord | null {
    const builtin = BUILTIN_PERSONAS.find((p) => p.id === id);
    if (builtin) return builtin;
    const row = this.repo.get(id);
    return row ? rowToRecord(row) : null;
  }

  /** Tone blurb for the system prompt: custom → stored, built-in/unknown → blurb table. */
  blurb(id: Persona): string {
    if (!BUILTIN_PERSONA_IDS.has(id)) {
      const row = this.repo.get(id);
      if (row) return row.blurb;
    }
    return builtinBlurb(id);
  }

  /** For settings.activePersona validation. */
  has(id: string): boolean {
    return this.get(id) !== null;
  }

  /** Identity bundle applied to settings when a persona is activated. */
  identity(id: string): { mentorFace?: FacePresetId; ttsVoice?: string } | null {
    const rec = this.get(id);
    if (!rec) return null;
    const out: { mentorFace?: FacePresetId; ttsVoice?: string } = {};
    if (rec.mentorFace) out.mentorFace = rec.mentorFace;
    if (rec.ttsVoice) out.ttsVoice = rec.ttsVoice;
    return out.mentorFace || out.ttsVoice ? out : null;
  }

  create(input: unknown): PersonaRecord {
    const norm = normalizePersonaInput(input);
    const id = this.uniqueId(norm.name);
    const now = new Date().toISOString();
    const row = inputToRow(id, norm, now, now);
    this.repo.insert(row);
    return rowToRecord(row);
  }

  update(id: Persona, patch: unknown): PersonaRecord {
    if (BUILTIN_PERSONA_IDS.has(id)) throw new PersonaForbiddenError();
    const row = this.repo.get(id);
    if (!row) throw new PersonaNotFoundError();
    if (!patch || typeof patch !== "object") {
      throw new PersonaValidationError("persona patch must be an object");
    }
    const merged = { ...recordToInput(rowToRecord(row)), ...(patch as Record<string, unknown>) };
    const norm = normalizePersonaInput(merged);
    const next = inputToRow(id, norm, row.createdAt, new Date().toISOString());
    this.repo.update(next);
    return rowToRecord(next);
  }

  /** Delete a custom persona; reset settings.activePersona if it pointed here. */
  delete(id: Persona): { activePersonaReset: boolean } {
    if (BUILTIN_PERSONA_IDS.has(id)) throw new PersonaForbiddenError();
    if (!this.repo.delete(id)) throw new PersonaNotFoundError();
    let activePersonaReset = false;
    if (this.settings && this.settings.get().activePersona === id) {
      this.settings.patch({ activePersona: "staff-engineer" });
      activePersonaReset = true;
    }
    return { activePersonaReset };
  }

  private uniqueId(name: string): string {
    const base = `persona-${slugifyPersona(name)}`;
    const taken = new Set<string>([
      ...BUILTIN_PERSONA_IDS,
      ...this.repo.all().map((r) => r.id),
    ]);
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}

export type { BuiltinPersonaId };
