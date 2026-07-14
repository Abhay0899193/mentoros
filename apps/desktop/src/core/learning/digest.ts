import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CANDIDATES } from "./importer.js";

/**
 * Content-fingerprint of a 3mc source tree — the inputs `import3mc` actually
 * reads, so a changed source is detectable without touching the DB. Pure fs, no
 * Electron, no SQLite (so boot auto-sync can compare cheaply).
 *
 * Covered inputs:
 *   - the plan JSON (study-ui/data/parsed-plan.json | study-ui/public/study-plan.json)
 *   - PHASE-* /week-* /day-*.md (per-day study notes)
 *   - SKILLS-TRACK/*.md (quick-review sheets)
 *   - STUDY-GUIDES/**\/*.md (deep guides — recursive; subfolders land later)
 *
 * Digest = sha1 over sorted `${relPath}:${mtimeMs}:${size}` lines. Returns null
 * when the root or the plan file is missing (nothing to sync against).
 */
export function computeSourceDigest(root: string): string | null {
  if (!existsSync(root)) return null;
  const planFiles = CANDIDATES.map((rel) => join(root, rel)).filter((p) =>
    existsSync(p),
  );
  if (planFiles.length === 0) return null;

  const files = [
    ...planFiles,
    ...collectDayDocs(root),
    ...collectFlatMd(join(root, "SKILLS-TRACK")),
    ...collectMdRecursive(join(root, "STUDY-GUIDES")),
  ];

  const lines: string[] = [];
  for (const abs of files) {
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; /* vanished between listing and stat */
    }
    const rel = relative(root, abs).split(sep).join("/");
    lines.push(`${rel}:${st.mtimeMs}:${st.size}`);
  }
  lines.sort();
  return createHash("sha1").update(lines.join("\n")).digest("hex");
}

/** PHASE-* / week-* / day-*.md — the per-day markdown bodies. */
function collectDayDocs(root: string): string[] {
  const out: string[] = [];
  for (const phase of dirNames(root, /^PHASE-/)) {
    const phaseDir = join(root, phase);
    for (const week of dirNames(phaseDir, /^week-/)) {
      const weekDir = join(phaseDir, week);
      for (const entry of entries(weekDir)) {
        if (entry.isFile() && /^day-.*\.md$/.test(entry.name)) {
          out.push(join(weekDir, entry.name));
        }
      }
    }
  }
  return out;
}

/** Flat `*.md` immediately inside a directory (SKILLS-TRACK today). */
function collectFlatMd(dir: string): string[] {
  return entries(dir)
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(dir, e.name));
}

/** Recursive `**\/*.md` under a directory (STUDY-GUIDES, subfolders coming). */
function collectMdRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of entries(dir)) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMdRecursive(abs));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

function entries(dir: string): import("node:fs").Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; /* dir absent */
  }
}

function dirNames(dir: string, pattern: RegExp): string[] {
  return entries(dir)
    .filter((e) => e.isDirectory() && pattern.test(e.name))
    .map((e) => e.name);
}
