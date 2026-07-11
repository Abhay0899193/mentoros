import type {
  AnimationClip,
  AvatarConfig,
  ExpressionGroup,
  FaceCatalogEntry,
  FaceRegion,
  PresetGenerationMeta,
  TriggerRule,
} from "../types.js";

/**
 * The proven Preset-Generator expression catalog (verbatim from the Kiki recipe
 * `gen_kiki.sh` / `insert_kiki.sh`). Every frame is a z-image-turbo t2i render
 * with the SAME character seed and a per-frame expression clause; the anti-drift
 * feathered-ellipse composite pastes only the region onto the untouched base, so
 * whole-image regeneration is safe.
 *
 *   - m1/m2/m3 (mouth) → the three-frame `talk` clip (envelope lip-sync)
 *   - blink (eyes)     → the `blink` idle clip
 *   - 6 emotions (face) → one single-frame `reaction` clip each
 *
 * Frame paths inside a config are BARE filenames (dir-relative); serializePreset
 * maps them to `/faces/art/<id>/<file>` URLs for the client.
 */

/** A catalog expression: proven prompts + the clip its frame contributes to. */
export interface CatalogExpression {
  key: string;
  /** Clip this expression's frame belongs to ('talk'/'blink'/emotion id). */
  clipId: string;
  name: string;
  group: ExpressionGroup;
  required: boolean;
  /** Verbatim z-image-turbo trailing clause (gen_kiki.sh). */
  t2iClause: string;
  /** Action-first FLUX-Kontext edit prompt (gen_variants.sh, else equivalent). */
  kontextPrompt: string;
  /** Canonical webp this expression writes (portrait-mX or anim-<clipId>-0). */
  frameFile: string;
}

/** Region composite windows in 1024² space — kiki_regions.json (cx,cy,rx,ry → x,y,w,h). */
export const DEFAULT_REGIONS_1024: {
  mouth: FaceRegion;
  eyes: FaceRegion;
  face: FaceRegion;
} = {
  mouth: { x: 464, y: 392, width: 132, height: 120 },
  eyes: { x: 393, y: 262, width: 250, height: 92 },
  face: { x: 382, y: 197, width: 284, height: 350 },
};

/* --------------------------------- entries -------------------------------- */

export const CATALOG: readonly CatalogExpression[] = [
  {
    key: "m1",
    clipId: "talk",
    name: "Mouth — soft gap",
    group: "mouth",
    required: true,
    t2iClause:
      "Calm expression, lips relaxed and slightly parted leaving a small soft gap, no teeth visible, eyes open looking at the camera.",
    kontextPrompt:
      "Open her lips into a small gap as if speaking softly, a narrow dark opening clearly visible between her lips, no teeth showing.",
    frameFile: "portrait-m1.webp",
  },
  {
    key: "m2",
    clipId: "talk",
    name: "Mouth — half open",
    group: "mouth",
    required: true,
    t2iClause:
      "Speaking mid-word with her mouth half open as if saying ah, upper teeth just visible, eyes open looking at the camera.",
    kontextPrompt:
      "Open her mouth wide as if speaking, saying 'ah', upper teeth visible, lips apart.",
    frameFile: "portrait-m2.webp",
  },
  {
    key: "m3",
    clipId: "talk",
    name: "Mouth — wide open",
    group: "mouth",
    required: true,
    t2iClause:
      "Speaking expressively with her mouth open wide mid-word, upper teeth visible, eyes open looking at the camera.",
    kontextPrompt:
      "Open her mouth very wide as if speaking emphatically, saying 'wow', upper and lower teeth visible.",
    frameFile: "portrait-m3.webp",
  },
  {
    key: "blink",
    clipId: "blink",
    name: "Blink",
    group: "eyes",
    required: true,
    t2iClause:
      "Calm neutral expression, eyes fully closed with relaxed eyelids, lips gently closed.",
    kontextPrompt: "Close her eyes completely, relaxed closed eyelids, natural lashes.",
    frameFile: "portrait-blink.webp",
  },
  {
    key: "think",
    clipId: "think",
    name: "Think",
    group: "face",
    required: false,
    t2iClause:
      "Thoughtful pondering expression, eyes glancing up and to one side, lips gently closed, one eyebrow slightly raised.",
    kontextPrompt:
      "Make her look thoughtful and pondering, eyes glancing up and to one side, one eyebrow slightly raised, lips gently closed.",
    frameFile: "anim-think-0.webp",
  },
  {
    key: "smile",
    clipId: "smile",
    name: "Smile",
    group: "face",
    required: false,
    t2iClause: "Warm broad smile with teeth showing, joyful bright eyes looking at the camera.",
    kontextPrompt:
      "Make her smile warmly with teeth showing, bright joyful eyes looking at the camera.",
    frameFile: "anim-smile-0.webp",
  },
  {
    key: "annoyed",
    clipId: "annoyed",
    name: "Annoyed",
    group: "face",
    required: false,
    t2iClause:
      "Annoyed irritated expression, a slight frown, one eyebrow raised, lips pressed flat together, skeptical eyes looking at the camera.",
    kontextPrompt:
      "Give her an annoyed irritated look, a slight frown, one eyebrow raised, lips pressed flat, skeptical eyes.",
    frameFile: "anim-annoyed-0.webp",
  },
  {
    key: "angry",
    clipId: "angry",
    name: "Angry",
    group: "face",
    required: false,
    t2iClause:
      "Angry stern expression, furrowed brows, intense glare directly at the camera, lips pressed tightly together.",
    kontextPrompt:
      "Give her an angry stern expression, furrowed brows, an intense glare at the camera, lips pressed tightly together.",
    frameFile: "anim-angry-0.webp",
  },
  {
    key: "surprised",
    clipId: "surprised",
    name: "Surprised",
    group: "face",
    required: false,
    t2iClause:
      "Surprised astonished expression, eyebrows raised high, eyes wide open, lips softly parted.",
    kontextPrompt:
      "Make her look surprised and astonished, eyebrows raised high, eyes wide open, lips softly parted.",
    frameFile: "anim-surprised-0.webp",
  },
  {
    key: "laugh",
    clipId: "laugh",
    name: "Laugh",
    group: "face",
    required: false,
    t2iClause: "Laughing heartily, big open smile showing teeth, eyes crinkled with joy.",
    kontextPrompt:
      "Make her laugh heartily, a big open smile showing teeth, eyes crinkled with joy.",
    frameFile: "anim-laugh-0.webp",
  },
] as const;

/** The four always-generated core keys (m1/m2/m3 mouth + blink eyes). */
export const CORE_KEYS = ["m1", "m2", "m3", "blink"] as const;
/** Optional emotion keys (single-frame reaction clips). */
export const EMOTION_KEYS = ["think", "smile", "annoyed", "angry", "surprised", "laugh"] as const;

export function catalogEntry(key: string): CatalogExpression | undefined {
  return CATALOG.find((e) => e.key === key);
}

/** Public GET /faces/catalog projection — no internal clip templates or prompts. */
export function serializeCatalog(): FaceCatalogEntry[] {
  return CATALOG.map((e) => ({
    key: e.key,
    name: e.name,
    group: e.group,
    prompt: e.t2iClause,
    required: e.required,
  }));
}

/* ----------------------------- clip templates ----------------------------- */

const REACTION_DURATION: Record<string, number> = {
  think: 2200,
  smile: 2000,
  annoyed: 2000,
  angry: 2000,
  surprised: 1600,
  laugh: 2200,
};

function blinkClip(): AnimationClip {
  return {
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
}

function talkClip(): AnimationClip {
  return {
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
}

/** Single-frame reaction clip (emotion or custom). */
export function reactionClip(clipId: string, name: string, durationMs = 2000): AnimationClip {
  return {
    id: clipId,
    name,
    category: "reaction",
    appliesTo: "portrait",
    renderKind: "sprite",
    track: "main",
    frames: [`anim-${clipId}-0.webp`],
    driver: "time",
    durationMs,
    loopMode: "once",
    priority: 30,
  };
}

/* -------------------------------- triggers -------------------------------- */

/**
 * The eight proven Kiki triggers, filtered to the clips that were actually
 * built. `blink-auto` always survives (blink is always generated); emotion
 * triggers survive only when their clip is present.
 */
export function defaultTriggersFor(clipIds: ReadonlySet<string>): TriggerRule[] {
  const all: TriggerRule[] = [
    { id: "blink-auto", animationId: "blink", kind: "randomInterval", minMs: 2400, maxMs: 5200, enabled: true },
    { id: "think-on-thinking", animationId: "think", kind: "conversationEvent", event: "thinking", enabled: true },
    { id: "smile-greet", animationId: "smile", kind: "conversationEvent", event: "conversationStarted", enabled: true },
    {
      id: "smile-praise",
      animationId: "smile",
      kind: "textMatch",
      mode: "keywords",
      target: "assistant",
      patterns: ["great", "excellent", "well done", "perfect"],
      enabled: true,
    },
    {
      id: "laugh-on-humor",
      animationId: "laugh",
      kind: "textMatch",
      mode: "keywords",
      target: "assistant",
      patterns: ["haha", "funny", "hilarious"],
      enabled: true,
    },
    { id: "annoyed-manual", animationId: "annoyed", kind: "manual", enabled: true },
    { id: "angry-manual", animationId: "angry", kind: "manual", enabled: true },
    { id: "surprised-manual", animationId: "surprised", kind: "manual", enabled: true },
  ];
  return all.filter((t) => clipIds.has(t.animationId));
}

/* --------------------------- config assembly ------------------------------ */

export interface BuiltCustomExpression {
  clipId: string;
  name: string;
  durationMs?: number;
  /** Attach this trigger; a manual trigger is synthesized when omitted. */
  trigger?: TriggerRule;
}

export interface BuildGeneratedConfigArgs {
  presetId: string;
  name: string;
  accent: string;
  now: string;
  /** Chosen emotion catalog keys (core 4 are implicit). */
  emotions: string[];
  customs: BuiltCustomExpression[];
  generation: PresetGenerationMeta;
  hasFull?: boolean;
}

/**
 * Assemble the full AvatarConfig for a generated preset: blink + talk always,
 * one reaction clip per chosen emotion / custom expression, triggers filtered to
 * the built clips (+ a manual trigger for each custom), and the `generation`
 * provenance embedded for later add-expression jobs.
 */
export function buildGeneratedConfig(args: BuildGeneratedConfigArgs): AvatarConfig {
  const animations: AnimationClip[] = [blinkClip(), talkClip()];

  for (const key of args.emotions) {
    const entry = catalogEntry(key);
    if (!entry || entry.required) continue;
    animations.push(reactionClip(entry.clipId, entry.name, REACTION_DURATION[key] ?? 2000));
  }
  for (const c of args.customs) {
    animations.push(reactionClip(c.clipId, c.name, c.durationMs ?? 2000));
  }

  const clipIds = new Set(animations.map((c) => c.id));
  const triggers = defaultTriggersFor(clipIds);
  for (const c of args.customs) {
    triggers.push(
      c.trigger ?? { id: `${c.clipId}-manual`, animationId: c.clipId, kind: "manual", enabled: true },
    );
  }

  const config: AvatarConfig = {
    schemaVersion: 1,
    presetId: args.presetId,
    name: args.name,
    accent: args.accent,
    baseFrame: "portrait-base.webp",
    animations,
    triggers,
    generation: args.generation,
    createdAt: args.now,
    updatedAt: args.now,
  };
  if (args.hasFull) config.fullBase = "full.webp";
  return config;
}
