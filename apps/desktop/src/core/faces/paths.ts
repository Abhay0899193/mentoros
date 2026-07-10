import { join } from "node:path";

/**
 * On-disk + URL layout for custom face art. Everything lives under the core's
 * data dir so it shares the SQLite root; the renderer never sees these paths —
 * it gets server-relative `/faces/art/...` URLs it absolutizes.
 */

/** `<userData>/faces` — one sub-dir per preset id. */
export function facesRoot(dataDir: string): string {
  return join(dataDir, "faces");
}

export function presetDir(dataDir: string, presetId: string): string {
  return join(facesRoot(dataDir), presetId);
}

/** Intermediate PNGs (base crop, Kontext edits, composites) for skip-if-exists. */
export function workDir(dataDir: string, presetId: string): string {
  return join(presetDir(dataDir, presetId), "work");
}

/** The five portrait sprite frames + optional full body, keyed by logical name. */
export const FRAME_FILES = {
  base: "portrait-base.webp",
  m1: "portrait-m1.webp",
  m2: "portrait-m2.webp",
  m3: "portrait-m3.webp",
  blink: "portrait-blink.webp",
  full: "full.webp",
} as const;

/** Only these ids/files may be served (path-traversal guard). */
export const SAFE_PRESET_ID = /^face-[a-z0-9][a-z0-9-]*$/;
/**
 * Legacy sprite frames + optional full body + generic animation frames
 * (`anim-<clipId>-<idx>.webp`). Bare filenames only — no directory separators.
 */
export const SAFE_ART_FILE =
  /^(portrait-(base|m1|m2|m3|blink)|full|anim-[a-z0-9][a-z0-9-]*-\d+)\.webp$/;
