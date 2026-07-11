/**
 * Core-side mirror of the renderer contract in
 * `src/renderer/lib/coreClient.ts`. These types MUST stay in lock-step with
 * that file (the lead agent owns it); do not diverge.
 */

export type BuiltinPersonaId =
  | "staff-engineer"
  | "interviewer"
  | "teacher"
  | "architect";

/**
 * Persona id: a built-in or a stored custom persona ('persona-<slug>').
 * Unknown/deleted ids resolve to 'staff-engineer' server-side. (`string & {}`
 * keeps built-in autocomplete while accepting any custom id.)
 */
export type Persona = BuiltinPersonaId | (string & {});

/** Coaching stance — shapes the drafted blurb and is shown as a chip. */
export type PersonaStyle = "strict" | "balanced" | "supportive";

/**
 * One mentor persona. The blurb adjusts TONE only; core always appends the
 * teaching-ladder instructions for every persona — that posture is not
 * persona-configurable.
 */
export interface PersonaRecord {
  id: Persona;
  name: string;
  tagline: string;
  style: PersonaStyle;
  domains: string[];
  blurb: string;
  /** Built-ins are read-only: PATCH/DELETE → 403. */
  builtIn: boolean;
  /** Optional identity bundle applied to settings when this persona is activated. */
  mentorFace?: FacePresetId;
  ttsVoice?: string;
  createdAt?: string; // ISO, custom only
  updatedAt?: string; // ISO, custom only
}

/** Create/update payload for a custom persona (id/builtIn are server-owned). */
export type PersonaInput = Omit<
  PersonaRecord,
  "id" | "builtIn" | "createdAt" | "updatedAt"
>;

/** "Draft it for me": free-text description → model-drafted persona fields. */
export interface PersonaDraftRequest {
  description: string;
  name?: string;
  style?: PersonaStyle;
}
export type PersonaDraft = PersonaInput;

export type Segment = "prose" | "hint1" | "hint2" | "approach" | "solution";

export interface SegmentBlock {
  segment: Segment;
  content: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string; // ISO
  messageCount: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  persona?: Persona;
  createdAt: string; // ISO
  segments: SegmentBlock[];
  /** Set on assistant messages grounded on KB sources (Phase 4). */
  citations?: MessageCitation[];
}

export interface ModelStatus {
  state: "ready" | "ollama-offline" | "model-missing";
  model: string;
  /** Which provider the surface resolved to (absent = 'ollama', pre-slice shape). */
  provider?: "ollama" | "anthropic";
  /** Set when a cloud choice was silently downgraded to local (no key / cloud off). */
  fellBack?: boolean;
}

export type ChatPhase = "thinking" | "drafting" | "done" | "error" | "stopped";

/* ---------------- Memory (Phase 2) ---------------- */

export type MemoryType =
  | "identity"
  | "goal"
  | "skill"
  | "learning"
  | "project"
  | "career"
  | "preference"
  | "mistake"
  | "achievement"
  | "repo"
  | "meeting"
  | "book"
  | "research";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  confidence: number; // 0..1
  source: string;
  tags: string[];
  links: string[];
  createdAt: string;
  updatedAt: string;
  history: { at: string; body: string }[];
}

export interface SaveMemoryInput {
  type: MemoryType;
  body: string;
  title?: string;
  source: string;
  tags?: string[];
  confidence?: number;
}

export interface SaveMemoryResult {
  record: MemoryRecord;
  action: "created" | "merged";
  similarity?: number;
}

export interface RecallHit {
  record: MemoryRecord;
  score: number; // cosine similarity 0..1
}

export interface MemoryGraphData {
  nodes: { id: string; type: MemoryType; title: string; confidence: number }[];
  edges: { source: string; target: string }[];
}

export interface DerivedProfile {
  identity: { name: string; role: string } | null;
  goals: MemoryRecord[];
  strengths: MemoryRecord[];
  weaknesses: MemoryRecord[];
  stack: string[];
  reading: { title: string; percent: number | null; recordId: string }[];
  mistakes: {
    recordId: string;
    title: string;
    count: number;
    updatedAt: string;
  }[];
  counts: Partial<Record<MemoryType, number>>;
}

export type ImportSource = "interview-prep" | "3mc";

/* ---------------- Learning & Daily Loop (Phase 3) ---------------- */

export type TaskKind =
  | "leetcode"
  | "video"
  | "article"
  | "docs"
  | "book"
  | "hands-on"
  | "course"
  | "review"
  | "other";

export interface LearningTask {
  id: string;
  dayId: string;
  kind: TaskKind;
  title: string;
  url?: string;
  difficulty?: "Easy" | "Medium" | "Hard";
  done: boolean;
  completedAt?: string;
}

export interface LearningDay {
  id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  state: "locked" | "available" | "current" | "done";
  taskCount: number;
  doneCount: number;
}

export interface LearningWeek {
  phase: number;
  week: number;
  focus?: string;
  days: LearningDay[];
}

export interface LearningSummary {
  imported: boolean;
  totalDays: number;
  doneDays: number;
  totalTasks: number;
  doneTasks: number;
  currentDayId: string | null;
  xp: number;
  level: number;
}

export interface MissionItem {
  id: string;
  label: string;
  kind: TaskKind | "drill";
  reason: string;
  taskId?: string;
  url?: string;
  done: boolean;
}

export interface TodayMission {
  date: string; // YYYY-MM-DD
  items: MissionItem[];
  streak: { current: number; best: number };
}

export interface ReviewItem {
  memoryId: string;
  title: string;
  due: string;
  lastGrade: number | null;
}

export interface HeatCell {
  date: string;
  count: number;
}

/* ---------------- Knowledge Base (Phase 4) ---------------- */

export type KbKind = "pdf" | "md" | "txt" | "folder";

/** One ingested source (file or folder of files) in the personal KB (§4.7). */
export interface KbSource {
  id: string;
  kind: KbKind;
  title: string;
  /** Absolute path on disk at ingest time. */
  path: string;
  chunkCount: number;
  /** Files indexed (1 for single files, N for folders). */
  fileCount: number;
  indexedAt: string; // ISO
  tags: string[];
}

/**
 * One hybrid-search hit. `matched` tells the UI which legs found it — when
 * Ollama is down search degrades to FTS5-only and every hit is 'fts'.
 */
export interface KbSearchHit {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  kind: KbKind;
  /** Nearest markdown heading / PDF page marker, when known. */
  section?: string;
  snippet: string;
  /** Fused reciprocal-rank score, normalized 0..1 within the result set. */
  score: number;
  matched: "vector" | "fts" | "both";
}

/** A source MentorOS proactively offers to index (e.g. interview-prep playbooks). */
export interface KbSuggestedSource {
  path: string;
  title: string;
  kind: KbKind;
  tags: string[];
  /** Teaching transparency: why this is offered. */
  reason: string;
  /** True when already ingested (offer becomes "re-index"). */
  ingested: boolean;
}

/**
 * A numbered citation on a grounded assistant answer. `n` matches the `[n]`
 * markers in the answer text; persisted on the message so threads re-open with
 * their pills intact.
 */
export interface MessageCitation {
  n: number;
  sourceId: string;
  chunkId: string;
  title: string;
  snippet: string;
  score: number;
}

/* ---------------- Interview Platform (Phase 5) ---------------- */

export type InterviewType = "coding" | "system-design" | "sql" | "behavioral";
export type InterviewLanguage = "python" | "javascript";
export type InterviewPhase =
  | "framing"
  | "coding"
  | "interrogation"
  | "scorecard"
  | "abandoned";

export interface InterviewProblemMeta {
  id: string;
  lcNumber?: number;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  pattern: string;
  tags: string[];
  recommended?: boolean;
  recommendedReason?: string;
  lastScore?: number;
  /** True for user-imported problems (deletable, "custom" chip in the picker). */
  custom?: boolean;
}

export interface InterviewProblem extends InterviewProblemMeta {
  promptMd: string;
  functionName: string;
  starterCode: Record<InterviewLanguage, string>;
}

/* ---- problem importer (paste statement → LLM draft → review → save) ---- */

export interface ImportedTestDraft {
  name: string;
  args: unknown[];
  expected: unknown;
  normalize?: "sortInner" | "sortOuter" | null;
}

/**
 * Model-generated, user-editable pre-save problem. `referenceSolution` is only
 * for server-side test validation (sandboxed runner) — discarded on save,
 * never sent to a candidate session.
 */
export interface InterviewProblemDraft {
  title: string;
  lcNumber?: number;
  difficulty: "easy" | "medium" | "hard";
  pattern: string;
  tags: string[];
  functionName: string;
  promptMd: string;
  starterCode: Record<InterviewLanguage, string>;
  hints: [string, string, string];
  tests: ImportedTestDraft[];
  referenceSolution: string;
}

export interface DraftValidation {
  ok: boolean;
  tests: { name: string; passed: boolean; detail?: string }[];
  errors: string[];
}

export interface InterviewSession {
  id: string;
  type: InterviewType;
  problemId: string;
  language: InterviewLanguage;
  phase: InterviewPhase;
  hintsUsed: number;
  /** Latest code snapshot (persisted on every run/finish) — restores the editor on resume. */
  code?: string;
  startedAt: string;
  endedAt?: string;
}

export interface InterviewSessionSummary {
  id: string;
  type: InterviewType;
  problemTitle: string;
  pattern: string;
  phase: InterviewPhase;
  score?: number;
  startedAt: string;
}

export interface InterviewTurn {
  id: string;
  sessionId: string;
  role: "interviewer" | "candidate";
  kind: "chat" | "hint" | "phase";
  hintLevel?: 1 | 2 | 3;
  content: string;
  createdAt: string;
}

export interface EvalTestResult {
  name: string;
  passed: boolean;
  input: string;
  expected: string;
  actual?: string;
  stdout?: string;
  error?: string;
  timeMs: number;
}

export interface EvalResult {
  attemptId: string;
  passed: number;
  total: number;
  results: EvalTestResult[];
  compileError?: string;
  durationMs: number;
  ranAt: string;
}

export interface ScorecardDimension {
  name: string;
  verdict: "pass" | "warn" | "fail";
  note: string;
}

export interface InterviewScorecard {
  sessionId: string;
  score: number;
  bar: "L4" | "L5" | "L6";
  summary: string;
  biggestMistake: string;
  biggestTakeaway: string;
  pattern: string;
  patternConfidence: 1 | 2 | 3 | 4 | 5;
  dimensions: ScorecardDimension[];
  nextProblems: { title: string; reason: string }[];
  recallGrade: number;
  nextReviewDate: string;
  hintsUsed: number;
  testsPassed: number;
  testsTotal: number;
  durationSec: number;
  memoryWrites: {
    id: string;
    type: MemoryType;
    title: string;
    action: "created" | "merged";
  }[];
  createdAt: string;
}

/** STT/TTS sidecar readiness (mirror of coreClient VoiceStatus). */
export interface VoiceStatus {
  stt: "ready" | "missing" | "starting" | "error";
  tts: "ready" | "missing" | "starting" | "error";
  detail?: string;
}

/* --------------- Settings + voice options (mirror of coreClient) ---------- */

/** whisper.cpp model choices (quality vs latency ladder; small.en default). */
export type SttModelId = "small.en" | "medium.en" | "large-v3-turbo";

/* -------- Model switching (local Ollama + cloud Claude, §2.4 router) ------- */

export type ModelProvider = "ollama" | "anthropic";

/**
 * The app surfaces that generate with an LLM, each independently routable.
 * 'voice' is the Voice screen's spoken answers (rides POST /chat with
 * surface:'voice'); the memory merge-judge is deliberately NOT routable — it
 * stays local (cheap latency-sensitive classifier).
 */
export type ModelSurface = "chat" | "voice" | "interviewer" | "scorecard";

export interface ModelChoice {
  provider: ModelProvider;
  /** Ollama tag ('llama3.1:8b') or Anthropic model id ('claude-opus-4-8'). */
  model: string;
}

/** One installed Ollama model (from /api/tags). */
export interface LocalModelInfo {
  model: string;
  label: string;
  sizeBytes: number;
}

/** One entry of the static Claude catalog (core owns ids + pricing copy). */
export interface CloudModelInfo {
  model: string;
  label: string;
  /** USD per million tokens, for the picker's cost hint. */
  inputPerMTok: number;
  outputPerMTok: number;
  /** One-line positioning copy. */
  note: string;
  /** Server-recommended default cloud pick (Opus 4.8). */
  recommended?: boolean;
}

export type ApiKeyState = "none" | "valid" | "invalid";

/**
 * Provider availability for the Settings pickers. The key itself is never
 * returned — only a display mask ('sk-ant-…f3a2') and its validation state.
 */
export interface ProvidersInfo {
  ollama: {
    reachable: boolean;
    models: LocalModelInfo[];
    defaultModel: string;
  };
  anthropic: {
    keyState: ApiKeyState;
    keyMask?: string;
    /** Human reason when keyState is 'invalid' (auth failed, network…). */
    keyError?: string;
    catalog: CloudModelInfo[];
  };
}

/**
 * Face gallery preset ids — 'aura' is the minimal in-orb face; nova/ivy/rae are
 * stylized vector portraits; lena/sienna/kira are the realistic photo presets
 * (pre-generated stills with an animated lip-sync layer). Custom presets created
 * from the user's own photos use 'face-<slug>' ids; unknown/deleted ids fall
 * back to 'aura' on read.
 */
export type BuiltinFacePresetId =
  | "aura"
  | "nova"
  | "ivy"
  | "rae"
  | "lena"
  | "sienna"
  | "kira";
export type FacePresetId = BuiltinFacePresetId | (string & {});

/* ------------- Custom face presets (create from your own photos) ------------- */

/** Axis-aligned rectangle in ORIGINAL uploaded-portrait pixel space. */
export interface FaceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A user-created realistic preset. Same sprite contract as the built-in
 * realistic presets (base + 3 mouth apertures + blink). Art lives under userData
 * and is served by core; GET /faces/custom returns server-relative paths that
 * the client absolutizes.
 */
export interface CustomFacePreset {
  id: FacePresetId; // 'face-<slug>'
  name: string;
  /** Accent hex sampled from the portrait; tints the ambient aura. */
  accent: string;
  /** Legacy sprite block (thumbnails/back-compat); missing frames fall back to base. */
  portrait: {
    base: string;
    mouthSmall: string;
    mouthOpen: string;
    mouthWide: string;
    blink: string;
  };
  /** Present only when a full-body photo was provided. */
  full?: string;
  /** Generic animation config (synthesized for legacy rows — see faces/config.ts). */
  config: AvatarConfig;
  createdAt: string; // ISO
}

/* ----------------- Generic avatar animation system (v1) ------------------ */
/* Mirrors renderer/lib/coreClient.ts — that file owns the contract. */

export interface PoseChannels {
  aperture: number;
  browLift: number;
  furrow: number;
  smile: number;
  tilt: number;
  dy: number;
  /** 0 open → 1 closed. */
  blink: number;
}

export interface PoseKeyframe {
  at: number;
  pose: Partial<PoseChannels>;
}

export type AnimationDriver = "time" | "envelope";
export type AnimationLoopMode = "once" | "loop" | "pingpong" | "holdLast";
export type AnimationRegion = "portrait" | "full";
export type AnimationRenderKind = "sprite" | "procedural";
export type AnimationCategory = "reaction" | "gesture" | "expression" | "idle" | (string & {});

export interface AnimationClip {
  id: string;
  name: string;
  description?: string;
  category: AnimationCategory;
  appliesTo: AnimationRegion;
  renderKind: AnimationRenderKind;
  /** Concurrency lane ('eyes' | 'mouth' | 'main' | custom); queue/priority are per track. */
  track: string;
  frames?: string[];
  proceduralPose?: PoseKeyframe[];
  driver: AnimationDriver;
  fps?: number;
  durationMs?: number;
  loopMode: AnimationLoopMode;
  priority: number;
  tags?: string[];
  thumbnail?: string;
}

export type ConversationEvent =
  | "conversationStarted"
  | "conversationEnded"
  | "listening"
  | "thinking"
  | "speakingStarted"
  | "speakingEnded"
  | "idle"
  | "silenceTimeout";

export type TextMatchMode = "contains" | "regex" | "startsWith" | "endsWith" | "keywords";

interface TriggerBase {
  id: string;
  animationId: string;
  enabled: boolean;
}

export type TriggerRule =
  | (TriggerBase & { kind: "manual" })
  | (TriggerBase & { kind: "shortcut"; keys: string })
  | (TriggerBase & { kind: "api" })
  | (TriggerBase & {
      kind: "textMatch";
      mode: TextMatchMode;
      patterns: string[];
      target: "assistant" | "user";
      caseSensitive?: boolean;
    })
  | (TriggerBase & { kind: "conversationEvent"; event: ConversationEvent })
  | (TriggerBase & { kind: "everyNMessages"; n: number })
  | (TriggerBase & { kind: "timer"; intervalMs: number })
  | (TriggerBase & { kind: "randomInterval"; minMs: number; maxMs: number });

export interface AvatarConfig {
  schemaVersion: 1;
  presetId: string;
  name: string;
  accent: string;
  baseFrame: string;
  fullBase?: string;
  animations: AnimationClip[];
  triggers: TriggerRule[];
  defaultAnimationId?: string;
  /** Present on presets built by the Preset Generator — drives add-expression. */
  generation?: PresetGenerationMeta;
  createdAt: string;
  updatedAt: string;
}

/** How a group's region was resolved (composite window). */
export type RegionSource = "auto" | "manual" | "default";
export type ExpressionGroup = "mouth" | "eyes" | "face";
export type ExpressionGroupOrCustom = ExpressionGroup | "custom";

/**
 * Provenance a generated preset carries in its `config_json.generation` so the
 * user can add matching expressions later. Regions are in 1024² composite space.
 */
export interface PresetGenerationMeta {
  method: "z-turbo-t2i" | "kontext-photo";
  /** The shared character clause every t2i frame reuses (z-turbo-t2i only). */
  characterPrompt?: string;
  baseSeed: number;
  regions: { mouth: FaceRegion; eyes: FaceRegion; face: FaceRegion };
  regionSource: RegionSource;
  expressions: Array<{
    clipId: string;
    prompt: string;
    group: ExpressionGroupOrCustom;
    region?: FaceRegion;
    seed: number;
  }>;
}

/** One expression the generator should produce (catalog key OR custom fields). */
export interface GenerateExpressionSpec {
  /** A catalog key (m1/m2/m3/blink/think/…). Omit for a custom expression. */
  key?: string;
  /** Custom expression id slug (required when `key` is absent). */
  id?: string;
  name?: string;
  prompt?: string;
  group?: ExpressionGroupOrCustom;
  /** Composite window for a custom-group expression (1024² space). */
  region?: FaceRegion;
}

/** POST /faces/custom/generate — text-to-image preset generation. */
export interface GenerateFacePresetInput {
  name: string;
  characterPrompt: string;
  /** 1–16 expressions; the core 4 (m1/m2/m3/blink) are always included. */
  expressions: GenerateExpressionSpec[];
  /** Optional manual composite windows (1024² space); each overrides auto-detect. */
  regions?: { mouth?: FaceRegion; eyes?: FaceRegion; face?: FaceRegion };
  /** Base candidate from Image Lab history … */
  baseHistoryId?: string;
  /** … or a decoded webp/png data URI (exactly one of the two). */
  baseDataUri?: string;
  baseSeed?: number;
}

/** POST /faces/custom/:id/expressions — add or regenerate one expression. */
export interface AddFaceExpressionInput {
  key?: string;
  id?: string;
  name?: string;
  prompt?: string;
  group?: ExpressionGroupOrCustom;
  region?: FaceRegion;
  /** Optional trigger to attach to the new clip. */
  trigger?: TriggerRule;
  /** Overwrite this clip's frames (regenerate) instead of appending a new clip. */
  replaceClipId?: string;
}

/** One entry of GET /faces/catalog (proven prompts, internal templates hidden). */
export interface FaceCatalogEntry {
  key: string;
  name: string;
  group: ExpressionGroup;
  /** Default text-to-image clause the wizard prefills. */
  prompt: string;
  required: boolean;
}

/** Manual creation (Avatar Studio). Frames are webp data URIs, client-encoded. */
export interface CreateManualFacePresetInput {
  name: string;
  accent: string;
  baseFrame: string;
  fullBase?: string;
  animations: AnimationClip[];
  triggers: TriggerRule[];
  defaultAnimationId?: string;
}

/** Editor save. Frame entries = existing art file names or webp data URIs. */
export interface UpdateAvatarConfigInput {
  name?: string;
  accent?: string;
  animations: AnimationClip[];
  triggers: TriggerRule[];
  defaultAnimationId?: string;
}

/** Whether the local mflux/FLUX-Kontext image-gen toolchain is usable. */
export interface FaceToolchainStatus {
  state: "ready" | "missing";
  /** Human reason when missing ('mflux not installed', 'Kontext weights absent'). */
  detail?: string;
}

export interface CreateFacePresetInput {
  name: string;
  /** Absolute path of the portrait photo (frontal, mouth CLOSED, ≥768px short side). */
  portraitPath: string;
  /** Optional full-body still (head-to-shoes). */
  fullPath?: string;
  /** Mouth/eyes rectangles from the region picker — the composite windows. */
  mouth: FaceRegion;
  eyes: FaceRegion;
}

/**
 * One preset generation = 4 Kontext edits (m2 → m1-from-m2 → m3 → blink) +
 * anti-drift compositing; the job runs in the background, survives navigation,
 * resumes skip-if-exists after a restart, and streams progress via `face.job`.
 */
export interface FaceJobStatus {
  jobId: string;
  presetId: string;
  name: string;
  /** Which pipeline produced this job (photo Kontext, t2i generate, add-expression). */
  kind: "photo" | "generate" | "expression";
  state: "queued" | "generating" | "compositing" | "done" | "error" | "cancelled";
  /** Human step ('Mouth frame 2 of 3', 'Compositing blink'). */
  step: string;
  completedFrames: number;
  totalFrames: number;
  startedAt: string; // ISO
  error?: string;
}
/** Styling intensity applied to portrait presets. */
export type FaceGlam = "natural" | "polished" | "glam";
/** Apparent maturity applied to portrait presets (all adult). */
export type FaceMaturity = "youthful" | "balanced" | "mature";
/** Portrait framing on the Voice screen: face cameo or full-body. */
export type FaceView = "cameo" | "full";

export interface AppSettings {
  /** Kokoro voice id, e.g. 'af_heart'. Applies to the next utterance. */
  ttsVoice: string;
  /** STT model; must be downloaded (state 'ready') before it takes effect. */
  sttModel: SttModelId;
  /** Mentor identity on the Voice screen: shader Orb or the animated face. */
  mentorIdentity: "orb" | "face";
  /** Which face preset the 'face' identity wears. */
  mentorFace: FacePresetId;
  /** Styling intensity for portrait faces (ignored by 'aura'). */
  faceGlam: FaceGlam;
  /** Apparent maturity for portrait faces (ignored by 'aura'). */
  faceMaturity: FaceMaturity;
  /** Portrait framing: face cameo or full-body (ignored by 'aura'). */
  faceView: FaceView;
  /**
   * Default persona for new chat threads and the Voice screen. Setting it to a
   * persona that bundles mentorFace/ttsVoice also applies those fields (core
   * merges them into the same settings write → one settings.changed event).
   * Deleting the active custom persona resets this to 'staff-engineer'.
   */
  activePersona: Persona;
  /**
   * Master cloud opt-in (§2.4: cloud is an accelerator, never a dependency).
   * While false, cloud choices below are inert and every surface resolves local.
   */
  cloudEnabled: boolean;
  /**
   * Per-surface model routing. A cloud choice only takes effect while
   * cloudEnabled and a valid Anthropic key are present; otherwise the router
   * silently falls back to the local default (no broken surfaces, ever).
   */
  models: Record<ModelSurface, ModelChoice>;
}

export interface TtsVoiceInfo {
  /** Kokoro id ('af_heart'); prefix encodes accent+gender (a/b × f/m). */
  id: string;
  /** Display name ('Heart'). */
  label: string;
  accent: "american" | "british";
  gender: "female" | "male";
}

export interface SttModelInfo {
  id: SttModelId;
  label: string;
  sizeBytes: number;
  /** One-line quality/latency tradeoff copy for the picker. */
  note: string;
  state: "ready" | "missing" | "downloading";
  /** True when this is the model STT currently uses (settings + downloaded). */
  active: boolean;
}

/* ------------------------------ Image Lab -------------------------------- */

/**
 * One selectable text-to-image backend (GET /imagegen/models). `available`
 * gates the picker; `detail` explains a not-yet-usable model (missing binary,
 * absent key, first-run weights download). Local models shell out to mflux
 * under ~/mentoros-imagegen; hosted models call fal.ai with the stored key.
 */
export interface ImageGenModelInfo {
  id: string;
  label: string;
  kind: "local" | "hosted";
  /** One-line positioning copy for the picker. */
  desc: string;
  /** Edit models (FLUX-Kontext) need a reference image supplied. */
  requiresReference?: boolean;
  defaultSteps: number;
  maxSteps: number;
  available: boolean;
  /** Human reason when unavailable, or a heads-up ('weights download on first run'). */
  detail?: string;
}

/**
 * A single generation request. `randomizeSeed` (or an absent `seed`) makes core
 * pick a uint32 itself, so `seedUsed` is always known and reproducible.
 * `referenceDataUri` (a `data:image/...;base64,...` URI) is required only by
 * edit models (requiresReference).
 */
export interface ImageGenRequest {
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed?: number;
  randomizeSeed: boolean;
  referenceDataUri?: string;
}

/** The finished artifact of a generation job (persisted in history). */
export interface ImageGenJobResult {
  historyId: string;
  /** Server-relative art URL (`/imagegen/art/<file>`); the client absolutizes it. */
  url: string;
  seedUsed: number;
  elapsedMs: number;
}

/**
 * Generation lifecycle. Single-flight (one job monopolizes the GPU / fal call).
 * `progressText` streams the model's stdout lines; a cancelled job ends 'error'
 * with error 'cancelled'.
 */
export interface ImageGenJobStatus {
  id: string;
  state: "queued" | "running" | "done" | "error";
  progressText?: string;
  error?: string;
  result?: ImageGenJobResult;
}

/** One persisted generation (GET /imagegen/history, newest-first). */
export interface ImageGenHistoryItem {
  id: string;
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  /** Server-relative art URL; the client absolutizes it. */
  url: string;
  createdAt: string; // ISO
}

/** Payload shapes broadcast over the /events websocket. */
export interface CoreEvents {
  "core.status": { state: "starting" | "ready" | "degraded"; detail?: string };
  "chat.token": {
    messageId: string;
    threadId: string;
    segment: Segment;
    token: string;
  };
  "chat.status": {
    messageId: string;
    threadId: string;
    phase: ChatPhase;
    error?: string;
  };
  "models.pull": {
    model: string;
    completedBytes: number;
    totalBytes: number;
    done: boolean;
    error?: string;
  };
  "voice.install": {
    step: string;
    completedBytes: number;
    totalBytes: number;
    done: boolean;
    error?: string;
  };
  "voice.status": VoiceStatus;
  /** STT model download progress (voice quality option in Settings). */
  "voice.model": {
    model: SttModelId;
    completedBytes: number;
    totalBytes: number;
    done: boolean;
    error?: string;
  };
  /** Settings changed (any writer) — screens re-read what they care about. */
  "settings.changed": { settings: AppSettings };
  /** Persona list changed (create/update/delete) — pickers re-fetch. */
  "personas.changed": { personas: PersonaRecord[] };
  /** Custom-face generation progress (long job — drives the Settings progress card). */
  "face.job": FaceJobStatus;
  /** Custom preset list changed (job finished / preset deleted). */
  "faces.changed": { presets: CustomFacePreset[] };
  "voice.ptt": { pressed: boolean };
  /** A memory was created or merged — drives "Profile updated" moments. */
  "memory.saved": {
    record: MemoryRecord;
    action: "created" | "merged";
    similarity?: number;
  };
  /** What recall injected into a generation — feeds the Context panel (§4.2). */
  "chat.context": {
    threadId: string;
    messageId: string;
    memories: { id: string; type: MemoryType; title: string; score: number }[];
  };
  /** Importer progress. */
  "import.progress": {
    source: ImportSource;
    step: string;
    created: number;
    merged: number;
    done: boolean;
    error?: string;
  };
  /** After any task/mission completion — keeps Home/Learning live. */
  "learning.progress": { summary: LearningSummary };
  "mission.updated": { mission: TodayMission };
  /** Ingest progress for one source (drives the drag-drop progress toast). */
  "kb.ingest": {
    /** Set once the source row exists. */
    sourceId?: string;
    path: string;
    step: "reading" | "chunking" | "embedding" | "indexing" | "done" | "error";
    /** For folders: which file of how many. */
    fileIndex?: number;
    fileCount?: number;
    chunksDone: number;
    chunksTotal: number;
    done: boolean;
    error?: string;
  };
  /** A source was added/updated/removed — KB library refetches its grid. */
  "kb.updated": { sources: KbSource[] };
  /**
   * KB chunks injected into a generation — mirrors `chat.context` and feeds the
   * "Sources cited" panel + the numbered pills under the answer.
   */
  "chat.sources": {
    threadId: string;
    messageId: string;
    citations: MessageCitation[];
  };
  /** One streamed token of an in-flight interviewer turn. */
  "interview.token": { sessionId: string; turnId: string; token: string };
  /** Interviewer-turn lifecycle — same phases as chat.status. */
  "interview.status": {
    sessionId: string;
    turnId: string;
    phase: ChatPhase;
    error?: string;
  };
  /** Session moved to a new protocol phase. */
  "interview.phase": { sessionId: string; phase: InterviewPhase };
  /** Scorecard ready (endInterview is async — LLM grading takes seconds). */
  "interview.scorecard": {
    sessionId: string;
    scorecard: InterviewScorecard;
  };
}
