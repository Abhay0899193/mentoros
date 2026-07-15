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
  provider?: 'ollama' | 'anthropic' | 'endpoint';
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

/** Last/current import job — poll fallback for missed `import.progress` WS events. */
export interface ImportStatus {
  active: boolean;
  done: boolean;
  source?: ImportSource;
  step?: string;
  created?: number;
  merged?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

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
  /** XP this task awards on completion (derived; shown as "+150 XP" pre-action). */
  xpWorth: number;
}

export interface LearningDay {
  id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  state: 'available' | 'current' | 'done';
  taskCount: number;
  doneCount: number;
  /** Whether the imported plan carries study notes (day markdown) for this day. */
  hasNotes: boolean;
}

/** A quick-review reference doc (KB source) attached to a plan week. */
export interface LearningWeekDoc {
  sourceId: string;
  title: string;
}

export interface LearningWeek {
  phase: number;
  week: number;
  /** Week topic from the plan, e.g. "Arrays, Strings, Two Pointers + Docker Basics". */
  focus?: string;
  days: LearningDay[];
  /** Quick-review skill docs covering this week (imported from SKILLS-TRACK). */
  docs?: LearningWeekDoc[];
}

/** Result of importing a study-ui `study-progress` export. */
export interface ProgressImportResult {
  found: number;
  applied: number;
  alreadyDone: number;
  unknown: number;
  summary: LearningSummary;
}

/** One daily-mission item surfaced as a "quest" with its XP reward attached. */
export interface Quest {
  id: string;
  label: string;
  kind: TaskKind | 'drill';
  done: boolean;
  /** XP awarded when this quest is completed. */
  xp: number;
}

export interface LearningSummary {
  imported: boolean;
  totalDays: number;
  doneDays: number;
  totalTasks: number;
  doneTasks: number;
  currentDayId: string | null;
  /** Total derived XP (task + doc-read + bonuses). */
  xp: number;
  level: number;
  /** XP accrued inside the current level. */
  xpIntoLevel: number;
  /** XP still needed for the next level (0 at the cap). */
  xpToNext: number;
  streak: { current: number; best: number };
  /** XP earned today (calendar day). */
  todayXp: number;
  /** XP per 7-day bucket, trailing weeks, oldest-first (last = current week). */
  weeklyXp: number[];
  /** Today's mission items surfaced as quests with XP rewards. */
  quests: Quest[];
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
  /** When the user marked it read (ISO); null = unread. */
  readAt: string | null;
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
 * 'interview' = full mock (framing → coding → interrogation → LLM scorecard).
 * 'practice' = solve-LeetCode-in-app: no interviewer/framing/LLM; starts in
 * `coding` and finishes on a deterministic, test-based scorecard.
 */
export type InterviewMode = 'interview' | 'practice';
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
  /** LeetCode titleSlug (e.g. 'two-sum') — resolve-by-slug key + "open on LC" link. */
  slug?: string;
}

/**
 * Result of fetching a problem from LeetCode's public GraphQL (practice-mode
 * "import from leetcode.com"). Statement HTML is converted to markdown-ish text
 * server-side; starters are extracted when LC provides them.
 */
export interface LeetCodeFetchResult {
  title: string;
  difficulty: string;
  statementMarkdown: string;
  /** LeetCode Premium — statement is not public; sourceText must be pasted. */
  paidOnly: boolean;
  exampleTestcases: string;
  pythonStarter?: string;
  jsStarter?: string;
}

/**
 * Result of fetching an arbitrary problem/article page ("import from URL").
 * Main content is extracted heuristically server-side and converted to
 * markdown; the user reviews it in the paste box before generating.
 */
export interface PageFetchResult {
  /** Page <title>, site-name suffix trimmed; may be "". */
  title: string;
  markdown: string;
  url: string;
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
  /** Optional LeetCode titleSlug, set when the draft originates from an LC url/fetch. */
  slug?: string;
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
  /** 'interview' (full mock) vs 'practice' (LLM-free grind). Legacy rows read as 'interview'. */
  mode?: InterviewMode;
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
  mode?: InterviewMode;
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

/* ---------------- Image Lab (text-to-image) ---------------- */

/**
 * One selectable text-to-image backend (GET /imagegen/models). `available`
 * gates the picker; `detail` explains a not-yet-usable model (missing binary,
 * absent key, first-run weights download). Local models shell out to mflux;
 * hosted models call fal.ai with the stored key.
 */
export interface ImageGenModelInfo {
  id: string;
  label: string;
  kind: 'local' | 'hosted';
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
  /** Absolute art URL (absolutized at the client boundary), ready for <img src>. */
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
  state: 'queued' | 'running' | 'done' | 'error';
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
  /** Absolute art URL (absolutized at the client boundary). */
  url: string;
  createdAt: string; // ISO
}

/* ---------------- Video Lab (text/image-to-video) ---------------- */

/**
 * One selectable video backend (GET /videogen/models). `available` gates the
 * picker; `detail` explains a not-yet-usable model (missing binary/weights).
 * `supportsImageInput` marks the I2V-capable models. The one live model
 * (`ltx-local`) shells out to mlx-video under ~/mentoros-imagegen.
 */
export interface VideoGenModelInfo {
  id: string;
  label: string;
  kind: 'local' | 'hosted';
  desc: string;
  supportsImageInput: boolean;
  defaultFrames: number;
  defaultFps: number;
  available: boolean;
  detail?: string;
}

/**
 * A single generation request. An absent `seed` (or `randomizeSeed`) makes core
 * pick a uint32 itself, so `seedUsed` is always known. `image` (a
 * `data:image/...;base64,...` URI) is optional — present for image-to-video.
 */
export interface VideoGenGenerateInput {
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed?: number;
  randomizeSeed: boolean;
  image?: string;
}

/** The finished artifact of a generation job (persisted in history). */
export interface VideoGenJobResult {
  historyId: string;
  /** Absolute art URL (absolutized at the client boundary), ready for <video src>. */
  url: string;
  seedUsed: number;
  elapsedMs: number;
}

/**
 * Generation lifecycle. Single-flight (one job monopolizes the GPU). `progress`
 * is a 0..1 fraction; `detail` carries the current step line. A cancelled job
 * ends 'cancelled'. Progress arrives via the `videogen.job` event.
 */
export interface VideoGenJobStatus {
  id: string;
  state: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress?: number;
  detail?: string;
  error?: string;
  result?: VideoGenJobResult;
}

/** One persisted generation (GET /videogen/history, newest-first). */
export interface VideoGenHistoryEntry {
  id: string;
  modelId: string;
  prompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number;
  hasSourceImage: boolean;
  durationMs: number;
  /** Absolute art URL (absolutized at the client boundary). */
  url: string;
  createdAt: string; // ISO
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

export type ModelProvider = 'ollama' | 'anthropic' | 'endpoint';

/**
 * The app surfaces that generate with an LLM, each independently routable.
 * 'voice' is the Voice screen's spoken answers (rides POST /chat with
 * surface:'voice'); the memory merge-judge is deliberately NOT routable — it
 * stays on the local model (cheap latency-sensitive classifier).
 */
export type ModelSurface = 'chat' | 'voice' | 'interviewer' | 'scorecard' | 'guide';

export interface ModelChoice {
  provider: ModelProvider;
  /** Ollama tag ('llama3.1:8b') or Anthropic model id ('claude-opus-4-8'). */
  model: string;
  /**
   * Which custom endpoint the model lives on. Required when provider ===
   * 'endpoint' (the router falls back to local without it); ignored otherwise.
   */
  endpointId?: string;
}

/** Wire protocol a custom endpoint speaks (OpenAI-compatible or Anthropic-compatible). */
export type EndpointKind = 'openai' | 'anthropic';

/** How the token is presented to a custom endpoint (default 'bearer'). */
export type EndpointAuth = 'bearer' | 'x-api-key';

/**
 * A user-defined custom LLM endpoint (a corporate Claude gateway, OpenCode Zen,
 * a self-hosted proxy…). The token is a secret and is NEVER returned — only a
 * display mask ('…f3a2') when one is stored.
 */
export interface CustomEndpointInfo {
  id: string;
  label: string;
  kind: EndpointKind;
  baseUrl: string;
  auth: EndpointAuth;
  /** Free-typed model ids (membership is not enforced at resolve time). */
  models: string[];
  tokenMask?: string;
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
  /** User-defined custom endpoints (configs + token masks; never the token). */
  endpoints: CustomEndpointInfo[];
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
  /**
   * Legacy sprite block (kept for gallery thumbnails / old consumers). For
   * presets without AI-generated mouth/blink frames these fields fall back to
   * `base` — playback always goes through `config`, never this block.
   */
  portrait: {
    base: string;
    mouthSmall: string;
    mouthOpen: string;
    mouthWide: string;
    blink: string;
  };
  /** Present only when a full-body photo was provided. */
  full?: string;
  /**
   * The generic animation config (always present — synthesized from the legacy
   * frame convention when the preset predates configs). Frame paths arrive
   * server-relative and are absolutized by the client like `portrait`.
   */
  config: AvatarConfig;
  createdAt: string; // ISO
}

/* ----------------- Generic avatar animation system (v1) ------------------ */

/**
 * Expression channels of the stylized (procedural SVG) family — exactly the
 * axes FacePortrait animates. Procedural clips keyframe TARGETS in this space;
 * the portrait's own spring smoothing/gaze/breath choreography stays intact
 * (a clip steers the face, it never replaces the living-face math).
 * `blink` is 0 open → 1 closed.
 */
export interface PoseChannels {
  aperture: number;
  browLift: number;
  furrow: number;
  smile: number;
  tilt: number;
  dy: number;
  blink: number;
}

/** One procedural keyframe: normalized clip time (0..1) → channel targets. */
export interface PoseKeyframe {
  at: number;
  pose: Partial<PoseChannels>;
}

export type AnimationDriver = 'time' | 'envelope';
export type AnimationLoopMode = 'once' | 'loop' | 'pingpong' | 'holdLast';
export type AnimationRegion = 'portrait' | 'full';
export type AnimationRenderKind = 'sprite' | 'procedural';
export type AnimationCategory = 'reaction' | 'gesture' | 'expression' | 'idle' | (string & {});

/**
 * A named animation. `renderKind` decides how a playhead position is painted
 * (composite a webp frame vs. steer SVG pose channels); everything else —
 * queueing, priority, triggers, drivers — is shared machinery.
 *
 * `track` is the concurrency lane: clips on different tracks play at the same
 * time (that is how a blink lands mid-speech), while within one track higher
 * `priority` preempts and equal/lower waits. Convention: 'eyes', 'mouth' for
 * region overlays; 'main' for full-frame gestures (an active 'main' clip
 * temporarily hides the overlay tracks of its region so pixel-aligned overlay
 * frames are never composited onto a non-base frame).
 *
 * Drivers: 'time' advances by fps/durationMs; 'envelope' maps the live TTS
 * RMS level to the playhead and is ALWAYS ARMED — it plays whenever the
 * mentor is speaking and its track is free, no trigger needed.
 */
export interface AnimationClip {
  id: string; // slug, unique within the preset
  name: string;
  description?: string;
  category: AnimationCategory;
  appliesTo: AnimationRegion;
  renderKind: AnimationRenderKind;
  track: string;
  /** sprite: ordered full-frame art paths (server-relative → absolutized). */
  frames?: string[];
  /** procedural: pose-channel keyframes (see PoseChannels). */
  proceduralPose?: PoseKeyframe[];
  driver: AnimationDriver;
  /** Frames per second for driver 'time' (default 8). */
  fps?: number;
  /** Total clip duration; overrides fps when set. */
  durationMs?: number;
  loopMode: AnimationLoopMode;
  priority: number;
  tags?: string[];
  /** Art path of a thumbnail frame for library UI (defaults to first frame). */
  thumbnail?: string;
}

/** Conversation lifecycle moments the trigger engine can react to. */
export type ConversationEvent =
  | 'conversationStarted'
  | 'conversationEnded'
  | 'listening'
  | 'thinking'
  | 'speakingStarted'
  | 'speakingEnded'
  | 'idle'
  | 'silenceTimeout';

export type TextMatchMode = 'contains' | 'regex' | 'startsWith' | 'endsWith' | 'keywords';

interface TriggerBase {
  id: string;
  animationId: string;
  enabled: boolean;
}

/**
 * When to play a clip. Rules are pure data evaluated in the renderer (it owns
 * every event source); adding a new `kind` is one evaluator-registry entry.
 */
export type TriggerRule =
  | (TriggerBase & { kind: 'manual' })
  | (TriggerBase & { kind: 'shortcut'; keys: string })
  | (TriggerBase & { kind: 'api' })
  | (TriggerBase & {
      kind: 'textMatch';
      mode: TextMatchMode;
      patterns: string[];
      target: 'assistant' | 'user';
      caseSensitive?: boolean;
    })
  | (TriggerBase & { kind: 'conversationEvent'; event: ConversationEvent })
  | (TriggerBase & { kind: 'everyNMessages'; n: number })
  | (TriggerBase & { kind: 'timer'; intervalMs: number })
  | (TriggerBase & { kind: 'randomInterval'; minMs: number; maxMs: number });

/**
 * The versioned avatar animation document. Stored per custom preset
 * (face_presets.config_json); synthesized on read for presets that predate it
 * (legacy AI-generated five-frame sets) and for the bundled built-ins — zero
 * migration, pixel-identical playback.
 */
export interface AvatarConfig {
  schemaVersion: 1;
  presetId: string;
  name: string;
  accent: string;
  /** Portrait base frame (art path). Always visible under portrait overlays. */
  baseFrame: string;
  /** Full-body base frame; present when the preset has a full-body region. */
  fullBase?: string;
  animations: AnimationClip[];
  triggers: TriggerRule[];
  /** Optional idle clip; absent = rest on the base frame. */
  defaultAnimationId?: string;
  /** Present on presets built by the Preset Generator — drives add-expression. */
  generation?: PresetGenerationMeta;
  createdAt: string;
  updatedAt: string;
}

/* --------------------- Preset Generator (text → preset) ------------------- */

/** How a group's composite window was resolved. */
export type RegionSource = 'auto' | 'manual' | 'default';
export type ExpressionGroup = 'mouth' | 'eyes' | 'face';
export type ExpressionGroupOrCustom = ExpressionGroup | 'custom';

/**
 * Provenance a generated preset carries in its `config.generation` so the user
 * can add matching expressions later. Regions are in 1024² composite space.
 */
export interface PresetGenerationMeta {
  method: 'z-turbo-t2i' | 'kontext-photo';
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

/**
 * Create a preset from user-supplied frames (Avatar Studio → Create from
 * frames). No generation job — the client slices/encodes webp frames
 * (canvas), the server just validates + persists, so this path never needs
 * the mflux toolchain. Frame entries are `data:image/webp;base64,...` URIs.
 */
export interface CreateManualFacePresetInput {
  name: string;
  /** Accent hex sampled client-side from the base frame. */
  accent: string;
  /** webp data URI. */
  baseFrame: string;
  /** webp data URI (optional full-body base). */
  fullBase?: string;
  animations: AnimationClip[]; // clip.frames = webp data URIs
  triggers: TriggerRule[];
  defaultAnimationId?: string;
}

/**
 * Replace a custom preset's animation document (Avatar Studio editor).
 * Clip frame entries may be existing art file names (kept) or webp data URIs
 * (persisted as new frames). Built-ins are 403 — their art is bundled.
 */
export interface UpdateAvatarConfigInput {
  name?: string;
  accent?: string;
  animations: AnimationClip[];
  triggers: TriggerRule[];
  defaultAnimationId?: string;
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
  /** Which pipeline produced this job (photo Kontext, t2i generate, add-expression). */
  kind: 'photo' | 'generate' | 'expression';
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
  /**
   * Opt-in LAN exposure: core binds 0.0.0.0 (instead of loopback) so phones on
   * the same network — or Tailscale — can open the app. Applies on relaunch.
   */
  lanAccess: boolean;
}

/** GET /network/access-info (loopback-only): everything the Connectivity UI shows. */
export interface NetworkAccessInfo {
  /** Effective LAN state (setting OR MENTOROS_LAN env) — what the NEXT launch binds. */
  lanAccess: boolean;
  port: number;
  /** IPv4 LAN addresses of this Mac (non-internal). */
  ips: string[];
  /** Shared access token; null until LAN is first enabled. */
  token: string | null;
  /** Ready-to-open phone URLs (`http://<ip>:<port>/?token=…`). */
  urls: string[];
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
  /** Video Lab generation progress (long job — drives the job card + progress bar). */
  'videogen.job': VideoGenJobStatus;
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
  /**
   * "New guide" progress (Phase G) — writing + ingesting one
   * STUDY-GUIDES/custom/<slug>.md from a prompt. Mirrors `kb.ingest`'s shape.
   */
  'guide.progress':
    | { step: 'generating'; chars: number }
    | { step: 'ingesting' }
    | { step: 'done'; slug: string; sourceId: string }
    | { step: 'error'; error: string };
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

  /* custom endpoints (Settings → Models → Custom endpoints) */
  /**
   * Create a custom endpoint (id derived from the label, deduped). A non-empty
   * `token` is stored as its secret; omit it for a keyless gateway. 400 on
   * invalid input. Resolves with the created endpoint (token masked only).
   */
  createEndpoint(input: {
    label: string;
    kind: EndpointKind;
    baseUrl: string;
    auth?: EndpointAuth;
    models?: string[];
    token?: string;
  }): Promise<CustomEndpointInfo>;
  /**
   * Partial update. Token semantics: omit `token` to keep the current one, ''
   * to clear it, a non-empty string to set it. 404 when unknown, 400 on invalid.
   */
  updateEndpoint(
    id: string,
    patch: Partial<{
      label: string;
      kind: EndpointKind;
      baseUrl: string;
      auth: EndpointAuth;
      models: string[];
      token: string;
    }>,
  ): Promise<CustomEndpointInfo>;
  /** Forget an endpoint + its token; surfaces pointing at it fall back to local. */
  deleteEndpoint(id: string): Promise<void>;
  /** Fetch the endpoint's remote model list (does not persist it). 502 on failure. */
  fetchEndpointModels(id: string): Promise<string[]>;
  /** Probe the endpoint (list models, 6s). Never rejects on a bad endpoint. */
  testEndpoint(id: string): Promise<{ ok: boolean; error?: string }>;

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
  /** Last/current import job state — reconciles the UI when WS events were missed. */
  importStatus(): Promise<ImportStatus>;

  /* learning & daily loop */
  learningSummary(): Promise<LearningSummary>;
  learningWeeks(): Promise<LearningWeek[]>;
  learningDayTasks(dayId: string): Promise<LearningTask[]>;
  learningDayNotes(dayId: string): Promise<{ notes: string | null }>;
  importLearningProgress(progress: unknown): Promise<ProgressImportResult>;
  completeTask(taskId: string, done: boolean): Promise<LearningSummary>;
  todayMission(): Promise<TodayMission>;
  completeMissionItem(itemId: string, done: boolean): Promise<TodayMission>;
  reviewQueue(): Promise<ReviewItem[]>;
  heatmap(days?: number): Promise<HeatCell[]>;
  /**
   * "New guide" (Phase G): writes one supplementary study-guide part from a
   * prompt and ingests it (never touches week guides). Fire-and-forget —
   * progress arrives via `guide.progress`. Throws CoreRequestError on 400
   * (invalid prompt) or 409 (already running / no plan imported yet).
   */
  generateGuide(prompt: string): Promise<void>;

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
  /** Mark a source read/unread; read state syncs across every collection view. */
  setKbSourceRead(id: string, read: boolean): Promise<KbSource>;
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
  /**
   * Resolve a bank/custom problem by LeetCode titleSlug (case-insensitive).
   * Returns null when nothing maps to the slug (renderer offers LC import).
   */
  interviewProblemBySlug(slug: string): Promise<InterviewProblem | null>;
  /**
   * Fetch a statement from LeetCode's public GraphQL for practice-mode import.
   * Rejects (CoreRequestError) on 404 (unknown slug) / 502 (network) so the UI
   * can fall back to paste-import.
   */
  fetchLeetCodeProblem(slug: string): Promise<LeetCodeFetchResult>;
  /**
   * Fetch + extract an arbitrary problem page for import-from-URL. Rejects
   * (CoreRequestError) on 400 (bad URL) / 422 (nothing extractable —
   * client-rendered page) / 502 (network) so the UI falls back to paste.
   */
  fetchProblemPage(url: string): Promise<PageFetchResult>;
  /** Past sessions, newest first (launcher history strip). */
  listInterviewSessions(): Promise<InterviewSessionSummary[]>;
  /**
   * Creates the session and streams the interviewer's framing opener via
   * interview.token/status. Omit problemId to take the recommended pick.
   * `mode: 'practice'` starts LLM-free in `coding` (no framing/interviewer).
   */
  startInterview(input: {
    type: InterviewType;
    problemId?: string;
    language: InterviewLanguage;
    mode?: InterviewMode;
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
  /**
   * Generate a preset from text (z-image-turbo t2i). 422 = bad input, 503 =
   * z-turbo toolchain missing, 409 = a faces OR Image Lab job is already running.
   * Progress via `face.job` (kind 'generate').
   */
  generateFacePreset(input: GenerateFacePresetInput): Promise<{ job: FaceJobStatus }>;
  /**
   * Add or regenerate one expression on a custom preset (t2i for generated
   * presets, Kontext for legacy photo presets). Same 422/503/409 gates; 404
   * unknown, 403 built-in. Progress via `face.job` (kind 'expression').
   */
  addFaceExpression(id: FacePresetId, input: AddFaceExpressionInput): Promise<{ job: FaceJobStatus }>;
  /** The proven expression catalog (prefilled prompts for the wizard). */
  faceCatalog(): Promise<FaceCatalogEntry[]>;
  /** The in-flight (or most recent unresolved) job, for UI resume. Null when idle. */
  activeFaceJob(): Promise<FaceJobStatus | null>;
  /** Cancel a running job; partial frames are kept for skip-if-exists retry. */
  cancelFaceJob(jobId: string): Promise<void>;
  /** Custom only — 403 built-ins, 404 unknown. Active mentorFace resets to 'aura'. */
  deleteFacePreset(id: FacePresetId): Promise<void>;
  /**
   * Create a preset from user-supplied frames (no generation job — returns the
   * finished preset synchronously). 422 = designed validation body.
   */
  createManualFacePreset(input: CreateManualFacePresetInput): Promise<CustomFacePreset>;
  /** Replace a custom preset's animations/triggers. 403 built-ins, 404 unknown. */
  updateAvatarConfig(id: FacePresetId, input: UpdateAvatarConfigInput): Promise<CustomFacePreset>;

  /* image lab (text-to-image) */
  /** Selectable backends with live availability (bin/key/weights). */
  imagegenModels(): Promise<ImageGenModelInfo[]>;
  /**
   * Validate + start a generation. 422 = bad input / unknown model, 503 = model
   * unavailable (missing bin/key), 409 = a job is already running (single-flight
   * — it monopolizes the GPU / fal budget). Poll {@link imagegenJob} for result.
   */
  imagegenGenerate(req: ImageGenRequest): Promise<{ jobId: string }>;
  /** Job status (result URL absolute). Null when the id is unknown. */
  imagegenJob(id: string): Promise<ImageGenJobStatus | null>;
  /** Cancel a running job. */
  imagegenCancel(id: string): Promise<void>;
  /** Persisted generations, newest-first (art URLs absolute). */
  imagegenHistory(): Promise<ImageGenHistoryItem[]>;
  /** Remove a history row and its PNG. */
  imagegenDeleteHistory(id: string): Promise<void>;

  /* video lab (text/image-to-video) */
  /** Selectable video backends with live availability (bin/weights). */
  videogenModels(): Promise<VideoGenModelInfo[]>;
  /**
   * Validate + start a generation. 422 = bad input / unknown model, 503 = model
   * unavailable, 409 = a job is already running (single-flight, cross-busy with
   * Image Lab + faces — one GPU job at a time). Progress via `videogen.job`.
   */
  videogenGenerate(input: VideoGenGenerateInput): Promise<{ job: VideoGenJobStatus }>;
  /** Job status (result URL absolute). Null when the id is unknown. */
  videogenJob(id: string): Promise<VideoGenJobStatus | null>;
  /** Cancel a running job. */
  videogenCancelJob(id: string): Promise<void>;
  /** Persisted generations, newest-first (art URLs absolute). */
  videogenHistory(): Promise<VideoGenHistoryEntry[]>;
  /** Remove a history row and its mp4. */
  videogenDeleteHistory(id: string): Promise<void>;
  /** fal.ai key presence/state (raw key never returned). */
  falKeyStatus(): Promise<{ keyState: ApiKeyState; keyMask?: string }>;
  /** Store the fal.ai key (stored 'valid' when non-empty — no validation ping). */
  setFalKey(apiKey: string): Promise<{ keyState: ApiKeyState; keyMask?: string }>;
  /** Forget the stored fal.ai key; hosted models become unavailable immediately. */
  clearFalKey(): Promise<void>;

  /* settings + voice options */
  getSettings(): Promise<AppSettings>;
  /** Partial update; returns the full merged settings. Fires `settings.changed`. */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** LAN/Tailscale access details for the Connectivity section (loopback-only route). */
  networkAccessInfo(): Promise<NetworkAccessInfo>;
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

/**
 * Where the core lives. Two worlds:
 * - Electron (file:// prod, or the vite dev window which carries ?corePort=N):
 *   loopback + explicit port, exactly as before.
 * - Served BY the core itself (phone over LAN / Tailscale — http(s) page with
 *   no ?corePort): same-origin, so the URL bar is the single source of truth
 *   and wss follows https (Tailscale). Auth rides the mentoros_token cookie the
 *   server set on first load; no header plumbing needed here.
 * Dev note: opening the bare vite URL in a plain browser needs ?corePort=4820
 * appended manually now — the dev Electron window is unaffected.
 */
function resolveCoreBase(): { baseUrl: string; wsBase: string } {
  try {
    const { protocol, host, search } = window.location;
    const isHttp = protocol === 'http:' || protocol === 'https:';
    if (isHttp && !new URLSearchParams(search).has('corePort')) {
      const ws = protocol === 'https:' ? 'wss:' : 'ws:';
      return { baseUrl: `${protocol}//${host}`, wsBase: `${ws}//${host}` };
    }
  } catch {
    /* fall through to loopback */
  }
  const port = resolveCorePort();
  return { baseUrl: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}` };
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
  const { baseUrl, wsBase } = resolveCoreBase();
  const wsUrl = `${wsBase}/events`;

  // Core returns server-relative art paths; absolutize at the client boundary
  // (both fetch and event payloads) so every consumer can drop them into <img src>.
  const abs = (v: string): string => (v.startsWith('/') ? `${baseUrl}${v}` : v);
  const absolutizeFacePreset = (p: CustomFacePreset): CustomFacePreset => ({
    ...p,
    portrait: Object.fromEntries(
      Object.entries(p.portrait).map(([k, v]) => [k, abs(v as string)]),
    ) as CustomFacePreset['portrait'],
    ...(p.full ? { full: abs(p.full) } : {}),
    config: {
      ...p.config,
      baseFrame: abs(p.config.baseFrame),
      ...(p.config.fullBase ? { fullBase: abs(p.config.fullBase) } : {}),
      animations: p.config.animations.map((c) => ({
        ...c,
        ...(c.frames ? { frames: c.frames.map(abs) } : {}),
        ...(c.thumbnail ? { thumbnail: abs(c.thumbnail) } : {}),
      })),
    },
  });

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
        if (msg.event === 'faces.changed') {
          const { presets } = msg.payload as CoreEvents['faces.changed'];
          emit('faces.changed', { presets: presets.map(absolutizeFacePreset) });
        } else if (msg.event === 'videogen.job') {
          // Absolutize the result art URL so consumers can drop it into <video src>.
          const job = msg.payload as CoreEvents['videogen.job'];
          emit(
            'videogen.job',
            job.result ? { ...job, result: { ...job.result, url: abs(job.result.url) } } : job,
          );
        } else if (msg.event) {
          emit(msg.event, msg.payload);
        }
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

    createEndpoint: (input) =>
      post<{ endpoint: CustomEndpointInfo }>('/models/endpoints', input).then((r) => r.endpoint),
    updateEndpoint: (id, patch) =>
      fetch(`${baseUrl}/models/endpoints/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((r) => json<{ endpoint: CustomEndpointInfo }>(r)).then((r) => r.endpoint),
    deleteEndpoint: (id) =>
      fetch(`${baseUrl}/models/endpoints/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    fetchEndpointModels: (id) =>
      post<{ models: string[] }>(`/models/endpoints/${id}/models`).then((r) => r.models),
    testEndpoint: (id) => post<{ ok: boolean; error?: string }>(`/models/endpoints/${id}/test`),

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
    importStatus: () => get<ImportStatus>('/import/status'),

    learningSummary: () => get<LearningSummary>('/learning/summary'),
    learningWeeks: () => get<LearningWeek[]>('/learning/weeks'),
    learningDayTasks: (dayId) => get<LearningTask[]>(`/learning/days/${dayId}/tasks`),
    learningDayNotes: (dayId) => get<{ notes: string | null }>(`/learning/days/${dayId}/notes`),
    importLearningProgress: (progress) =>
      post<ProgressImportResult>('/learning/progress/import', { progress }),
    completeTask: (taskId, done) => post<LearningSummary>(`/learning/tasks/${taskId}/complete`, { done }),
    todayMission: () => get<TodayMission>('/mission/today'),
    completeMissionItem: (itemId, done) => post<TodayMission>(`/mission/items/${itemId}/complete`, { done }),
    reviewQueue: () => get<ReviewItem[]>('/learning/reviews'),
    heatmap: (days) => get<HeatCell[]>(`/learning/heatmap${days ? `?days=${days}` : ''}`),
    generateGuide: (prompt) => post<{ started: true }>('/learning/guides', { prompt }).then(() => undefined),

    listKbSources: () => get<KbSource[]>('/kb/sources'),
    ingestKbSource: (path, opts) => post<{ sourceId: string }>('/kb/sources', { path, ...opts }),
    deleteKbSource: (id) =>
      fetch(`${baseUrl}/kb/sources/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    setKbSourceRead: (id, read) =>
      fetch(`${baseUrl}/kb/sources/${id}/read`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ read }),
      })
        .then((r) => json<{ source: KbSource }>(r))
        .then((r) => r.source),
    hybridSearch: (query, opts) => post<KbSearchHit[]>('/kb/search', { query, ...opts }),
    kbSuggestions: () => get<KbSuggestedSource[]>('/kb/suggestions'),
    kbSourceText: (id, filePath) =>
      get<{ title: string; kind: KbKind; text: string; files?: string[] }>(
        `/kb/sources/${id}/text${filePath ? `?file=${encodeURIComponent(filePath)}` : ''}`,
      ),
    openKbSource: (id) => post<void>(`/kb/sources/${id}/open`),

    listInterviewProblems: (type) =>
      get<InterviewProblemMeta[]>(`/interview/problems${type ? `?type=${type}` : ''}`),
    interviewProblemBySlug: (slug) =>
      get<{ problem: InterviewProblem }>(
        `/interview/problems/by-slug/${encodeURIComponent(slug)}`,
      )
        .then((r) => r.problem)
        .catch((e) => {
          if (e instanceof CoreRequestError && e.status === 404) return null;
          throw e;
        }),
    fetchLeetCodeProblem: (slug) =>
      post<LeetCodeFetchResult>('/interview/lc/fetch', { slug }),
    fetchProblemPage: (url) =>
      post<PageFetchResult>('/interview/page/fetch', { url }),
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
      get<CustomFacePreset[]>('/faces/custom').then((presets) => presets.map(absolutizeFacePreset)),
    createFacePreset: (input) => post<{ job: FaceJobStatus }>('/faces/custom', input),
    generateFacePreset: (input) => post<{ job: FaceJobStatus }>('/faces/custom/generate', input),
    addFaceExpression: (id, input) =>
      post<{ job: FaceJobStatus }>(`/faces/custom/${id}/expressions`, input),
    faceCatalog: () => get<FaceCatalogEntry[]>('/faces/catalog'),
    activeFaceJob: () => get<FaceJobStatus | null>('/faces/jobs/active'),
    cancelFaceJob: (jobId) => post<void>(`/faces/jobs/${jobId}/cancel`),
    deleteFacePreset: (id) =>
      fetch(`${baseUrl}/faces/custom/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    createManualFacePreset: (input) =>
      post<CustomFacePreset>('/faces/custom/manual', input).then(absolutizeFacePreset),
    updateAvatarConfig: (id, input) =>
      fetch(`${baseUrl}/faces/custom/${id}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
        .then((r) => json<CustomFacePreset>(r))
        .then(absolutizeFacePreset),

    imagegenModels: () => get<ImageGenModelInfo[]>('/imagegen/models'),
    imagegenGenerate: (req) => post<{ jobId: string }>('/imagegen/generate', req),
    imagegenJob: (id) =>
      get<ImageGenJobStatus | null>(`/imagegen/jobs/${id}`).then((s) =>
        s && s.result ? { ...s, result: { ...s.result, url: abs(s.result.url) } } : s,
      ),
    imagegenCancel: (id) => post<void>(`/imagegen/jobs/${id}/cancel`),
    imagegenHistory: () =>
      get<ImageGenHistoryItem[]>('/imagegen/history').then((items) =>
        items.map((it) => ({ ...it, url: abs(it.url) })),
      ),
    imagegenDeleteHistory: (id) =>
      fetch(`${baseUrl}/imagegen/history/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),

    videogenModels: () => get<VideoGenModelInfo[]>('/videogen/models'),
    videogenGenerate: (input) => post<{ job: VideoGenJobStatus }>('/videogen/generate', input),
    videogenJob: (id) =>
      get<VideoGenJobStatus | null>(`/videogen/jobs/${id}`).then((s) =>
        s && s.result ? { ...s, result: { ...s.result, url: abs(s.result.url) } } : s,
      ),
    videogenCancelJob: (id) => post<void>(`/videogen/jobs/${id}/cancel`),
    videogenHistory: () =>
      get<VideoGenHistoryEntry[]>('/videogen/history').then((items) =>
        items.map((it) => ({ ...it, url: abs(it.url) })),
      ),
    videogenDeleteHistory: (id) =>
      fetch(`${baseUrl}/videogen/history/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),
    falKeyStatus: () => get<{ keyState: ApiKeyState; keyMask?: string }>('/imagegen/keys/fal'),
    setFalKey: (apiKey) =>
      fetch(`${baseUrl}/imagegen/keys/fal`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      }).then((r) => json<{ keyState: ApiKeyState; keyMask?: string }>(r)),
    clearFalKey: () =>
      fetch(`${baseUrl}/imagegen/keys/fal`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`core request failed: ${r.status}`);
      }),

    getSettings: () => get<AppSettings>('/settings'),
    updateSettings: (patch) => post<AppSettings>('/settings', patch),
    networkAccessInfo: () => get<NetworkAccessInfo>('/network/access-info'),
    listTtsVoices: () => get<TtsVoiceInfo[]>('/voice/voices'),
    voicePreviewUrl: (voiceId) =>
      `${baseUrl}/voice/preview?voice=${encodeURIComponent(voiceId)}`,
    listSttModels: () => get<SttModelInfo[]>('/voice/stt-models'),
    downloadSttModel: (id) =>
      post<void>(`/voice/stt-models/${encodeURIComponent(id)}/download`),

    openVoiceChannel(handlers) {
      const vws = new WebSocket(`${wsBase}/voice`);
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
