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
}
