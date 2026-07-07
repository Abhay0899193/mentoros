import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateFacePresetInput } from "../types.js";
import { ellipseFor, type CropResult } from "./crop.js";
import { FRAME_FILES } from "./paths.js";
import type { FaceOps } from "./ops.js";

/**
 * The per-preset generation pipeline (§ "What generation actually does"). Pure
 * orchestration over the injected {@link FaceOps}: prep base → 4 Kontext edits
 * (m2 → m1-from-m2 → m3 → blink) → anti-drift composite → cwebp encode →
 * optional full body → accent. Every step SKIPS when its output already exists,
 * so a re-submitted (same-source) job resumes where a cancel/crash stopped it.
 */

export const TOTAL_FRAMES = 4;

// Action-first g4.0 prompts (tools/faces/PROMPTS.md + gen_m1_from_m2.sh). m1 is
// derived FROM m2 (subtle direct-parting prompts no-op or artifact).
const M2_PROMPT =
  "Open her mouth mid-speech as if saying 'ah', with the upper teeth just visible, natural relaxed expression.";
const M3_PROMPT =
  "Open her mouth wide mid-word as if speaking expressively, upper teeth visible, natural.";
const M1_PROMPT =
  "Close her mouth most of the way so her lips are relaxed and nearly touching, leaving only a small soft gap between them, no teeth visible.";
const BLINK_PROMPT = "Close her eyes gently, relaxed eyelids with natural eyelashes.";

interface EditSpec {
  key: "m1" | "m2" | "m3" | "blink";
  from: "base" | "m2";
  prompt: string;
  step: string;
  region: "mouth" | "eyes";
}

// Order matters: m2 first (m1 derives from it), then m3, then blink.
const EDITS: EditSpec[] = [
  { key: "m2", from: "base", prompt: M2_PROMPT, step: "Mouth frame 2 of 3", region: "mouth" },
  { key: "m1", from: "m2", prompt: M1_PROMPT, step: "Mouth frame 1 of 3", region: "mouth" },
  { key: "m3", from: "base", prompt: M3_PROMPT, step: "Mouth frame 3 of 3", region: "mouth" },
  { key: "blink", from: "base", prompt: BLINK_PROMPT, step: "Blink frame", region: "eyes" },
];

export interface RunnerProgress {
  state: "generating" | "compositing";
  step: string;
  completedFrames: number;
}

export interface RunFaceJobParams {
  ops: FaceOps;
  crop: CropResult;
  input: CreateFacePresetInput;
  artDir: string;
  workDir: string;
  seed: number;
  signal: AbortSignal;
  report: (p: RunnerProgress) => void;
}

export interface RunFaceJobResult {
  accent: string;
  hasFull: boolean;
}

/** Skip a step when its output already exists (resume); otherwise produce it. */
async function ensure(outPath: string, produce: () => Promise<void>): Promise<void> {
  if (existsSync(outPath)) return;
  await produce();
}

export async function runFaceJob(params: RunFaceJobParams): Promise<RunFaceJobResult> {
  const { ops, crop, input, artDir, workDir, seed, signal, report } = params;
  mkdirSync(workDir, { recursive: true });
  mkdirSync(artDir, { recursive: true });

  const work = (f: string): string => join(workDir, f);
  const art = (f: string): string => join(artDir, f);
  const metaPath = work("meta.json");

  /* 1 — prep base (crop → 1024² + accent). */
  report({ state: "generating", step: "Preparing base", completedFrames: 0 });
  let accent: string;
  if (existsSync(work("base.png")) && existsSync(metaPath)) {
    accent = readAccent(metaPath);
  } else {
    const out = await ops.prepBase(input.portraitPath, crop.crop, work("base.png"), signal);
    accent = out.accent;
    writeFileSync(metaPath, JSON.stringify({ accent }));
  }

  /* 2 — 4 Kontext edits. */
  let completed = 0;
  for (const edit of EDITS) {
    report({ state: "generating", step: edit.step, completedFrames: completed });
    const source = edit.from === "m2" ? work("kontext-m2.png") : work("base.png");
    await ensure(work(`kontext-${edit.key}.png`), () =>
      ops.kontextEdit(source, work(`kontext-${edit.key}.png`), edit.prompt, seed, signal),
    );
    completed += 1;
  }

  /* 3 — anti-drift composite + 4 — cwebp encode. */
  report({ state: "compositing", step: "Compositing frames", completedFrames: TOTAL_FRAMES });
  await ensure(art(FRAME_FILES.base), () => ops.encodeWebp(work("base.png"), art(FRAME_FILES.base), signal));
  for (const edit of EDITS) {
    const region = edit.region === "mouth" ? crop.mouth : crop.eyes;
    await ensure(work(`comp-${edit.key}.png`), () =>
      ops.composite(work("base.png"), work(`kontext-${edit.key}.png`), ellipseFor(region), work(`comp-${edit.key}.png`), signal),
    );
    await ensure(art(FRAME_FILES[edit.key]), () =>
      ops.encodeWebp(work(`comp-${edit.key}.png`), art(FRAME_FILES[edit.key]), signal),
    );
  }

  /* 5 — optional full body (no edits, just crop + encode). */
  let hasFull = false;
  if (input.fullPath) {
    report({ state: "compositing", step: "Preparing full body", completedFrames: TOTAL_FRAMES });
    await ensure(work("full.png"), () => ops.fullBody(input.fullPath!, work("full.png"), signal));
    await ensure(art(FRAME_FILES.full), () => ops.encodeWebp(work("full.png"), art(FRAME_FILES.full), signal));
    hasFull = true;
  }

  return { accent, hasFull };
}

function readAccent(metaPath: string): string {
  try {
    const j = JSON.parse(readFileSync(metaPath, "utf8")) as { accent?: unknown };
    if (typeof j.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(j.accent)) return j.accent;
  } catch {
    /* fall through */
  }
  return "#8a8f98";
}
