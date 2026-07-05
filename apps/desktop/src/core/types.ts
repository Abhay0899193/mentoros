/**
 * Core-side mirror of the renderer contract in
 * `src/renderer/lib/coreClient.ts`. These types MUST stay in lock-step with
 * that file (the lead agent owns it); do not diverge.
 */

export type Persona = "staff-engineer" | "interviewer" | "teacher" | "architect";

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

/** STT/TTS sidecar readiness (mirror of coreClient VoiceStatus). */
export interface VoiceStatus {
  stt: "ready" | "missing" | "starting" | "error";
  tts: "ready" | "missing" | "starting" | "error";
  detail?: string;
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
}
