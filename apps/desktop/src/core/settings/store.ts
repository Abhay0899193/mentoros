import type Database from "better-sqlite3";
import { isKnownTtsVoice } from "../voice/voices.js";
import { STT_MODELS } from "../voice/sttModels.js";
import { isCloudModel } from "../llm/anthropic.js";
import { DEFAULT_MODEL } from "../ollama.js";
import type {
  AppSettings,
  FaceGlam,
  FaceMaturity,
  FacePresetId,
  FaceView,
  ModelChoice,
  ModelSurface,
  SttModelId,
} from "../types.js";

/**
 * Persona lookup the settings store consults for `activePersona` validation and
 * the identity-bundle merge on activation. Injected after construction so
 * settings and personas can be wired without an import cycle.
 */
export interface PersonaLookup {
  /** True when the id is a known persona (built-in or custom). */
  has(id: string): boolean;
  /** Identity fields applied to settings when the persona is activated. */
  identity(id: string): { mentorFace?: FacePresetId; ttsVoice?: string } | null;
}

/**
 * Custom-face lookup so `face-<slug>` mentorFace ids validate. Injected after
 * construction (avoids a settings↔faces cycle), mirror of {@link PersonaLookup}.
 */
export interface FaceLookup {
  /** True when the id is a known custom face preset. */
  has(id: string): boolean;
}

/** Built-in persona ids (kept in lock-step with the personas module). */
const BUILTIN_PERSONA_IDS = new Set<string>([
  "staff-engineer",
  "interviewer",
  "teacher",
  "architect",
]);

/**
 * Typed settings over a plain KV backend (`settings(key,value)`). Values are
 * validated on write so bad input never persists; unknown/stored-garbage keys
 * are ignored on read. `settings.changed` is broadcast by the route layer.
 *
 * Persistence is behind {@link SettingsKv} so the validation/merge logic is unit
 * testable without loading the native better-sqlite3 addon; production wires the
 * SQLite-backed {@link SqliteSettingsKv}.
 */

const LOCAL_DEFAULT_CHOICE: ModelChoice = { provider: "ollama", model: DEFAULT_MODEL };

export const DEFAULT_SETTINGS: AppSettings = {
  ttsVoice: "af_heart",
  sttModel: "small.en",
  mentorIdentity: "orb",
  mentorFace: "aura",
  faceGlam: "polished",
  faceMaturity: "balanced",
  faceView: "cameo",
  activePersona: "staff-engineer",
  cloudEnabled: false,
  lanAccess: false,
  models: {
    chat: { ...LOCAL_DEFAULT_CHOICE },
    voice: { ...LOCAL_DEFAULT_CHOICE },
    interviewer: { ...LOCAL_DEFAULT_CHOICE },
    scorecard: { ...LOCAL_DEFAULT_CHOICE },
    guide: { ...LOCAL_DEFAULT_CHOICE },
  },
};

const STT_MODEL_IDS = new Set<string>(STT_MODELS.map((m) => m.id));
const MENTOR_IDENTITIES = new Set<string>(["orb", "face"]);
// zara/elle/mira were retired in the face-gallery rework; stored ids fall back to default.
const FACE_PRESETS = new Set<string>(["aura", "nova", "ivy", "rae", "lena", "sienna", "kira"]);
const FACE_GLAMS = new Set<string>(["natural", "polished", "glam"]);
const FACE_MATURITIES = new Set<string>(["youthful", "balanced", "mature"]);
const FACE_VIEWS = new Set<string>(["cameo", "full"]);
const MODEL_SURFACES: ModelSurface[] = ["chat", "voice", "interviewer", "scorecard", "guide"];
const SURFACE_SET = new Set<string>(MODEL_SURFACES);
const ALLOWED_KEYS = new Set<keyof AppSettings>([
  "ttsVoice",
  "sttModel",
  "mentorIdentity",
  "mentorFace",
  "faceGlam",
  "faceMaturity",
  "faceView",
  "activePersona",
  "cloudEnabled",
  "lanAccess",
  "models",
]);

/** KV key for a per-surface routing choice, e.g. `models.chat`. */
const modelKey = (surface: ModelSurface): string => `models.${surface}`;

/**
 * Validate a ModelChoice: known provider, non-empty model, catalog id for cloud.
 * For provider 'endpoint' an endpointId (non-empty string) is required and
 * preserved — the endpoint's EXISTENCE is not checked here (a resolve-time
 * concern: a dangling endpointId simply falls back to local at routing time).
 */
function validateChoice(value: unknown): ModelChoice | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.provider !== "ollama" && v.provider !== "anthropic" && v.provider !== "endpoint") return null;
  if (typeof v.model !== "string" || v.model.trim().length === 0) return null;
  if (v.provider === "anthropic" && !isCloudModel(v.model)) return null;
  if (v.provider === "endpoint") {
    if (typeof v.endpointId !== "string" || v.endpointId.trim().length === 0) return null;
    return { provider: "endpoint", model: v.model, endpointId: v.endpointId };
  }
  return { provider: v.provider, model: v.model };
}

/** Minimal KV persistence contract for settings. */
export interface SettingsKv {
  readAll(): Array<{ key: string; value: string }>;
  writeMany(entries: Array<[string, string]>): void;
}

/** 400-worthy rejection of an invalid patch (unknown key or bad value). */
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

/** SQLite-backed KV over the shared `settings(key,value)` table. */
export class SqliteSettingsKv implements SettingsKv {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  readAll(): Array<{ key: string; value: string }> {
    return this.db.prepare(`SELECT key, value FROM settings`).all() as Array<{
      key: string;
      value: string;
    }>;
  }

  writeMany(entries: Array<[string, string]>): void {
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    const tx = this.db.transaction(() => {
      for (const [key, value] of entries) stmt.run(key, value);
    });
    tx();
  }
}

export class SettingsStore {
  constructor(
    private readonly kv: SettingsKv,
    private personas?: PersonaLookup,
    private faces?: FaceLookup,
  ) {}

  /** Wire the persona lookup after construction (avoids a settings↔personas cycle). */
  setPersonaLookup(personas: PersonaLookup): void {
    this.personas = personas;
  }

  /** Wire the custom-face lookup after construction (avoids a settings↔faces cycle). */
  setFaceLookup(faces: FaceLookup): void {
    this.faces = faces;
  }

  /** A face id valid for mentorFace: a built-in preset or a known custom one. */
  private isKnownFace(id: string): boolean {
    return FACE_PRESETS.has(id) || (this.faces?.has(id) ?? false);
  }

  /** Full settings: stored values merged over defaults (invalid values dropped). */
  get(): AppSettings {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      models: {
        chat: { ...DEFAULT_SETTINGS.models.chat },
        voice: { ...DEFAULT_SETTINGS.models.voice },
        interviewer: { ...DEFAULT_SETTINGS.models.interviewer },
        scorecard: { ...DEFAULT_SETTINGS.models.scorecard },
        guide: { ...DEFAULT_SETTINGS.models.guide },
      },
    };
    for (const { key, value } of this.kv.readAll()) {
      if (key === "ttsVoice" && isKnownTtsVoice(value)) settings.ttsVoice = value;
      else if (key === "sttModel" && STT_MODEL_IDS.has(value)) settings.sttModel = value as SttModelId;
      else if (key === "mentorIdentity" && MENTOR_IDENTITIES.has(value))
        settings.mentorIdentity = value as AppSettings["mentorIdentity"];
      else if (key === "mentorFace" && this.isKnownFace(value))
        settings.mentorFace = value as FacePresetId;
      else if (key === "faceGlam" && FACE_GLAMS.has(value)) settings.faceGlam = value as FaceGlam;
      else if (key === "faceMaturity" && FACE_MATURITIES.has(value))
        settings.faceMaturity = value as FaceMaturity;
      else if (key === "faceView" && FACE_VIEWS.has(value)) settings.faceView = value as FaceView;
      // Lenient on read: a stored active persona is trusted (delete resets it to a
      // built-in), so we reflect any non-empty value rather than re-verifying it.
      else if (key === "activePersona" && value.trim().length > 0)
        settings.activePersona = value;
      else if (key === "cloudEnabled") settings.cloudEnabled = value === "true";
      else if (key === "lanAccess") settings.lanAccess = value === "true";
      else if (key.startsWith("models.")) {
        const surface = key.slice("models.".length);
        if (!SURFACE_SET.has(surface)) continue;
        // Stored garbage (bad JSON / invalid choice) silently reverts to default.
        try {
          const choice = validateChoice(JSON.parse(value));
          if (choice) settings.models[surface as ModelSurface] = choice;
        } catch {
          /* keep the default for this surface */
        }
      }
      // keys.* rows (secrets) and any other unknown keys are ignored on read.
    }
    return settings;
  }

  /**
   * Validate + persist a partial patch, returning the full merged settings.
   * Throws {@link SettingsValidationError} on any unknown key or invalid value —
   * nothing is persisted when validation fails.
   */
  patch(input: unknown): AppSettings {
    if (input === null || typeof input !== "object") {
      throw new SettingsValidationError("settings patch must be an object");
    }
    const patch = input as Record<string, unknown>;
    const entries: Array<[string, string]> = [];

    for (const [key, value] of Object.entries(patch)) {
      if (!ALLOWED_KEYS.has(key as keyof AppSettings)) {
        throw new SettingsValidationError(`unknown setting: ${key}`);
      }
      if (key === "ttsVoice") {
        if (typeof value !== "string" || !isKnownTtsVoice(value)) {
          throw new SettingsValidationError(`unknown voice: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "sttModel") {
        if (typeof value !== "string" || !STT_MODEL_IDS.has(value)) {
          throw new SettingsValidationError(`unknown STT model: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "mentorIdentity") {
        if (typeof value !== "string" || !MENTOR_IDENTITIES.has(value)) {
          throw new SettingsValidationError(`invalid mentorIdentity: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "mentorFace") {
        if (typeof value !== "string" || !this.isKnownFace(value)) {
          throw new SettingsValidationError(`unknown face preset: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "faceGlam") {
        if (typeof value !== "string" || !FACE_GLAMS.has(value)) {
          throw new SettingsValidationError(`invalid faceGlam: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "faceMaturity") {
        if (typeof value !== "string" || !FACE_MATURITIES.has(value)) {
          throw new SettingsValidationError(`invalid faceMaturity: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "faceView") {
        if (typeof value !== "string" || !FACE_VIEWS.has(value)) {
          throw new SettingsValidationError(`invalid faceView: ${String(value)}`);
        }
        entries.push([key, value]);
      } else if (key === "activePersona") {
        if (typeof value !== "string" || value.trim().length === 0) {
          throw new SettingsValidationError(`invalid activePersona: ${String(value)}`);
        }
        const known = BUILTIN_PERSONA_IDS.has(value) || (this.personas?.has(value) ?? false);
        if (!known) {
          throw new SettingsValidationError(`unknown persona: ${value}`);
        }
        entries.push([key, value]);
        // Bundle: apply the persona's identity fields UNLESS this same patch sets
        // them explicitly (explicit wins) — one write → one settings.changed.
        const identity = this.personas?.identity(value) ?? null;
        if (identity) {
          if (
            identity.mentorFace &&
            !("mentorFace" in patch) &&
            this.isKnownFace(identity.mentorFace)
          ) {
            entries.push(["mentorFace", identity.mentorFace]);
            // A face implies the face identity so the Voice screen shows it.
            if (!("mentorIdentity" in patch)) entries.push(["mentorIdentity", "face"]);
          }
          if (
            identity.ttsVoice &&
            !("ttsVoice" in patch) &&
            isKnownTtsVoice(identity.ttsVoice)
          ) {
            entries.push(["ttsVoice", identity.ttsVoice]);
          }
        }
      } else if (key === "cloudEnabled") {
        if (typeof value !== "boolean") {
          throw new SettingsValidationError(`cloudEnabled must be a boolean`);
        }
        entries.push([key, value ? "true" : "false"]);
      } else if (key === "lanAccess") {
        if (typeof value !== "boolean") {
          throw new SettingsValidationError(`lanAccess must be a boolean`);
        }
        entries.push([key, value ? "true" : "false"]);
      } else if (key === "models") {
        if (value === null || typeof value !== "object") {
          throw new SettingsValidationError(`models must be an object`);
        }
        // Per-surface merge: each provided surface is validated + stored under
        // its own `models.<surface>` row; untouched surfaces keep their value.
        for (const [surface, choice] of Object.entries(value as Record<string, unknown>)) {
          if (!SURFACE_SET.has(surface)) {
            throw new SettingsValidationError(`unknown model surface: ${surface}`);
          }
          const valid = validateChoice(choice);
          if (!valid) {
            throw new SettingsValidationError(`invalid model choice for ${surface}`);
          }
          entries.push([modelKey(surface as ModelSurface), JSON.stringify(valid)]);
        }
      }
    }

    if (entries.length > 0) this.kv.writeMany(entries);
    return this.get();
  }
}
