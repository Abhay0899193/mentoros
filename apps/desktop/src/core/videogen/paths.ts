import { homedir } from "node:os";
import { join } from "node:path";

/**
 * On-disk + URL layout for Video Lab output. Finished clips live under the
 * core's data dir (shared SQLite root); the renderer never sees these paths — it
 * gets server-relative `/videogen/art/<file>` URLs it absolutizes.
 *
 * The toolchain (venv binary + HF weights) is a sibling of the Image Lab
 * toolchain under `~/mentoros-imagegen` — video generation reuses the same
 * HF_HOME cache so downloaded encoders/models are shared.
 *
 * Clips are write-once (one mp4 per job id, never overwritten), so the art route
 * uses a plain immutable long cache.
 */

/** `<userData>/videogen` — art dir (mp4s) + a `.tmp` scratch dir for I2V frames. */
export function videogenRoot(dataDir: string): string {
  return join(dataDir, "videogen");
}

/** `<userData>/videogen/art` — one `<uuid>.mp4` per finished job. */
export function videogenArtDir(dataDir: string): string {
  return join(videogenRoot(dataDir), "art");
}

/** Decoded I2V source images land here (as PNG) before the CLI reads them. */
export function videogenTmpDir(dataDir: string): string {
  return join(videogenRoot(dataDir), ".tmp");
}

/** `~/mentoros-imagegen` — shared with the Image Lab toolchain. */
export function videogenHome(home: string = homedir()): string {
  return join(home, "mentoros-imagegen");
}

/** The mlx-video (av) entrypoint inside the video venv. */
export function videogenBin(home: string = homedir()): string {
  return join(videogenHome(home), "video-env", "bin", "mlx_video.generate_av");
}

/** Shared HF cache (HF_HOME) — model + encoder snapshots download here. */
export function videogenHfCache(home: string = homedir()): string {
  return join(videogenHome(home), "hf-cache");
}

/** Only bare `<uuid>.mp4` names may be served (path-traversal guard). */
export const SAFE_VIDEOGEN_FILE = /^[0-9a-fA-F-]+\.mp4$/;
