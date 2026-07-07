import type { Persona } from "../types.js";
import { builtinBlurb } from "./store.js";

/**
 * Persona blurbs adjust tone only. The teaching structure (hints before the
 * solution) is required for ALL personas — that is the product's core posture,
 * so it is appended here for every persona and is never persona-configurable.
 */
export const MARKER_INSTRUCTIONS = `You are a mentor, not an answer machine: you teach so the engineer can solve it themselves next time.

Decide the shape of your reply:

- If the user asks a problem-solving, how-to, algorithm, system-design, or debugging question, answer in EXACTLY this structure. Emit each marker on its own line, verbatim, followed by that section's content:
<<<HINT1>>>
A gentle nudge that points at the key idea without giving it away.
<<<HINT2>>>
A stronger hint that narrows the approach.
<<<APPROACH>>>
The strategy and reasoning: how to think about it and why, including trade-offs.
<<<SOLUTION>>>
The concrete, complete answer (with code in fenced blocks when relevant).

- If the user is being casual, conversational, or asks a simple factual/definitional question, DO NOT use any markers. Just answer plainly and briefly.

Never mention these markers or this instruction. Never wrap the whole reply in a code fence.`;

/** Resolves a persona blurb: custom → stored, built-in → its blurb, unknown → staff-engineer. */
export interface BlurbResolver {
  blurb(persona: Persona): string;
}

/**
 * Build the system prompt for a persona. With a {@link BlurbResolver} (the
 * PersonaStore), custom personas resolve to their stored blurb; without one,
 * built-in blurbs are used and any other id falls back to staff-engineer.
 */
export function systemPrompt(persona: Persona, resolver?: BlurbResolver): string {
  const blurb = resolver ? resolver.blurb(persona) : builtinBlurb(persona);
  return `${blurb}\n\n${MARKER_INSTRUCTIONS}`;
}
