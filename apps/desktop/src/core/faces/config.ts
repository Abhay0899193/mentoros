import type {
  AddFaceExpressionInput,
  AnimationClip,
  AvatarConfig,
  ConversationEvent,
  CreateManualFacePresetInput,
  ExpressionGroupOrCustom,
  FaceRegion,
  GenerateExpressionSpec,
  GenerateFacePresetInput,
  PoseChannels,
  PoseKeyframe,
  TriggerRule,
  UpdateAvatarConfigInput,
} from "../types.js";
import { FaceValidationError } from "./validate.js";
import { SAFE_ART_FILE } from "./paths.js";
import { catalogEntry } from "./catalog.js";
import type { PresetRow } from "./store.js";

/**
 * Generic avatar-config layer. Rows persist an AvatarConfig as `config_json`;
 * AI-generated (legacy) rows have NULL config and are synthesized into the
 * fixed blink/talk sprite clips. Frame paths inside a config are BARE
 * filenames (dir-relative) — {@link serializePreset} maps them to
 * `/faces/art/<id>/<file>` URLs for the client.
 *
 * Validation (Avatar Studio create + editor save) throws
 * {@link FaceValidationError} with human messages → HTTP 422.
 */

/* --------------------------- legacy synthesis ----------------------------- */

/** Build the fixed 5-frame sprite config for a NULL-config (AI-generated) row. */
export function synthesizeLegacyConfig(row: PresetRow): AvatarConfig {
  const blink: AnimationClip = {
    id: "blink",
    name: "Blink",
    category: "idle",
    appliesTo: "portrait",
    renderKind: "sprite",
    track: "eyes",
    frames: ["portrait-blink.webp"],
    driver: "time",
    durationMs: 130,
    loopMode: "once",
    priority: 10,
  };
  const talk: AnimationClip = {
    id: "talk",
    name: "Talk",
    category: "idle",
    appliesTo: "portrait",
    renderKind: "sprite",
    track: "mouth",
    frames: ["portrait-m1.webp", "portrait-m2.webp", "portrait-m3.webp"],
    driver: "envelope",
    loopMode: "loop",
    priority: 20,
  };
  const config: AvatarConfig = {
    schemaVersion: 1,
    presetId: row.id,
    name: row.name,
    accent: row.accent,
    baseFrame: "portrait-base.webp",
    animations: [blink, talk],
    triggers: [
      { id: "blink-auto", animationId: "blink", kind: "randomInterval", minMs: 2400, maxMs: 5200, enabled: true },
    ],
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
  };
  if (row.hasFull) config.fullBase = "full.webp";
  return config;
}

/** Read a row's config; never throws — falls back to legacy synthesis. */
export function parseConfig(row: PresetRow): AvatarConfig {
  if (!row.configJson) return synthesizeLegacyConfig(row);
  try {
    const parsed = JSON.parse(row.configJson) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as AvatarConfig).baseFrame !== "string" ||
      !Array.isArray((parsed as AvatarConfig).animations) ||
      !Array.isArray((parsed as AvatarConfig).triggers)
    ) {
      return synthesizeLegacyConfig(row);
    }
    return parsed as AvatarConfig;
  } catch {
    return synthesizeLegacyConfig(row);
  }
}

/* ------------------------------ validation -------------------------------- */

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const WEBP_PREFIX = "data:image/webp;base64,";
const MAX_FRAME_BYTES = 6 * 1024 * 1024;

const APPLIES_TO = ["portrait", "full"] as const;
const RENDER_KIND = ["sprite", "procedural"] as const;
const DRIVER = ["time", "envelope"] as const;
const LOOP_MODE = ["once", "loop", "pingpong", "holdLast"] as const;
const TEXT_MATCH_MODE = ["contains", "regex", "startsWith", "endsWith", "keywords"] as const;
const TEXT_MATCH_TARGET = ["assistant", "user"] as const;
const CONVERSATION_EVENTS: readonly ConversationEvent[] = [
  "conversationStarted",
  "conversationEnded",
  "listening",
  "thinking",
  "speakingStarted",
  "speakingEnded",
  "idle",
  "silenceTimeout",
];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isFiniteInt(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v);
}
function requireString(v: unknown, label: string, min: number, max: number): string {
  if (typeof v !== "string") throw new FaceValidationError(`${label} must be a string`);
  if (v.length < min || v.length > max) {
    throw new FaceValidationError(`${label} must be ${min}-${max} characters`);
  }
  return v;
}
function requireSlug(v: unknown, label: string): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 32 || !SLUG.test(v)) {
    throw new FaceValidationError(`${label} must be a slug (a-z 0-9 -, max 32)`);
  }
  return v;
}
function requireEnum<T extends string>(v: unknown, allowed: readonly T[], label: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new FaceValidationError(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}
function requireStringArray(v: unknown, label: string, maxItems: number): string[] {
  if (!Array.isArray(v)) throw new FaceValidationError(`${label} must be an array`);
  if (v.length > maxItems) throw new FaceValidationError(`${label} has too many entries`);
  return v.map((x, i) => {
    if (typeof x !== "string") throw new FaceValidationError(`${label}[${i}] must be a string`);
    return x;
  });
}

/** name 1–60 chars (trimmed). */
function validateName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (name.length < 1 || name.length > 60) {
    throw new FaceValidationError("name must be 1-60 characters");
  }
  return name;
}
/** accent must be #rrggbb. */
function validateAccent(v: unknown): string {
  if (typeof v !== "string" || !HEX.test(v)) {
    throw new FaceValidationError("accent must be a #rrggbb hex color");
  }
  return v;
}

/** A `data:image/webp;base64,…` URI: ≤6MB decoded, RIFF/WEBP magic. */
function requireWebpDataUri(v: unknown, label: string): void {
  if (typeof v !== "string" || !v.startsWith(WEBP_PREFIX)) {
    throw new FaceValidationError(`${label} must be a webp data URI`);
  }
  const buf = Buffer.from(v.slice(WEBP_PREFIX.length), "base64");
  if (buf.length === 0) throw new FaceValidationError(`${label} is empty`);
  if (buf.length > MAX_FRAME_BYTES) throw new FaceValidationError(`${label} exceeds the 6MB frame limit`);
  if (
    buf.length < 12 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new FaceValidationError(`${label} is not a valid webp image`);
  }
}
/** Editor frames: an existing art filename OR a webp data URI. */
function requireArtFileOrDataUri(v: unknown, label: string): void {
  if (typeof v === "string" && SAFE_ART_FILE.test(v)) return;
  requireWebpDataUri(v, label);
}

function validatePose(value: unknown[], clipId: string): PoseKeyframe[] {
  const out: PoseKeyframe[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      throw new FaceValidationError(`${clipId} keyframe must be an object`);
    }
    const o = raw as Record<string, unknown>;
    if (!isFiniteNumber(o.at) || o.at < 0 || o.at > 1) {
      throw new FaceValidationError(`${clipId} keyframe 'at' must be a number in [0,1]`);
    }
    if (!o.pose || typeof o.pose !== "object") {
      throw new FaceValidationError(`${clipId} keyframe needs a pose object`);
    }
    const pose: Record<string, number> = {};
    for (const [k, val] of Object.entries(o.pose as Record<string, unknown>)) {
      if (!isFiniteNumber(val)) {
        throw new FaceValidationError(`${clipId} keyframe channel ${k} must be a finite number`);
      }
      pose[k] = val;
    }
    out.push({ at: o.at, pose: pose as Partial<PoseChannels> });
  }
  return out;
}

function validateAnimations(
  value: unknown,
  frameCheck: (f: unknown, label: string) => void,
): AnimationClip[] {
  if (!Array.isArray(value)) throw new FaceValidationError("animations must be an array");
  if (value.length > 48) throw new FaceValidationError("too many animations (max 48)");
  const ids = new Set<string>();
  let totalFrames = 0;
  const clips: AnimationClip[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      throw new FaceValidationError("each animation must be an object");
    }
    const o = raw as Record<string, unknown>;
    const id = requireSlug(o.id, "animation id");
    if (ids.has(id)) throw new FaceValidationError(`duplicate animation id: ${id}`);
    ids.add(id);
    const priority = o.priority;
    if (!isFiniteInt(priority)) throw new FaceValidationError(`animation ${id} priority must be a finite integer`);
    const clip: AnimationClip = {
      id,
      name: requireString(o.name, "animation name", 1, 120),
      category: requireString(o.category, "animation category", 1, 24),
      appliesTo: requireEnum(o.appliesTo, APPLIES_TO, "appliesTo"),
      renderKind: requireEnum(o.renderKind, RENDER_KIND, "renderKind"),
      track: requireSlug(o.track, "track"),
      driver: requireEnum(o.driver, DRIVER, "driver"),
      loopMode: requireEnum(o.loopMode, LOOP_MODE, "loopMode"),
      priority,
    };
    if (o.description !== undefined) clip.description = requireString(o.description, "description", 0, 500);
    if (o.fps !== undefined) {
      if (!isFiniteNumber(o.fps) || o.fps < 1 || o.fps > 60) {
        throw new FaceValidationError(`animation ${id} fps must be 1-60`);
      }
      clip.fps = o.fps;
    }
    if (o.durationMs !== undefined) {
      if (!isFiniteNumber(o.durationMs) || o.durationMs < 30 || o.durationMs > 60000) {
        throw new FaceValidationError(`animation ${id} durationMs must be 30-60000`);
      }
      clip.durationMs = o.durationMs;
    }
    if (o.tags !== undefined) clip.tags = requireStringArray(o.tags, "tags", 32);
    if (o.thumbnail !== undefined) clip.thumbnail = requireString(o.thumbnail, "thumbnail", 1, 256);
    if (clip.renderKind === "sprite") {
      if (!Array.isArray(o.frames) || o.frames.length < 1 || o.frames.length > 64) {
        throw new FaceValidationError(`sprite animation ${id} needs a frames array of 1-64 entries`);
      }
      for (const f of o.frames) frameCheck(f, `animation ${id} frame`);
      totalFrames += o.frames.length;
      clip.frames = o.frames as string[];
    } else {
      if (!Array.isArray(o.proceduralPose) || o.proceduralPose.length < 1 || o.proceduralPose.length > 32) {
        throw new FaceValidationError(`procedural animation ${id} needs 1-32 pose keyframes`);
      }
      clip.proceduralPose = validatePose(o.proceduralPose, id);
    }
    clips.push(clip);
  }
  if (totalFrames > 240) throw new FaceValidationError("too many frames (max 240 per preset)");
  return clips;
}

function validateTriggers(value: unknown, clipIds: Set<string>): TriggerRule[] {
  if (!Array.isArray(value)) throw new FaceValidationError("triggers must be an array");
  if (value.length > 48) throw new FaceValidationError("too many triggers (max 48)");
  const ids = new Set<string>();
  const out: TriggerRule[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new FaceValidationError("each trigger must be an object");
    const o = raw as Record<string, unknown>;
    const id = requireSlug(o.id, "trigger id");
    if (ids.has(id)) throw new FaceValidationError(`duplicate trigger id: ${id}`);
    ids.add(id);
    const animationId = requireSlug(o.animationId, "trigger animationId");
    if (!clipIds.has(animationId)) {
      throw new FaceValidationError(`trigger ${id} references unknown animation ${animationId}`);
    }
    const enabled = o.enabled;
    if (typeof enabled !== "boolean") throw new FaceValidationError(`trigger ${id} enabled must be a boolean`);
    const base = { id, animationId, enabled };
    switch (o.kind) {
      case "manual":
      case "api":
        out.push({ ...base, kind: o.kind } as TriggerRule);
        break;
      case "shortcut":
        out.push({ ...base, kind: "shortcut", keys: requireString(o.keys, `trigger ${id} keys`, 1, 48) });
        break;
      case "textMatch": {
        const mode = requireEnum(o.mode, TEXT_MATCH_MODE, "textMatch mode");
        const target = requireEnum(o.target, TEXT_MATCH_TARGET, "textMatch target");
        if (!Array.isArray(o.patterns) || o.patterns.length < 1 || o.patterns.length > 16) {
          throw new FaceValidationError(`trigger ${id} needs 1-16 patterns`);
        }
        const patterns: string[] = [];
        for (const p of o.patterns) {
          if (typeof p !== "string" || p.length === 0) {
            throw new FaceValidationError(`trigger ${id} patterns must be non-empty strings`);
          }
          if (mode === "regex") {
            try {
              new RegExp(p);
            } catch {
              throw new FaceValidationError(`trigger ${id} has an invalid regex: ${p}`);
            }
          }
          patterns.push(p);
        }
        const t: Extract<TriggerRule, { kind: "textMatch" }> = { ...base, kind: "textMatch", mode, patterns, target };
        if (o.caseSensitive !== undefined) {
          if (typeof o.caseSensitive !== "boolean") {
            throw new FaceValidationError(`trigger ${id} caseSensitive must be a boolean`);
          }
          t.caseSensitive = o.caseSensitive;
        }
        out.push(t);
        break;
      }
      case "conversationEvent":
        out.push({ ...base, kind: "conversationEvent", event: requireEnum(o.event, CONVERSATION_EVENTS, "conversationEvent event") });
        break;
      case "everyNMessages": {
        if (!isFiniteInt(o.n) || o.n < 1 || o.n > 100) {
          throw new FaceValidationError(`trigger ${id} n must be an integer 1-100`);
        }
        out.push({ ...base, kind: "everyNMessages", n: o.n });
        break;
      }
      case "timer": {
        if (!isFiniteInt(o.intervalMs) || o.intervalMs < 1000 || o.intervalMs > 3600000) {
          throw new FaceValidationError(`trigger ${id} intervalMs must be 1000-3600000`);
        }
        out.push({ ...base, kind: "timer", intervalMs: o.intervalMs });
        break;
      }
      case "randomInterval": {
        if (!isFiniteInt(o.minMs) || !isFiniteInt(o.maxMs)) {
          throw new FaceValidationError(`trigger ${id} needs integer minMs/maxMs`);
        }
        if (!(o.minMs >= 500 && o.minMs <= o.maxMs && o.maxMs <= 3600000)) {
          throw new FaceValidationError(`trigger ${id} requires 500 <= min <= max <= 3600000`);
        }
        out.push({ ...base, kind: "randomInterval", minMs: o.minMs, maxMs: o.maxMs });
        break;
      }
      default:
        throw new FaceValidationError(`trigger ${id} has an unknown kind`);
    }
  }
  return out;
}

function validateDefault(v: unknown, clipIds: Set<string>): string | undefined {
  if (v === undefined || v === null) return undefined;
  const id = requireSlug(v, "defaultAnimationId");
  if (!clipIds.has(id)) {
    throw new FaceValidationError(`defaultAnimationId references unknown animation ${id}`);
  }
  return id;
}

/** POST /faces/custom/manual — frames are webp data URIs. */
export function validateManualInput(body: unknown): CreateManualFacePresetInput {
  if (!body || typeof body !== "object") throw new FaceValidationError("payload must be an object");
  const o = body as Record<string, unknown>;
  const name = validateName(o.name);
  const accent = validateAccent(o.accent);
  requireWebpDataUri(o.baseFrame, "baseFrame");
  let fullBase: string | undefined;
  if (o.fullBase !== undefined && o.fullBase !== null && o.fullBase !== "") {
    requireWebpDataUri(o.fullBase, "fullBase");
    fullBase = o.fullBase as string;
  }
  const animations = validateAnimations(o.animations, requireWebpDataUri);
  const clipIds = new Set(animations.map((c) => c.id));
  const triggers = validateTriggers(o.triggers, clipIds);
  const defaultAnimationId = validateDefault(o.defaultAnimationId, clipIds);
  const input: CreateManualFacePresetInput = { name, accent, baseFrame: o.baseFrame as string, animations, triggers };
  if (fullBase) input.fullBase = fullBase;
  if (defaultAnimationId) input.defaultAnimationId = defaultAnimationId;
  return input;
}

/* --------------------- Preset Generator (t2i) validation ------------------ */

const CANVAS = 1024;
const GROUP_OR_CUSTOM = ["mouth", "eyes", "face", "custom"] as const;
const IMAGE_DATA_URI = /^data:image\/(webp|png|jpeg|jpg);base64,/;

/** A composite window in 1024² space: inside the canvas, positive extent. */
function requireRegion1024(value: unknown, label: string): FaceRegion {
  if (!value || typeof value !== "object") throw new FaceValidationError(`${label} region is required`);
  const r = value as Record<string, unknown>;
  if (![r.x, r.y, r.width, r.height].every(isFiniteNumber)) {
    throw new FaceValidationError(`${label} region must have numeric x, y, width, height`);
  }
  const region: FaceRegion = { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number };
  if (region.width <= 0 || region.height <= 0) {
    throw new FaceValidationError(`${label} region must have positive width and height`);
  }
  if (region.x < 0 || region.y < 0 || region.x + region.width > CANVAS || region.y + region.height > CANVAS) {
    throw new FaceValidationError(`${label} region must lie inside the 1024×1024 canvas`);
  }
  return region;
}

function requirePrompt(v: unknown, label: string): string {
  return requireString(v, label, 1, 2000);
}

/** One catalog-key or custom expression spec (shared by generate + add). */
function validateExpressionSpec(raw: unknown, label: string): GenerateExpressionSpec {
  if (!raw || typeof raw !== "object") throw new FaceValidationError(`${label} must be an object`);
  const o = raw as Record<string, unknown>;
  if (o.key !== undefined && o.key !== null && o.key !== "") {
    if (typeof o.key !== "string" || !catalogEntry(o.key)) {
      throw new FaceValidationError(`${label} key is not a known expression`);
    }
    const spec: GenerateExpressionSpec = { key: o.key };
    if (o.prompt !== undefined && o.prompt !== null && o.prompt !== "") spec.prompt = requirePrompt(o.prompt, `${label} prompt`);
    return spec;
  }
  // Custom expression: needs an id slug, name, prompt, group (+ region when custom).
  const id = requireSlug(o.id, `${label} id`);
  const name = validateName(o.name);
  const prompt = requirePrompt(o.prompt, `${label} prompt`);
  const group = requireEnum(o.group, GROUP_OR_CUSTOM, `${label} group`) as ExpressionGroupOrCustom;
  const spec: GenerateExpressionSpec = { id, name, prompt, group };
  if (group === "custom") {
    spec.region = requireRegion1024(o.region, `${label} region`);
  } else if (o.region !== undefined && o.region !== null) {
    spec.region = requireRegion1024(o.region, `${label} region`);
  }
  return spec;
}

/** Optional manual composite windows (each overrides auto-detect). */
function validateRegionOverrides(v: unknown): GenerateFacePresetInput["regions"] {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object") throw new FaceValidationError("regions must be an object");
  const o = v as Record<string, unknown>;
  const out: NonNullable<GenerateFacePresetInput["regions"]> = {};
  for (const key of ["mouth", "eyes", "face"] as const) {
    if (o[key] !== undefined && o[key] !== null) out[key] = requireRegion1024(o[key], `${key} override`);
  }
  return Object.keys(out).length ? out : undefined;
}

/** POST /faces/custom/generate — text-to-image preset generation. */
export function validateGenerateInput(body: unknown): GenerateFacePresetInput {
  if (!body || typeof body !== "object") throw new FaceValidationError("payload must be an object");
  const o = body as Record<string, unknown>;
  const name = validateName(o.name);
  const characterPrompt = requirePrompt(o.characterPrompt, "characterPrompt");

  if (!Array.isArray(o.expressions)) throw new FaceValidationError("expressions must be an array");
  if (o.expressions.length > 20) throw new FaceValidationError("too many expressions (max 20)");
  const expressions = o.expressions.map((e, i) => validateExpressionSpec(e, `expressions[${i}]`));
  // Custom ids must be unique (they become clip ids).
  const customIds = new Set<string>();
  for (const e of expressions) {
    if (e.id) {
      if (customIds.has(e.id)) throw new FaceValidationError(`duplicate custom expression id: ${e.id}`);
      customIds.add(e.id);
    }
  }

  const input: GenerateFacePresetInput = { name, characterPrompt, expressions };
  const regions = validateRegionOverrides(o.regions);
  if (regions) input.regions = regions;

  const hasHistory = typeof o.baseHistoryId === "string" && o.baseHistoryId.length > 0;
  const hasDataUri = typeof o.baseDataUri === "string" && o.baseDataUri.length > 0;
  if (hasHistory === hasDataUri) {
    throw new FaceValidationError("provide exactly one of baseHistoryId or baseDataUri");
  }
  if (hasHistory) {
    input.baseHistoryId = o.baseHistoryId as string;
  } else {
    if (!IMAGE_DATA_URI.test(o.baseDataUri as string)) {
      throw new FaceValidationError("baseDataUri must be a png/webp/jpeg data URI");
    }
    input.baseDataUri = o.baseDataUri as string;
  }
  if (o.baseSeed !== undefined && o.baseSeed !== null) {
    if (!isFiniteInt(o.baseSeed) || o.baseSeed < 0 || o.baseSeed > 0xffffffff) {
      throw new FaceValidationError("baseSeed must be a uint32 (0..4294967295)");
    }
    input.baseSeed = o.baseSeed;
  }
  return input;
}

/** POST /faces/custom/:id/expressions — add or regenerate one expression. */
export function validateAddExpressionInput(body: unknown): AddFaceExpressionInput {
  if (!body || typeof body !== "object") throw new FaceValidationError("payload must be an object");
  const o = body as Record<string, unknown>;
  const spec = validateExpressionSpec(o, "expression");
  const input: AddFaceExpressionInput = { ...spec };
  if (o.replaceClipId !== undefined && o.replaceClipId !== null && o.replaceClipId !== "") {
    input.replaceClipId = requireSlug(o.replaceClipId, "replaceClipId");
  }
  if (o.trigger !== undefined && o.trigger !== null) {
    // The trigger targets the new clip; its id is resolved in the runner/service,
    // so validate its shape against a single-clip set once the clip id is known.
    input.trigger = validateSingleTrigger(o.trigger, spec, input.replaceClipId);
  }
  return input;
}

/** Validate a lone trigger whose animationId must point at this expression's clip. */
function validateSingleTrigger(
  raw: unknown,
  spec: GenerateExpressionSpec,
  replaceClipId: string | undefined,
): TriggerRule {
  const clipId = replaceClipId ?? clipIdForSpec(spec);
  const triggers = validateTriggers([{ ...(raw as object), animationId: clipId }], new Set([clipId]));
  return triggers[0]!;
}

/** The clip id an expression spec contributes to (catalog clip or custom slug). */
export function clipIdForSpec(spec: GenerateExpressionSpec): string {
  if (spec.key) {
    const entry = catalogEntry(spec.key);
    if (!entry) throw new FaceValidationError(`unknown expression key: ${spec.key}`);
    return entry.clipId;
  }
  if (!spec.id) throw new FaceValidationError("expression needs a key or an id");
  return spec.id;
}

/** PUT /faces/custom/:id/config — frames are art filenames OR webp data URIs. */
export function validateConfigUpdate(body: unknown): UpdateAvatarConfigInput {
  if (!body || typeof body !== "object") throw new FaceValidationError("payload must be an object");
  const o = body as Record<string, unknown>;
  const animations = validateAnimations(o.animations, requireArtFileOrDataUri);
  const clipIds = new Set(animations.map((c) => c.id));
  const triggers = validateTriggers(o.triggers, clipIds);
  const input: UpdateAvatarConfigInput = { animations, triggers };
  if (o.name !== undefined && o.name !== null) input.name = validateName(o.name);
  if (o.accent !== undefined && o.accent !== null) input.accent = validateAccent(o.accent);
  const defaultAnimationId = validateDefault(o.defaultAnimationId, clipIds);
  if (defaultAnimationId) input.defaultAnimationId = defaultAnimationId;
  return input;
}
