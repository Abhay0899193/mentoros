import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AvatarConfig,
  ExpressionGroup,
  ExpressionGroupOrCustom,
  FaceRegion,
  GenerateFacePresetInput,
  PresetGenerationMeta,
  RegionSource,
} from "../types.js";
import {
  buildGeneratedConfig,
  catalogEntry,
  CORE_KEYS,
  DEFAULT_REGIONS_1024,
  type BuiltCustomExpression,
} from "./catalog.js";
import { ellipseFor } from "./crop.js";
import type { FaceOps } from "./ops.js";

/**
 * The Preset-Generator pipelines (t2i, beside the photo/Kontext {@link runFaceJob}).
 * Pure orchestration over the injected {@link FaceOps}: a chosen base candidate
 * plus per-expression z-image-turbo renders (same character seed + a per-frame
 * clause) → auto-detect composite windows → anti-drift feathered-ellipse paste →
 * cwebp. Every step SKIPS when its output exists, so a re-submitted (same-source)
 * job resumes where a cancel/crash stopped it.
 */

const CANVAS = 1024;

export interface GenerateProgress {
  state: "generating" | "compositing";
  step: string;
  completedFrames: number;
}

/** One resolved frame the generator produces (catalog key OR custom expression). */
export interface ResolvedExpr {
  /** Catalog key or custom id — unique within the run. */
  key: string;
  clipId: string;
  /** Bare webp this expression writes (portrait-mX or anim-<clipId>-0). */
  frameFile: string;
  name: string;
  group: ExpressionGroupOrCustom;
  /** Trailing z-turbo expression clause (character prompt is prepended at gen time). */
  clause: string;
  seed: number;
  /** Composite window for a custom-group expression (1024² space). */
  region?: FaceRegion;
  isCore: boolean;
  isCustom: boolean;
}

/**
 * Expand a validated generate input into the concrete frame list: the four core
 * frames (m1/m2/m3/blink) always, plus every chosen catalog emotion / custom
 * expression. Every frame reuses `baseSeed` (the proven same-seed recipe).
 */
export function resolveGenerateExpressions(input: GenerateFacePresetInput, baseSeed: number): ResolvedExpr[] {
  const out: ResolvedExpr[] = [];
  const seen = new Set<string>();
  for (const key of CORE_KEYS) {
    const e = catalogEntry(key)!;
    out.push({ key, clipId: e.clipId, frameFile: e.frameFile, name: e.name, group: e.group, clause: e.t2iClause, seed: baseSeed, isCore: true, isCustom: false });
    seen.add(key);
  }
  for (const spec of input.expressions) {
    if (spec.key) {
      if (seen.has(spec.key)) continue; // core already added / duplicate
      const e = catalogEntry(spec.key);
      if (!e) continue;
      out.push({ key: spec.key, clipId: e.clipId, frameFile: e.frameFile, name: e.name, group: e.group, clause: spec.prompt ?? e.t2iClause, seed: baseSeed, isCore: false, isCustom: false });
      seen.add(spec.key);
    } else if (spec.id) {
      if (seen.has(spec.id)) continue;
      const group = spec.group ?? "custom";
      const expr: ResolvedExpr = {
        key: spec.id,
        clipId: spec.id,
        frameFile: `anim-${spec.id}-0.webp`,
        name: spec.name ?? spec.id,
        group,
        clause: spec.prompt ?? "",
        seed: baseSeed,
        isCore: false,
        isCustom: true,
      };
      if (spec.region) expr.region = spec.region;
      out.push(expr);
      seen.add(spec.id);
    }
  }
  return out;
}

/* ------------------------------- generate --------------------------------- */

export interface RunGeneratePresetParams {
  ops: FaceOps;
  presetId: string;
  name: string;
  characterPrompt: string;
  baseSeed: number;
  /** Absolute path of the chosen base candidate (history PNG or decoded data URI). */
  baseImagePath: string;
  /** Manual composite windows that override auto-detect (1024² space). */
  manualRegions?: { mouth?: FaceRegion; eyes?: FaceRegion; face?: FaceRegion };
  expressions: ResolvedExpr[];
  artDir: string;
  workDir: string;
  now: string;
  signal: AbortSignal;
  report: (p: GenerateProgress) => void;
}

export interface RunGeneratePresetResult {
  accent: string;
  config: AvatarConfig;
}

interface GroupRegion {
  region: FaceRegion;
  source: RegionSource;
}

/** Skip a step when its output already exists (resume); otherwise produce it. */
async function ensure(outPath: string, produce: () => Promise<void>): Promise<void> {
  if (existsSync(outPath)) return;
  await produce();
}

export async function runGeneratePresetJob(params: RunGeneratePresetParams): Promise<RunGeneratePresetResult> {
  const { ops, expressions, artDir, workDir, signal, report } = params;
  mkdirSync(workDir, { recursive: true });
  mkdirSync(artDir, { recursive: true });
  const work = (f: string): string => join(workDir, f);
  const art = (f: string): string => join(artDir, f);
  const genFile = (e: ResolvedExpr): string => work(`gen-${e.key}-${e.seed}.png`);

  /* 1 — normalize the chosen base candidate to a 1024² PNG. */
  report({ state: "generating", step: "Preparing base", completedFrames: 0 });
  await ensure(work("base.png"), () => ops.normalizeBase(params.baseImagePath, work("base.png"), signal));

  /* 2 — accent (face-region mean, like the Kiki recipe). */
  const faceRegion = params.manualRegions?.face ?? DEFAULT_REGIONS_1024.face;
  const accentPath = work("accent.json");
  let accent: string;
  if (existsSync(accentPath)) {
    accent = readAccent(accentPath);
  } else {
    accent = await ops.accent(work("base.png"), faceRegion, signal);
    writeFileSync(accentPath, JSON.stringify({ accent }));
  }

  /* 3 — per-expression z-image-turbo render (shared character seed + clause). */
  const total = expressions.length;
  let completed = 0;
  for (const e of expressions) {
    report({ state: "generating", step: `Rendering ${e.name} (${completed + 1} of ${total})`, completedFrames: completed });
    await ensure(genFile(e), () =>
      ops.zTurboGenerate(genFile(e), `${params.characterPrompt} ${e.clause}`.trim(), e.seed, CANVAS, CANVAS, signal),
    );
    completed += 1;
  }

  /* 4 — resolve composite windows (manual override → auto-detect → default). */
  report({ state: "compositing", step: "Detecting regions", completedFrames: total });
  const regions = await resolveRegions(params, expressions, genFile, signal);

  /* 5 — anti-drift composite + cwebp (base first, then each expression). */
  report({ state: "compositing", step: "Compositing frames", completedFrames: total });
  await ensure(art("portrait-base.webp"), () => ops.encodeWebp(work("base.png"), art("portrait-base.webp"), signal));
  for (const e of expressions) {
    const region = regionForExpr(e, regions);
    const comp = work(`comp-${e.key}-${e.seed}.png`);
    await ensure(comp, () => ops.composite(work("base.png"), genFile(e), ellipseFor(region), comp, signal, true));
    await ensure(art(e.frameFile), () => ops.encodeWebp(comp, art(e.frameFile), signal));
  }

  /* 6 — assemble config + generation provenance. */
  const emotions = expressions.filter((e) => !e.isCore && !e.isCustom).map((e) => e.key);
  const customs: BuiltCustomExpression[] = expressions
    .filter((e) => e.isCustom)
    .map((e) => ({ clipId: e.clipId, name: e.name }));

  const generation: PresetGenerationMeta = {
    method: "z-turbo-t2i",
    characterPrompt: params.characterPrompt,
    baseSeed: params.baseSeed,
    regions: { mouth: regions.mouth.region, eyes: regions.eyes.region, face: regions.face.region },
    regionSource: dominantSource(regions),
    expressions: expressions.map((e) => {
      const region = regionForExpr(e, regions);
      return { clipId: e.clipId, prompt: e.clause, group: e.group, region, seed: e.seed };
    }),
  };

  const config = buildGeneratedConfig({
    presetId: params.presetId,
    name: params.name,
    accent,
    now: params.now,
    emotions,
    customs,
    generation,
  });
  return { accent, config };
}

/** mouth←m2, eyes←blink, face←first emotion; manual wins, default is the net. */
async function resolveRegions(
  params: RunGeneratePresetParams,
  expressions: ResolvedExpr[],
  genFile: (e: ResolvedExpr) => string,
  signal: AbortSignal,
): Promise<{ mouth: GroupRegion; eyes: GroupRegion; face: GroupRegion }> {
  const rep = (pred: (e: ResolvedExpr) => boolean): ResolvedExpr | undefined => expressions.find(pred);
  const mouth = await detectRegionFor(params, "mouth", params.manualRegions?.mouth, rep((e) => e.key === "m2"), genFile, signal);
  const eyes = await detectRegionFor(params, "eyes", params.manualRegions?.eyes, rep((e) => e.key === "blink"), genFile, signal);
  const face = await detectRegionFor(params, "face", params.manualRegions?.face, rep((e) => e.group === "face"), genFile, signal);
  return { mouth, eyes, face };
}

async function detectRegionFor(
  params: RunGeneratePresetParams,
  group: ExpressionGroup,
  manual: FaceRegion | undefined,
  sample: ResolvedExpr | undefined,
  genFile: (e: ResolvedExpr) => string,
  signal: AbortSignal,
): Promise<GroupRegion> {
  if (manual) return { region: manual, source: "manual" };
  const fallback = DEFAULT_REGIONS_1024[group];
  if (!sample) return { region: fallback, source: "default" };
  const base = join(params.workDir, "base.png");
  const detected = await params.ops.detectRegion(base, genFile(sample), fallback, fallback, signal);
  return { region: detected.region, source: detected.source };
}

function regionForExpr(e: ResolvedExpr, regions: { mouth: GroupRegion; eyes: GroupRegion; face: GroupRegion }): FaceRegion {
  if (e.group === "custom") return e.region ?? DEFAULT_REGIONS_1024.face;
  return regions[e.group].region;
}

/** Precedence for the single meta.regionSource: manual > auto > default. */
function dominantSource(regions: { mouth: GroupRegion; eyes: GroupRegion; face: GroupRegion }): RegionSource {
  const sources = [regions.mouth.source, regions.eyes.source, regions.face.source];
  if (sources.includes("manual")) return "manual";
  if (sources.includes("auto")) return "auto";
  return "default";
}

/* ---------------------------- add expression ------------------------------ */

/** A single resolved add-expression frame the runner produces. */
export interface AddExprSpec {
  clipId: string;
  frameFile: string;
  group: ExpressionGroupOrCustom;
  /** t2i clause OR Kontext prompt (already picked by the service per method). */
  prompt: string;
  seed: number;
  /** Explicit composite window (custom group / manual override). */
  region?: FaceRegion;
}

export interface RunAddExpressionParams {
  ops: FaceOps;
  method: PresetGenerationMeta["method"];
  /** Shared character clause (t2i only). */
  characterPrompt?: string;
  spec: AddExprSpec;
  /** Stored group regions for a generated preset (reused, no re-detect). */
  regionsMeta?: PresetGenerationMeta["regions"];
  /** Absolute path of the preset base frame (art/portrait-base.webp). */
  baseFramePath: string;
  artDir: string;
  workDir: string;
  signal: AbortSignal;
  report: (p: GenerateProgress) => void;
}

export interface RunAddExpressionResult {
  frameFile: string;
  clipId: string;
  region: FaceRegion;
  regionSource: RegionSource;
  seed: number;
}

export async function runAddExpressionJob(params: RunAddExpressionParams): Promise<RunAddExpressionResult> {
  const { ops, spec, signal, report } = params;
  mkdirSync(params.workDir, { recursive: true });
  mkdirSync(params.artDir, { recursive: true });
  const work = (f: string): string => join(params.workDir, f);
  const art = (f: string): string => join(params.artDir, f);

  /* 1 — recover a working PNG base from the (webp) preset base frame. */
  report({ state: "generating", step: `Rendering ${spec.clipId}`, completedFrames: 0 });
  const base = work(`base-${spec.clipId}.png`);
  await ensure(base, () => ops.normalizeBase(params.baseFramePath, base, signal));

  /* 2 — generate the frame (t2i for generated presets, Kontext for photo). */
  const gen = work(`gen-${spec.clipId}-${spec.seed}.png`);
  if (params.method === "z-turbo-t2i") {
    await ensure(gen, () => ops.zTurboGenerate(gen, `${params.characterPrompt ?? ""} ${spec.prompt}`.trim(), spec.seed, CANVAS, CANVAS, signal));
  } else {
    await ensure(gen, () => ops.kontextEdit(base, gen, spec.prompt, spec.seed, signal));
  }

  /* 3 — resolve the composite window. */
  let region: FaceRegion;
  let source: RegionSource;
  if (spec.region) {
    region = spec.region;
    source = "manual";
  } else if (spec.group !== "custom" && params.regionsMeta) {
    region = params.regionsMeta[spec.group];
    source = "auto";
  } else {
    const group: ExpressionGroup = spec.group === "custom" ? "face" : spec.group;
    const fallback = DEFAULT_REGIONS_1024[group];
    const detected = await ops.detectRegion(base, gen, fallback, fallback, signal);
    region = detected.region;
    source = detected.source;
  }

  /* 4 — anti-drift composite + cwebp (overwrite the frame on regenerate). */
  report({ state: "compositing", step: `Compositing ${spec.clipId}`, completedFrames: 0 });
  const comp = work(`comp-${spec.clipId}-${spec.seed}.png`);
  await ensure(comp, () => ops.composite(base, gen, ellipseFor(region), comp, signal, true));
  await ops.encodeWebp(comp, art(spec.frameFile), signal);

  return { frameFile: spec.frameFile, clipId: spec.clipId, region, regionSource: source, seed: spec.seed };
}

/* -------------------------------- helpers --------------------------------- */

function readAccent(path: string): string {
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as { accent?: unknown };
    if (typeof j.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(j.accent)) return j.accent;
  } catch {
    /* fall through */
  }
  return "#8a8f98";
}
