import { coreClient } from '../../lib/coreClient';
import type { ConversationEvent } from '../../lib/coreClient';

/**
 * Renderer-wide avatar event bus — the trigger engine's spine.
 *
 * Core stores trigger RULES as data but has no event stream to evaluate them
 * against; the renderer owns every source the rule kinds need (voice-loop
 * transitions, the chat token stream, timers). Publishers push semantic
 * events here; each mounted AnimationController subscribes and matches its
 * preset's rules. Adding a future rule kind = one evaluator entry in
 * controller.ts — no changes to storage or this bus.
 */

export type AvatarEvent =
  | { type: 'conversation'; event: ConversationEvent }
  | { type: 'userMessage'; text: string }
  | { type: 'assistantMessage'; text: string }
  | { type: 'manual'; animationId: string }
  | { type: 'api'; animationId: string };

type Subscriber = (evt: AvatarEvent) => void;

const subscribers = new Set<Subscriber>();

export function publishAvatarEvent(evt: AvatarEvent): void {
  wireOnce();
  for (const fn of subscribers) fn(evt);
}

export function subscribeAvatarEvents(fn: Subscriber): () => void {
  wireOnce();
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Programmatic playback (the 'api' trigger kind). Same-process call — any
 * mounted avatar whose preset has an enabled api rule for this clip plays it.
 */
export function playAvatarAnimation(animationId: string): void {
  publishAvatarEvent({ type: 'api', animationId });
}

/* ------------------- assistant-message completion tap -------------------- */
// Accumulate assistant text from the shared chat stream (both Chat and Voice
// ride the same chat.token events) and publish one assistantMessage per
// completed generation for textMatch triggers.

let wired = false;
const pending = new Map<string, string>();

function wireOnce(): void {
  if (wired) return;
  wired = true;
  coreClient.on('chat.token', ({ messageId, token }) => {
    if (subscribers.size === 0) return;
    pending.set(messageId, (pending.get(messageId) ?? '') + token);
  });
  coreClient.on('chat.status', ({ messageId, phase }) => {
    if (phase === 'done') {
      const text = pending.get(messageId);
      if (text) publishAvatarEvent({ type: 'assistantMessage', text });
    }
    if (phase === 'done' || phase === 'error' || phase === 'stopped') pending.delete(messageId);
  });
}
