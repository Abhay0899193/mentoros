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
}
