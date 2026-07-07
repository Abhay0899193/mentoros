import type { OllamaMessage } from "../ollama.js";
import type { PersonaDraft, PersonaDraftRequest, PersonaStyle } from "../types.js";
import { isPersonaStyle } from "./store.js";

/**
 * "Draft it for me" (§Settings → Personas): a short free-text description is
 * turned by the model into persona fields the user reviews/edits before saving.
 * Runs on the scorecard routing surface (cloud-capable, local llama3.1 is the
 * fallback via the router). Strict JSON parse; anything unusable → {@link
 * PersonaDraftError} → HTTP 502, mirroring the interview importer.
 *
 * The blurb describes TONE/PERSONALITY only — never instructions about hints,
 * solutions, or output format (those are the non-configurable teaching ladder).
 */

/** A single non-streaming completion routed through the scorecard surface. */
export type PersonaDraftOnce = (opts: {
  messages: OllamaMessage[];
  format?: "json";
  timeoutMs?: number;
}) => Promise<string>;

/** Thrown when the model returns output we cannot turn into a draft (→ HTTP 502). */
export class PersonaDraftError extends Error {
  constructor(
    message = "the model returned an unusable persona draft — try again",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "PersonaDraftError";
  }
}

function systemPrompt(): string {
  return [
    "You draft a mentor PERSONA from a short description. Output a single strict JSON object ONLY — no prose, no markdown fences.",
    "",
    "The JSON MUST have exactly this shape:",
    "{",
    '  "name": string,        // 1-60 chars, a concise mentor name (e.g. "Priya — FAANG Staff")',
    '  "tagline": string,     // <=120 chars, one-line role summary shown under the name',
    '  "style": "strict" | "balanced" | "supportive",   // coaching stance',
    '  "domains": string[],   // up to 8 short focus areas (each <=40 chars, e.g. "distributed systems", "DP")',
    '  "blurb": string        // SECOND PERSON, <=120 words. Tone, personality, and background ONLY.',
    "}",
    "",
    'The blurb must begin like "You are ..." and describe HOW this mentor speaks and what they care about. NEVER include instructions about hints, solutions, answer format, or teaching structure — those are handled separately. No emojis.',
    "Return the JSON object and nothing else.",
  ].join("\n");
}

/**
 * Extract the first balanced JSON object from a model response (tolerating code
 * fences and surrounding prose), respecting string literals and escapes.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Coerce + clamp a parsed JSON object into a valid PersonaDraft, honoring any
 * user-fixed name/style. Throws {@link PersonaDraftError} only when the blurb is
 * unusable (too short to be a real persona) — everything else is clamped.
 */
export function clampDraft(
  o: Record<string, unknown>,
  req: PersonaDraftRequest,
): PersonaDraft {
  const fixedName = req.name?.trim();
  const rawName = typeof o.name === "string" ? o.name.trim() : "";
  const name = (fixedName || rawName || "Custom Mentor").slice(0, 60);

  const fixedStyle: PersonaStyle | undefined = isPersonaStyle(req.style)
    ? req.style
    : undefined;
  const style: PersonaStyle =
    fixedStyle ?? (isPersonaStyle(o.style) ? o.style : "balanced");

  const tagline = (typeof o.tagline === "string" ? o.tagline.trim() : "").slice(0, 120);

  const domains = Array.isArray(o.domains)
    ? o.domains
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
        .slice(0, 8)
        .map((d) => d.slice(0, 40))
    : [];

  const blurb = (typeof o.blurb === "string" ? o.blurb.trim() : "").slice(0, 1200);
  if (blurb.length < 20) {
    throw new PersonaDraftError(undefined, "blurb was empty or too short");
  }

  const draft: PersonaDraft = { name, tagline, style, domains, blurb };
  return draft;
}

/** Ask the model once for a persona draft. Strict parse; unusable → PersonaDraftError. */
export async function generatePersonaDraft(
  req: PersonaDraftRequest,
  once: PersonaDraftOnce,
): Promise<PersonaDraft> {
  const constraints: string[] = [];
  if (req.name?.trim()) constraints.push(`Use exactly this name: "${req.name.trim()}".`);
  if (isPersonaStyle(req.style)) constraints.push(`Use exactly this style: "${req.style}".`);

  const raw = await once({
    messages: [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: [
          "Draft a mentor persona from this description:",
          "",
          req.description,
          ...(constraints.length ? ["", ...constraints] : []),
        ].join("\n"),
      },
    ],
    format: "json",
    timeoutMs: 60_000,
  });

  const jsonText = extractFirstJsonObject(raw);
  if (!jsonText) throw new PersonaDraftError(undefined, "no JSON object in the model output");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new PersonaDraftError(undefined, "model output was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PersonaDraftError(undefined, "model output was not a JSON object");
  }
  return clampDraft(parsed as Record<string, unknown>, req);
}
