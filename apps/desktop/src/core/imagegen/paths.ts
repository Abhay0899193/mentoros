import { join } from "node:path";

/**
 * On-disk + URL layout for Image Lab output. Everything lives under the core's
 * data dir so it shares the SQLite root; the renderer never sees these paths —
 * it gets server-relative `/imagegen/art/<file>` URLs it absolutizes.
 *
 * Unlike face art, these files are write-once (one per job id, never
 * overwritten), so the art route uses a plain immutable long cache.
 */

/** `<userData>/imagegen` — one PNG per finished job + a `.tmp` scratch dir. */
export function imagegenRoot(dataDir: string): string {
  return join(dataDir, "imagegen");
}

/** Decoded reference images (edit models) land here before the CLI reads them. */
export function imagegenTmpDir(dataDir: string): string {
  return join(imagegenRoot(dataDir), ".tmp");
}

/** Only bare `<uuid>.png` names may be served (path-traversal guard). */
export const SAFE_IMAGEGEN_FILE = /^[0-9a-fA-F-]+\.png$/;
