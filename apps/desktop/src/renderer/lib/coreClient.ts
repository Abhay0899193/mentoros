/**
 * coreClient — the single typed seam between the renderer and the core server.
 *
 * OWNED BY THE LEAD AGENT: this file defines the frontend↔core contract.
 * No `electron` import is permitted in the renderer; the client speaks plain
 * HTTP/WS so the same code runs in the desktop shell today and a browser or
 * mobile shell later (plan.md §2.2). Core implements the mirror of these
 * routes/events in src/core — implement against this file, do not redesign it.
 */

const DEFAULT_CORE_PORT = 4820;
const RECONNECT_DELAY_MS = 1000;

export interface CoreHealth {
  ok: true;
  version: string;
  uptimeMs: number;
}

/* ---------------- Chat (Stage 1b) ---------------- */

export type BuiltinPersonaId = 'staff-engineer' | 'interviewer' | 'teacher' | 'architect';
/**
 * Persona id: a built-in or a stored custom persona ('persona-<slug>').
 * Unknown/deleted ids resolve to 'staff-engineer' server-side — a stale chip
 * never breaks generation. (`string & {}` keeps built-in autocomplete.)
 */
export type Persona = BuiltinPersonaId | (string & {});

/** Coaching stance — shapes the drafted blurb and is shown as a chip. */
export type PersonaStyle = 'strict' | 'balanced' | 'supportive';

/**
 * One mentor persona. The blurb adjusts TONE only; core always appends the
 * teaching-ladder instructions (hints before solution) for every persona —
 * that posture is the product and is not persona-configurable. The strict
 * interview-session interviewer is likewise NOT persona-swappable.
 */
export interface PersonaRecord {
  id: Persona;
  /** Display name ('Staff Engineer', 'Priya — FAANG Staff'). */
  name: string;
  /** One-line role summary under the name in pickers. */
  tagline: string;
  style: PersonaStyle;
  /** Focus areas rendered as chips ('distributed systems', 'DP'). */
  domains: string[];
  /** The system-prompt tone paragraph (2nd person, ≤120 words). */
  blurb: string;
  /** Built-ins are read-only: PATCH/DELETE → 403. */
  builtIn: boolean;
  /** Optional identity bundle applied to settings when this persona is activated. */
  mentorFace?: FacePresetId;
  /** Kokoro voice id applied on activation (e.g. 'bf_emma'). */
  ttsVoice?: string;
  createdAt?: string; // ISO, custom only
  updatedAt?: string; // ISO, custom only
}

/** Create/update payload for a custom persona (id/builtIn are server-owned). */
export type PersonaInput = Omit<PersonaRecord, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>;

/**
 * "Draft it for me": a short free-text description → model-drafted persona
 * fields for the create form (user reviews/edits before saving). Runs on the
 * scorecard routing surface (cloud-capable, local fallback); generation
 * failure → 502 with a designed body, like the interview importer.
 */
export interface PersonaDraftRequest {
  description: string;
  /** Optional user-fixed fields the draft must respect. */
  name?: string;
  style?: PersonaStyle;
}
export type PersonaDraft = PersonaInput;

/**
 * Teaching posture (§3.0.6): assistant answers stream as typed segments so the
 * UI can gate them behind the disclosure ladder. Core parses the model output
 * into segments; the renderer never sees raw section markers.
 */
export type Segment = 'prose' | 'hint1' | 'hint2' | 'approach' | 'solution';

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
  role: 'user' | 'assistant';
  persona?: Persona;
  createdAt: string; // ISO
  segments: SegmentBlock[];
  /** Set on assistant messages grounded on KB sources (Phase 4). */
  citations?: MessageCitation[];
}

export interface ModelStatus {
  state: 'ready' | 'ollama-offline' | 'model-missing';
  model: string;
  /** Which provider the surface resolved to (absent = 'ollama', pre-slice shape). */
  provider?: 'ollama' | 'anthropic';
  /** Set when a cloud choice was silently downgraded to local (no key / cloud off). */
  fellBack?: boolean;
}

export type ChatPhase = 'thinking' | 'drafting' | 'done' | 'error' | 'stopped';

/* ---------------- Memory (Phase 2) ---------------- */

export type MemoryType =
  | 'identity'
  | 'goal'
  | 'skill'
  | 'learning'
  | 'project'
  | 'career'
  | 'preference'
  | 'mistake'
  | 'achievement'
  | 'repo'
  | 'meeting'
  | 'book'
  | 'research';

/**
 * One evolving fact — never a chat fragment (§2.3). Repeating a fact merges
 * into the same record via upsert-by-similarity (embed → nearest same-type →
 * cosine ≥ threshold ⇒ merge: newest body wins, old body appends to history,
 * confidence nudges up, id is stable).
 */
export interface MemoryRecord {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  confidence: number; // 0..1
  /** 'chat' | 'voice' | 'manual' | 'import:interview-prep' | 'import:3mc' */
  source: string;
  tags: string[];
  /** Related memory ids (graph edges). */
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
  action: 'created' | 'merged';
  similarity?: number; // set when merged
}

export interface RecallHit {
  record: MemoryRecord;
  score: number; // cosine similarity 0..1
}

export interface MemoryGraphData {
  nodes: { id: string; type: MemoryType; title: string; confidence: number }[];
  edges: { source: string; target: string }[];
}

/** Derived views over records (§2.3) — computed by core, never stored. */
export interface DerivedProfile {
  identity: { name: string; role: string } | null;
  goals: MemoryRecord[];
  strengths: MemoryRecord[];
  weaknesses: MemoryRecord[];
  stack: string[];
  reading: { title: string; percent: number | null; recordId: string }[];
  /** Mistake tally, most frequent first (count parsed from tags/body). */
  mistakes: { recordId: string; title: string; count: number; updatedAt: string }[];
  counts: Partial<Record<MemoryType, number>>;
}

export type ImportSource = 'interview-prep' | '3mc';

/* ---------------- Learning & Daily Loop (Phase 3) ---------------- */

export type TaskKind =
  | 'leetcode'
  | 'video'
  | 'article'
  | 'docs'
  | 'book'
  | 'hands-on'
  | 'course'
  | 'review'
  | 'other';

export interface LearningTask {
  id: string; // stable id from the 3mc parser (phase-n-week-w-day-d-…)
  dayId: string;
  kind: TaskKind;
  title: string;
  url?: string;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  done: boolean;
  completedAt?: string;
}

export interface LearningDay {
  id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  state: 'locked' | 'available' | 'current' | 'done';
  taskCount: number;
  doneCount: number;
}

export interface LearningWeek {
  phase: number;
  week: number;
  /** Week topic from the plan, e.g. "Arrays, Strings, Two Pointers + Docker Basics". */
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
  kind: TaskKind | 'drill';
  /** Teaching transparency: why this item — "from your plan, week 12" / "weakness: DP ×8". */
  reason: string;
  taskId?: string;
  url?: string;
  done: boolean;
}

/** Right-sized daily selection (4–5 items) — never the raw firehose of the plan. */
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

export type KbKind = 'pdf' | 'md' | 'txt' | 'folder';

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
 * One hybrid-search hit. `matched` tells the UI which legs found it —
 * when Ollama is down search degrades to FTS5-only and every hit is 'fts'.
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
  matched: 'vector' | 'fts' | 'both';
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
 * markers in the answer text; persisted on the message so threads re-open
 * with their pills intact.
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

export type InterviewType = 'coding' | 'system-design' | 'sql' | 'behavioral';
export type InterviewLanguage = 'python' | 'javascript';
/**
 * Session lifecycle mirrors the interview-prep protocol:
 * framing (§0 Frame) → coding → interrogation (§3.1, after "I'm done") →
 * scorecard (§3.6, terminal) — or abandoned.
 */
export type InterviewPhase = 'framing' | 'coding' | 'interrogation' | 'scorecard' | 'abandoned';

export interface InterviewProblemMeta {
  id: string;
  /** LeetCode number when the problem maps to one (drives "LC 33" chips). */
  lcNumber?: number;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** interview-prep pattern slug, e.g. 'sliding-window'. */
  pattern: string;
  tags: string[];
  /** True when weakness-targeting (recurring-mistake memories) picked this one. */
  recommended?: boolean;
  /** Why it was recommended, e.g. "targets: Complexity miscalculation ×8". */
  recommendedReason?: string;
  /** Best score from past sessions on this problem, if any. */
  lastScore?: number;
  /** True for user-imported problems (deletable, "custom" chip in the picker). */
  custom?: boolean;
}

export interface InterviewProblem extends InterviewProblemMeta {
  /** Full statement: constraints + worked examples, markdown. */
  promptMd: string;
  functionName: string;
  starterCode: Record<InterviewLanguage, string>;
}

/* ---- problem importer (paste statement → LLM draft → review → save) ---- */

export interface ImportedTestDraft {
  name: string;
  /** Positional args spread into the candidate's function. JSON-only values. */
  args: unknown[];
  expected: unknown;
  /** Order-insensitive compare: sort inner array / outer array of arrays. */
  normalize?: 'sortInner' | 'sortOuter' | null;
}

/**
 * Everything needed to become a bank problem, as generated by the model and
 * edited by the user in the review step. `referenceSolution` exists only to
 * validate the tests server-side (executed via the sandboxed runner) and is
 * discarded on save — it must never reach the candidate UI during a session.
 */
export interface InterviewProblemDraft {
  title: string;
  lcNumber?: number;
  difficulty: 'easy' | 'medium' | 'hard';
  pattern: string;
  tags: string[];
  functionName: string;
  promptMd: string;
  starterCode: Record<InterviewLanguage, string>;
  hints: [string, string, string];
  tests: ImportedTestDraft[];
  /** Python reference implementation used to verify `tests` expectations. */
  referenceSolution: string;
}

export interface DraftValidation {
  /** True when the shape is sound and the reference solution passes every test. */
  ok: boolean;
  /** Per-test verdict from executing referenceSolution through the runner. */
  tests: { name: string; passed: boolean; detail?: string }[];
  /** Shape/consistency problems (missing fields, bad function name, …). */
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
  role: 'interviewer' | 'candidate';
  /** 'hint' turns carry hintLevel; 'phase' turns are system notes ("Moving to interrogation"). */
  kind: 'chat' | 'hint' | 'phase';
  hintLevel?: 1 | 2 | 3;
  content: string;
  createdAt: string;
}

export interface EvalTestResult {
  name: string;
  passed: boolean;
  /** Pretty-printed call, e.g. "twoSum([2,7,11,15], 9)". */
  input: string;
  expected: string;
  actual?: string;
  stdout?: string;
  /** Runtime error / traceback for this test. */
  error?: string;
  timeMs: number;
}

export interface EvalResult {
  attemptId: string;
  passed: number;
  total: number;
  results: EvalTestResult[];
  /** Syntax/compile-stage failure — no tests ran. */
  compileError?: string;
  durationMs: number;
  ranAt: string;
}

export interface ScorecardDimension {
  name: string;
  verdict: 'pass' | 'warn' | 'fail';
  note: string;
}

/** §3.6 scorecard. Persists with the session; memoryWrites is the visible "Profile updated" proof. */
export interface InterviewScorecard {
  sessionId: string;
  /** 0–10, calibrated to `bar`. */
  score: number;
  bar: 'L4' | 'L5' | 'L6';
  summary: string;
  biggestMistake: string;
  biggestTakeaway: string;
  pattern: string;
  patternConfidence: 1 | 2 | 3 | 4 | 5;
  dimensions: ScorecardDimension[];
  nextProblems: { title: string; reason: string }[];
  /** Spaced-repetition grade 0–5 → absolute ISO next-review date (§5 intervals). */
  recallGrade: number;
  nextReviewDate: string;
  hintsUsed: number;
  testsPassed: number;
  testsTotal: number;
  durationSec: number;
  memoryWrites: { id: string; type: MemoryType; title: string; action: 'created' | 'merged' }[];
  createdAt: string;
}

/* ---------------- Voice (Stage 1c) ---------------- */

export interface VoiceStatus {
  stt: 'ready' | 'missing' | 'starting' | 'error';
  tts: 'ready' | 'missing' | 'starting' | 'error';
  detail?: string;
}

/**
 * /voice WebSocket protocol (core implements the mirror):
 *  client→server  JSON  {type:'mic-start', sampleRate:16000}
 *  client→server  binary PCM16 mono chunks (mic, 16 kHz)
 *  client→server  JSON  {type:'mic-stop'} | {type:'tts-stop'}
 *  server→client  JSON  {type:'transcript', text, final}
 *  server→client  JSON  {type:'tts-start', sampleRate} → binary PCM16 chunks → {type:'tts-end'}
 *  server→client  JSON  {type:'voice-error', message}
 */
export interface VoiceChannelHandlers {
  onTranscript: (t: { text: string; final: boolean }) => void;
  onTtsStart: (sampleRate: number) => void;
  onTtsChunk: (pcm: ArrayBuffer) => void;
  onTtsEnd: () => void;
  onError: (message: string) => void;
}

export interface VoiceChannel {
  micStart: (sampleRate: number) => void;
  sendPcm: (chunk: ArrayBuffer) => void;
  micStop: () => void;
  stopTts: () => void;
  close: () => void;
}

/* ---------------- Settings + voice options (Phase-1 feedback slice) ---------------- */

/** whisper.cpp model choices (quality vs latency ladder; small.en is the shipped default). */
export type SttModelId = 'small.en' | 'medium.en' | 'large-v3-turbo';

/* ---------------- Model switching (local Ollama + cloud Claude, §2.4 router) ---------------- */

export type ModelProvider = 'ollama' | 'anthropic';

/**
 * The app surfaces that generate with an LLM, each independently routable.
 * 'voice' is the Voice screen's spoken answers (rides POST /chat with
 * surface:'voice'); the memory merge-judge is deliberately NOT routable — it
 * stays on the local model (cheap latency-sensitive classifier).
 */
export type ModelSurface = 'chat' | 'voice' | 'interviewer' | 'scorecard';

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
  /** One-line positioning copy ('Most capable — deep reviews', …). */
  note: string;
  /** Server-recommended default cloud pick (Opus 4.8). */
  recommended?: boolean;
}

export type ApiKeyState = 'none' | 'valid' | 'invalid';

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
 * (pre-generated stills with an animated lip-sync layer). Custom presets
 * created from the user's own photos use 'face-<slug>' ids; unknown/deleted
 * ids fall back to 'aura' on read.
 */
export type BuiltinFacePresetId = 'aura' | 'nova' | 'ivy' | 'rae' | 'lena' | 'sienna' | 'kira';
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
 * realistic presets (base + 3 mouth apertures + blink, pixel-aligned full
 * frames); art lives under userData and is served by core — the client
 * returns absolute URLs ready for <img src>.
 */
export interface CustomFacePreset {
  id: FacePresetId; // 'face-<slug>'
  name: string;
  /** Accent hex sampled from the portrait; tints the ambient aura. */
  accent: string;
  portrait: {
    base: string;
    mouthSmall: string;
    mouthOpen: string;
    mouthWide: string;
    blink: string;
  };
  /** Present only when a full-body photo was provided. */
  full?: string;
  createdAt: string; // ISO
}

/**
 * Generation shells out to the local mflux/FLUX-Kontext toolchain kept at
 * ~/mentoros-imagegen. 'missing' → Settings shows a designed setup state
 * instead of the create flow.
 */
export interface FaceToolchainStatus {
  state: 'ready' | 'missing';
  /** Human reason when missing ('mflux not installed', 'Kontext weights absent'). */
  detail?: string;
}

export interface CreateFacePresetInput {
  name: string;
  /** Absolute path of the portrait photo (native file bridge). Frontal, mouth CLOSED, ≥768px short side. */
  portraitPath: string;
  /** Optional full-body still (head-to-shoes). */
  fullPath?: string;
  /** Mouth/eyes rectangles from the region picker — the composite windows. */
  mouth: FaceRegion;
  eyes: FaceRegion;
}

/**
 * One preset generation = 4 Kontext edits (m2 → m1-derived-from-m2 → m3 →
 * blink) + anti-drift compositing; ~10-15 min per edit on the local GPU, so
 * the job runs in the background, survives navigation, resumes skip-if-exists
 * after an app restart, and streams progress via the `face.job` event.
 */
export interface FaceJobStatus {
  jobId: string;
  presetId: string;
  name: string;
  state: 'queued' | 'generating' | 'compositing' | 'done' | 'error' | 'cancelled';
  /** Human step ('Mouth frame 2 of 3', 'Compositing blink'). */
  step: string;
  completedFrames: number;
  totalFrames: number;
  startedAt: string; // ISO
  error?: string;
}
/** Styling intensity applied to portrait presets. */
export type FaceGlam = 'natural' | 'polished' | 'glam';
/** Apparent maturity applied to portrait presets (all adult). */
export type FaceMaturity = 'youthful' | 'balanced' | 'mature';
/** Portrait framing on the Voice screen: face cameo or full-body. */
export type FaceView = 'cameo' | 'full';

export interface AppSettings {
  /** Kokoro voice id, e.g. 'af_heart'. Applies to the next utterance. */
  ttsVoice: string;
  /** STT model; must be downloaded (state 'ready') before it takes effect. */
  sttModel: SttModelId;
  /** Mentor identity on the Voice screen: shader Orb or the animated face. */
  mentorIdentity: 'orb' | 'face';
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
  accent: 'american' | 'british';
  gender: 'female' | 'male';
}

export interface SttModelInfo {
  id: SttModelId;
  label: string;
  sizeBytes: number;
  /** One-line quality/latency tradeoff copy for the picker. */
  note: string;
  state: 'ready' | 'missing' | 'downloading';
  /** True when this is the model STT currently uses (settings + downloaded). */
  active: boolean;
}

export interface CoreEvents {
  'core.status': { state: 'starting' | 'ready' | 'degraded'; detail?: string };
  /** One streamed token for an in-flight assistant message. */
  'chat.token': { messageId: string; threadId: string; segment: Segment; token: string };
  /** Generation lifecycle. `thinking` = request sent, `drafting` = first token seen. */
  'chat.status': { messageId: string; threadId: string; phase: ChatPhase; error?: string };
  /** Model pull progress (for the "model not pulled" degraded state). */
  'models.pull': {
    model: string;
    completedBytes: number;
    totalBytes: number;
    done: boolean;
    error?: string;
  };
  /** STT/TTS install progress (binaries + models). */
  'voice.install': {
    step: string;
    completedBytes: number;
    totalBytes: number;
    done: boolean;
    error?: string;
  };
  /** Sidecar readiness changes. */
  'voice.status': VoiceStatus;
  /** STT model download progress (voice quality option in Settings). */
  'voice.model': {
    model: SttModelId;
    completedBytes: number;
    totalBytes: number;
    done: boolean;
    error?: string;
  };
  /** Settings changed (any writer) — screens re-read what they care about. */
  'settings.changed': { settings: AppSettings };
  /** Persona list changed (create/update/delete) — pickers re-fetch. */
  'personas.changed': { personas: PersonaRecord[] };
  /** Custom-face generation progress (long job — drives the Settings progress card). */
  'face.job': FaceJobStatus;
  /** Custom preset list changed (job finished / preset deleted). */
  'faces.changed': { presets: CustomFacePreset[] };
  /** Global push-to-talk hotkey (from Electron main via core). */
  'voice.ptt': { pressed: boolean };
  /** A memory was created or merged — drives "Profile updated" moments. */
  'memory.saved': { record: MemoryRecord; action: 'created' | 'merged'; similarity?: number };
  /** What recall injected into a generation — feeds the Context panel (§4.2). */
  'chat.context': {
    threadId: string;
    messageId: string;
    memories: { id: string; type: MemoryType; title: string; score: number }[];
  };
  /** Importer progress. */
  'import.progress': {
    source: ImportSource;
    step: string;
    created: number;
    merged: number;
    done: boolean;
    error?: string;
  };
  /** After any task/mission completion — keeps Home/Learning live. */
  'learning.progress': { summary: LearningSummary };
  'mission.updated': { mission: TodayMission };
  /** Ingest progress for one source (drives the drag-drop progress toast). */
  'kb.ingest': {
    /** Set once the source row exists. */
    sourceId?: string;
    path: string;
    step: 'reading' | 'chunking' | 'embedding' | 'indexing' | 'done' | 'error';
    /** For folders: which file of how many. */
    fileIndex?: number;
    fileCount?: number;
    chunksDone: number;
    chunksTotal: number;
    done: boolean;
    error?: string;
  };
  /** A source was added/updated/removed — KB library refetches its grid. */
  'kb.updated': { sources: KbSource[] };
  /**
   * KB chunks injected into a generation — mirrors `chat.context` and feeds
   * the "Sources cited" panel + the numbered pills under the answer.
   */
  'chat.sources': {
    threadId: string;
    messageId: string;
    citations: MessageCitation[];
  };
  /** One streamed token of an in-flight interviewer turn. */
  'interview.token': { sessionId: string; turnId: string; token: string };
  /** Interviewer-turn lifecycle — same phases as chat.status. */
  'interview.status': { sessionId: string; turnId: string; phase: ChatPhase; error?: string };
  /** Session moved to a new protocol phase (framing → coding → interrogation → scorecard). */
  'interview.phase': { sessionId: string; phase: InterviewPhase };
  /**
   * Scorecard ready (endInterview is async — LLM grading takes seconds).
   * memoryWrites inside drive the "Profile updated" moment.
   */
  'interview.scorecard': { sessionId: string; scorecard: InterviewScorecard };
}

export interface CoreClient {
  readonly baseUrl: string;
  health(): Promise<CoreHealth>;
  on<E extends keyof CoreEvents>(event: E, cb: (payload: CoreEvents[E]) => void): () => void;

  /* chat */
  listThreads(): Promise<ThreadSummary[]>;
  createThread(title?: string): Promise<ThreadSummary>;
  deleteThread(threadId: string): Promise<void>;
  getMessages(threadId: string): Promise<ChatMessage[]>;
  /**
   * Persists the user message and starts generation. Resolves immediately with
   * both message ids; tokens arrive via `chat.token` / `chat.status` events.
   */
  sendMessage(
    threadId: string,
    content: string,
    persona: Persona,
    /** Which routing surface is asking ('voice' from the Voice screen). Default 'chat'. */
    surface?: Extract<ModelSurface, 'chat' | 'voice'>,
  ): Promise<{ userMessageId: string; assistantMessageId: string }>;
  stopGeneration(messageId: string): Promise<void>;
  /** Pre-flight for the model a surface currently resolves to (default 'chat'). */
  modelStatus(surface?: ModelSurface): Promise<ModelStatus>;
  /** Starts a pull of the default (or given) model; progress via `models.pull`. */
  pullModel(model?: string): Promise<void>;

  /* model providers (Settings → Models) */
  /** Availability + catalogs for both providers; key returned masked only. */
  listProviders(): Promise<ProvidersInfo>;
  /**
   * Store + live-validate the Anthropic API key (a cheap authenticated call).
   * Resolves with the resulting state; 'invalid' keys are still stored so the
   * user can see/fix them, but the router treats them as absent.
   */
  setAnthropicKey(apiKey: string): Promise<{ keyState: ApiKeyState; keyMask?: string; keyError?: string }>;
  /** Forget the stored key; cloud choices fall back to local immediately. */
  clearAnthropicKey(): Promise<void>;

  /* personas (Settings → Personas + chat/voice persona pickers) */
  /** Built-ins first, then custom by createdAt. */
  listPersonas(): Promise<PersonaRecord[]>;
  /** Creates a custom persona (id = 'persona-<slug>', deduped). 422 on invalid input. */
  createPersona(input: PersonaInput): Promise<PersonaRecord>;
  /** Custom only — 403 for built-ins, 404 unknown. */
  updatePersona(id: Persona, patch: Partial<PersonaInput>): Promise<PersonaRecord>;
  /** Custom only — 403/404 as above. Active persona resets to 'staff-engineer'. */
  deletePersona(id: Persona): Promise<void>;
  /** Model-drafted persona fields from a description (slow — show a working state). */
  draftPersona(req: PersonaDraftRequest): Promise<PersonaDraft>;

  /* memory */
  listMemories(opts?: { type?: MemoryType; q?: string; limit?: number }): Promise<MemoryRecord[]>;
  saveMemory(input: SaveMemoryInput): Promise<SaveMemoryResult>;
  updateMemory(
    id: string,
    patch: Partial<Pick<MemoryRecord, 'title' | 'body' | 'type' | 'tags' | 'confidence' | 'links'>>,
  ): Promise<MemoryRecord>;
  deleteMemory(id: string): Promise<void>;
  recall(query: string, opts?: { k?: number; types?: MemoryType[] }): Promise<RecallHit[]>;
  memoryGraph(): Promise<MemoryGraphData>;
  profile(): Promise<DerivedProfile>;
  /** Kick off an import; progress arrives via `import.progress`. Idempotent. */
  importSource(source: ImportSource, path: string): Promise<{ started: true }>;

  /* learning & daily loop */
  learningSummary(): Promise<LearningSummary>;
  learningWeeks(): Promise<LearningWeek[]>;
  learningDayTasks(dayId: string): Promise<LearningTask[]>;
  completeTask(taskId: string, done: boolean): Promise<LearningSummary>;
  todayMission(): Promise<TodayMission>;
  completeMissionItem(itemId: string, done: boolean): Promise<TodayMission>;
  reviewQueue(): Promise<ReviewItem[]>;
  heatmap(days?: number): Promise<HeatCell[]>;

  /* knowledge base */
  listKbSources(): Promise<KbSource[]>;
  /**
   * Ingest a file or folder (md/txt/pdf). Resolves once the source row exists;
   * chunk/embed progress streams via `kb.ingest`. Re-ingesting the same path
   * is idempotent: it re-indexes in place, same source id.
   */
  ingestKbSource(path: string, opts?: { title?: string; tags?: string[] }): Promise<{ sourceId: string }>;
  /** Removes the source and all its chunks from both indexes. */
  deleteKbSource(id: string): Promise<void>;
  /** Hybrid FTS5+vector search over all indexed chunks (RRF-fused). */
  hybridSearch(query: string, opts?: { k?: number; sourceIds?: string[] }): Promise<KbSearchHit[]>;
  /** Sources MentorOS proactively offers to index (interview-prep playbooks…). */
  kbSuggestions(): Promise<KbSuggestedSource[]>;
  /** Raw text of a md/txt source (or one file inside a folder source) for the reading view. */
  kbSourceText(id: string, filePath?: string): Promise<{ title: string; kind: KbKind; text: string; files?: string[] }>;
  /** Reveal the source file in the OS file manager (PDF reading-view fallback). */
  openKbSource(id: string): Promise<void>;

  /* interview platform */
  /** Bank for one type; server marks ≤1 as recommended (weakness-targeted). */
  listInterviewProblems(type?: InterviewType): Promise<InterviewProblemMeta[]>;
  /** Past sessions, newest first (launcher history strip). */
  listInterviewSessions(): Promise<InterviewSessionSummary[]>;
  /**
   * Creates the session and streams the interviewer's framing opener via
   * interview.token/status. Omit problemId to take the recommended pick.
   */
  startInterview(input: {
    type: InterviewType;
    problemId?: string;
    language: InterviewLanguage;
  }): Promise<{ session: InterviewSession; problem: InterviewProblem }>;
  /** Full state for resume: transcript, attempts, scorecard if finished. */
  getInterviewSession(sessionId: string): Promise<{
    session: InterviewSession;
    problem: InterviewProblem;
    turns: InterviewTurn[];
    attempts: EvalResult[];
    scorecard?: InterviewScorecard;
  }>;
  /** Candidate chat turn; interviewer reply streams via interview.token/status. */
  interviewSend(sessionId: string, content: string): Promise<{ turnId: string; replyTurnId: string }>;
  /** Next rung of the hint ladder (1 nudge → 2 approach → 3 key insight); streams. */
  requestHint(sessionId: string): Promise<{ level: 1 | 2 | 3; replyTurnId: string }>;
  /** Run the candidate's code against the problem's tests. Persists the attempt. */
  runInterviewTests(sessionId: string, code: string): Promise<EvalResult>;
  /**
   * Candidate declares done → phase moves to interrogation and the interviewer
   * opens with the §3.1 questions (streamed reply).
   */
  finishCoding(sessionId: string, code: string): Promise<{ replyTurnId: string }>;
  /** Grade + persist scorecard + write memories; result via interview.scorecard. */
  endInterview(sessionId: string): Promise<{ started: true }>;
  abandonInterview(sessionId: string): Promise<void>;
  /**
   * Importer step 1: paste a problem statement (any format) → model drafts the
   * full problem (starters, hidden tests, hints, reference solution) and the
   * server validates it by running the reference against the drafted tests.
   * Slow (one LLM call + sandboxed runs) — UI shows a working state.
   */
  generateInterviewDraft(sourceText: string): Promise<{
    draft: InterviewProblemDraft;
    validation: DraftValidation;
  }>;
  /** Importer step 2: re-validate a (possibly user-edited) draft without saving. */
  validateInterviewDraft(draft: InterviewProblemDraft): Promise<DraftValidation>;
  /** Importer step 3: persist. 422 when validation fails. Returns picker meta. */
  saveInterviewProblem(draft: InterviewProblemDraft): Promise<InterviewProblemMeta>;
  /** Remove a custom problem (404 for unknown, 403 for built-ins). */
  deleteInterviewProblem(problemId: string): Promise<void>;

  /* voice */
  voiceStatus(): Promise<VoiceStatus>;
  /** Download/build STT+TTS binaries and models; progress via `voice.install`. */
  installVoice(): Promise<void>;
  /** Synthesize text; audio streams back over the open /voice channel. */
  speak(text: string): Promise<void>;
  openVoiceChannel(handlers: VoiceChannelHandlers): VoiceChannel;

  /* custom face presets (Settings → Identity → Create preset) */
  /** Whether the local image-gen toolchain is usable. */
  faceToolchainStatus(): Promise<FaceToolchainStatus>;
  /** Finished custom presets (art URLs absolute, ready for <img src>). */
  listCustomFacePresets(): Promise<CustomFacePreset[]>;
  /**
   * Validate inputs and start generation. 422 = bad image/regions (designed
   * body), 503 = toolchain missing, 409 = a job is already running (one at a
   * time — it monopolizes the GPU). Progress via `face.job`.
   */
  createFacePreset(input: CreateFacePresetInput): Promise<{ job: FaceJobStatus }>;
  /** The in-flight (or most recent unresolved) job, for UI resume. Null when idle. */
  activeFaceJob(): Promise<FaceJobStatus | null>;
  /** Cancel a running job; partial frames are kept for skip-if-exists retry. */
  cancelFaceJob(jobId: string): Promise<void>;
  /** Custom only — 403 built-ins, 404 unknown. Active mentorFace resets to 'aura'. */
  deleteFacePreset(id: FacePresetId): Promise<void>;

  /* settings + voice options */
  getSettings(): Promise<AppSettings>;
  /** Partial update; returns the full merged settings. Fires `settings.changed`. */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** English Kokoro voices enumerated from the installed voices pack. */
  listTtsVoices(): Promise<TtsVoiceInfo[]>;
  /** URL of a one-shot WAV sample for the picker (`<audio src>`), independent of the /voice channel. */
  voicePreviewUrl(voiceId: string): string;
  listSttModels(): Promise<SttModelInfo[]>;
  /** Download a whisper model; progress via `voice.model`. 409 if already downloading. */
  downloadSttModel(id: SttModelId): Promise<void>;
}

function resolveCorePort(): number {
  try {
    const raw = new URLSearchParams(window.location.search).get('corePort');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CORE_PORT;
  } catch {
    return DEFAULT_CORE_PORT;
  }
}

type Listener = (payload: CoreEvents[keyof CoreEvents]) => void;

/** Thrown for non-2xx responses; carries the server's designed error body. */
export class CoreRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Parsed JSON error body when the server sent one (e.g. 422 {message, validation}). */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'CoreRequestError';
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // Surface the server's designed message ({message} / {error}) when present —
    // importer 502/422 bodies are user-facing copy, not debug noise.
    let body: unknown;
    let message = `core request failed: ${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      if (text) {
        body = JSON.parse(text);
        const m = (body as { message?: unknown; error?: unknown }) ?? {};
        if (typeof m.message === 'string' && m.message) message = m.message;
        else if (typeof m.error === 'string' && m.error) message = m.error;
      }
    } catch {
      /* non-JSON error body — keep the status-based message */
    }
    throw new CoreRequestError(res.status, message, body);
  }
  // 204s and empty bodies (abandon, open-in-finder) have nothing to parse.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function createCoreClient(): CoreClient {
  const port = resolveCorePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/events`;

  const listeners = new Map<keyof CoreEvents, Set<Listener>>();
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const closed = false;

  function emit(event: keyof CoreEvents, payload: unknown): void {
    const set = listeners.get(event);
    if (!set) return;
    for (const cb of set) cb(payload as CoreEvents[keyof CoreEvents]);
  }

  function connect(): void {
    if (closed) return;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { event?: keyof CoreEvents; payload?: unknown };
        if (msg.event) emit(msg.event, msg.payload);
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => socket?.close());
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  connect();

  const get = <T>(path: string) => fetch(`${baseUrl}${path}`).then((r) => json<T>(r));
  // Bodyless POSTs must not declare a JSON content-type — fastify 400s on an
  // empty body that claims to be JSON (bit us on /hint, /end, /abandon).
  const post = <T>(path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }).then((r) => json<T>(r));
  const del = <T>(path: string) =>
    fetch(`${baseUrl}${path}`, { method: 'DELETE' }).then((r) => json<T>(r));

  return {
    baseUrl,

    health: () => get<CoreHealth>('/health'),

    on(event, cb) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb as Listener);
      return () => {
        set?.delete(cb as Listener);
      };
    },

    listThreads: () => get<ThreadSummary[]>('/threads'),
    createThread: (title) => post<ThreadSummary>('/threads', { title }),
    deleteThread: (threadId) =>
      fetch(`${baseUrl}/threads/${threadId}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    getMessages: (threadId) => get<ChatMessage[]>(`/threads/${threadId}/messages`),
    sendMessage: (threadId, content, persona, surface) =>
      post<{ userMessageId: string; assistantMessageId: string }>('/chat', {
        threadId,
        content,
        persona,
        ...(surface ? { surface } : {}),
      }),
    stopGeneration: (messageId) => post<void>(`/chat/${messageId}/stop`),
    modelStatus: (surface) =>
      get<ModelStatus>(`/models/status${surface ? `?surface=${surface}` : ''}`),
    pullModel: (model) => post<void>('/models/pull', { model }),

    listProviders: () => get<ProvidersInfo>('/models/providers'),
    setAnthropicKey: (apiKey) =>
      fetch(`${baseUrl}/models/keys/anthropic`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      }).then((r) => json<{ keyState: ApiKeyState; keyMask?: string; keyError?: string }>(r)),
    clearAnthropicKey: () =>
      fetch(`${baseUrl}/models/keys/anthropic`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),

    listPersonas: () => get<PersonaRecord[]>('/personas'),
    createPersona: (input) => post<PersonaRecord>('/personas', input),
    updatePersona: (id, patch) =>
      fetch(`${baseUrl}/personas/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((r) => json<PersonaRecord>(r)),
    deletePersona: (id) =>
      fetch(`${baseUrl}/personas/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    draftPersona: (req) => post<PersonaDraft>('/personas/draft', req),

    listMemories: (opts) => {
      const p = new URLSearchParams();
      if (opts?.type) p.set('type', opts.type);
      if (opts?.q) p.set('q', opts.q);
      if (opts?.limit) p.set('limit', String(opts.limit));
      const qs = p.toString();
      return get<MemoryRecord[]>(`/memories${qs ? `?${qs}` : ''}`);
    },
    saveMemory: (input) => post<SaveMemoryResult>('/memories', input),
    updateMemory: (id, patch) =>
      fetch(`${baseUrl}/memories/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((r) => json<MemoryRecord>(r)),
    deleteMemory: (id) =>
      fetch(`${baseUrl}/memories/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    recall: (query, opts) => post<RecallHit[]>('/memories/recall', { query, ...opts }),
    memoryGraph: () => get<MemoryGraphData>('/memories/graph'),
    profile: () => get<DerivedProfile>('/memories/profile'),
    importSource: (source, path) => post<{ started: true }>('/import', { source, path }),

    learningSummary: () => get<LearningSummary>('/learning/summary'),
    learningWeeks: () => get<LearningWeek[]>('/learning/weeks'),
    learningDayTasks: (dayId) => get<LearningTask[]>(`/learning/days/${dayId}/tasks`),
    completeTask: (taskId, done) => post<LearningSummary>(`/learning/tasks/${taskId}/complete`, { done }),
    todayMission: () => get<TodayMission>('/mission/today'),
    completeMissionItem: (itemId, done) => post<TodayMission>(`/mission/items/${itemId}/complete`, { done }),
    reviewQueue: () => get<ReviewItem[]>('/learning/reviews'),
    heatmap: (days) => get<HeatCell[]>(`/learning/heatmap${days ? `?days=${days}` : ''}`),

    listKbSources: () => get<KbSource[]>('/kb/sources'),
    ingestKbSource: (path, opts) => post<{ sourceId: string }>('/kb/sources', { path, ...opts }),
    deleteKbSource: (id) =>
      fetch(`${baseUrl}/kb/sources/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    hybridSearch: (query, opts) => post<KbSearchHit[]>('/kb/search', { query, ...opts }),
    kbSuggestions: () => get<KbSuggestedSource[]>('/kb/suggestions'),
    kbSourceText: (id, filePath) =>
      get<{ title: string; kind: KbKind; text: string; files?: string[] }>(
        `/kb/sources/${id}/text${filePath ? `?file=${encodeURIComponent(filePath)}` : ''}`,
      ),
    openKbSource: (id) => post<void>(`/kb/sources/${id}/open`),

    listInterviewProblems: (type) =>
      get<InterviewProblemMeta[]>(`/interview/problems${type ? `?type=${type}` : ''}`),
    listInterviewSessions: () => get<InterviewSessionSummary[]>('/interview/sessions'),
    startInterview: (input) =>
      post<{ session: InterviewSession; problem: InterviewProblem }>('/interview/sessions', input),
    getInterviewSession: (sessionId) =>
      get<{
        session: InterviewSession;
        problem: InterviewProblem;
        turns: InterviewTurn[];
        attempts: EvalResult[];
        scorecard?: InterviewScorecard;
      }>(`/interview/sessions/${sessionId}`),
    interviewSend: (sessionId, content) =>
      post<{ turnId: string; replyTurnId: string }>(`/interview/sessions/${sessionId}/say`, {
        content,
      }),
    requestHint: (sessionId) =>
      post<{ level: 1 | 2 | 3; replyTurnId: string }>(`/interview/sessions/${sessionId}/hint`),
    runInterviewTests: (sessionId, code) =>
      post<EvalResult>(`/interview/sessions/${sessionId}/run`, { code }),
    finishCoding: (sessionId, code) =>
      post<{ replyTurnId: string }>(`/interview/sessions/${sessionId}/finish`, { code }),
    endInterview: (sessionId) => post<{ started: true }>(`/interview/sessions/${sessionId}/end`),
    abandonInterview: (sessionId) =>
      post<void>(`/interview/sessions/${sessionId}/abandon`),
    generateInterviewDraft: (sourceText) =>
      post<{ draft: InterviewProblemDraft; validation: DraftValidation }>(
        '/interview/import/draft',
        { sourceText },
      ),
    validateInterviewDraft: (draft) =>
      post<DraftValidation>('/interview/import/validate', { draft }),
    saveInterviewProblem: (draft) =>
      post<InterviewProblemMeta>('/interview/import', { draft }),
    deleteInterviewProblem: (problemId) =>
      del<void>(`/interview/problems/${problemId}`),

    voiceStatus: () => get<VoiceStatus>('/voice/status'),
    installVoice: () => post<void>('/voice/install'),
    speak: (text) => post<void>('/voice/speak', { text }),

    faceToolchainStatus: () => get<FaceToolchainStatus>('/faces/toolchain'),
    listCustomFacePresets: () =>
      get<CustomFacePreset[]>('/faces/custom').then((presets) =>
        // Core returns server-relative art paths; absolutize once here so every
        // consumer can drop them straight into <img src>.
        presets.map((p) => ({
          ...p,
          portrait: Object.fromEntries(
            Object.entries(p.portrait).map(([k, v]) => [k, `${baseUrl}${v}`]),
          ) as CustomFacePreset['portrait'],
          ...(p.full ? { full: `${baseUrl}${p.full}` } : {}),
        })),
      ),
    createFacePreset: (input) => post<{ job: FaceJobStatus }>('/faces/custom', input),
    activeFaceJob: () => get<FaceJobStatus | null>('/faces/jobs/active'),
    cancelFaceJob: (jobId) => post<void>(`/faces/jobs/${jobId}/cancel`),
    deleteFacePreset: (id) =>
      fetch(`${baseUrl}/faces/custom/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),

    getSettings: () => get<AppSettings>('/settings'),
    updateSettings: (patch) => post<AppSettings>('/settings', patch),
    listTtsVoices: () => get<TtsVoiceInfo[]>('/voice/voices'),
    voicePreviewUrl: (voiceId) =>
      `http://127.0.0.1:${port}/voice/preview?voice=${encodeURIComponent(voiceId)}`,
    listSttModels: () => get<SttModelInfo[]>('/voice/stt-models'),
    downloadSttModel: (id) =>
      post<void>(`/voice/stt-models/${encodeURIComponent(id)}/download`),

    openVoiceChannel(handlers) {
      const vws = new WebSocket(`ws://127.0.0.1:${port}/voice`);
      vws.binaryType = 'arraybuffer';
      let ttsActive = false;

      vws.addEventListener('message', (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          if (ttsActive) handlers.onTtsChunk(ev.data);
          return;
        }
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type: string;
            text?: string;
            final?: boolean;
            sampleRate?: number;
            message?: string;
          };
          if (msg.type === 'transcript') handlers.onTranscript({ text: msg.text ?? '', final: !!msg.final });
          else if (msg.type === 'tts-start') {
            ttsActive = true;
            handlers.onTtsStart(msg.sampleRate ?? 24000);
          } else if (msg.type === 'tts-end') {
            ttsActive = false;
            handlers.onTtsEnd();
          } else if (msg.type === 'voice-error') handlers.onError(msg.message ?? 'Voice error');
        } catch {
          /* ignore malformed frames */
        }
      });
      vws.addEventListener('error', () => handlers.onError('Voice channel disconnected'));

      const sendJson = (obj: unknown) => {
        if (vws.readyState === WebSocket.OPEN) vws.send(JSON.stringify(obj));
        else vws.addEventListener('open', () => vws.send(JSON.stringify(obj)), { once: true });
      };

      return {
        micStart: (sampleRate) => sendJson({ type: 'mic-start', sampleRate }),
        sendPcm: (chunk) => {
          if (vws.readyState === WebSocket.OPEN) vws.send(chunk);
        },
        micStop: () => sendJson({ type: 'mic-stop' }),
        stopTts: () => sendJson({ type: 'tts-stop' }),
        close: () => vws.close(),
      };
    },
  };
}

/** Shared singleton — one WS connection for the whole renderer. */
export const coreClient: CoreClient = createCoreClient();
