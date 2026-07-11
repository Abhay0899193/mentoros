import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { videogenBin, videogenHfCache } from "./paths.js";

/**
 * Local Video Lab toolchain probe. The LTX-2.3 backend shells out to the
 * mlx-video `mlx_video.generate_av` entrypoint inside a dedicated venv
 * (`~/mentoros-imagegen/video-env`), with the model + text-encoder weights in
 * the shared HF cache (`~/mentoros-imagegen/hf-cache`). Presence checks are
 * injected so the available/detail logic is unit testable without a real
 * ~30 GB install.
 */

/** LTX-2.3 22B distilled, MLX q4 "split" format (by the package author). */
export const VIDEO_MODEL_REPO = "notapalindrome/ltx23-mlx-av-q4";
const VIDEO_MODEL_DIR = "models--notapalindrome--ltx23-mlx-av-q4";
/** Text encoder is NOT bundled — generation dies at load without it. */
export const VIDEO_ENCODER_REPO = "mlx-community/gemma-3-12b-it-4bit";
const VIDEO_ENCODER_DIR = "models--mlx-community--gemma-3-12b-it-4bit";

export interface VideoGenToolchainProbe {
  /** `mlx_video.generate_av` exists and is executable inside the video venv. */
  hasGenerateBin(): boolean;
  /** LTX-2.3 model snapshot materialized in the shared HF cache. */
  hasModelWeights(): boolean;
  /** gemma-3 text-encoder snapshot materialized in the shared HF cache. */
  hasEncoderWeights(): boolean;
}

/** True when `path` exists and carries the executable bit. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** A usable HF snapshot dir for `modelDir` under `hub` (≥1 materialized snapshot). */
function hasSnapshot(hub: string, modelDir: string): boolean {
  const snapshots = join(hub, modelDir, "snapshots");
  if (!existsSync(snapshots)) return false;
  try {
    return readdirSync(snapshots).some((s) => {
      try {
        return readdirSync(join(snapshots, s)).length > 0;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Production probe rooted at the user's home directory. Weights live only in our
 * own HF_HOME (`~/mentoros-imagegen/hf-cache/hub`) — the video model/encoder are
 * pulled there by the venv, never into the default cache.
 */
export function defaultVideoGenProbe(home: string = homedir()): VideoGenToolchainProbe {
  const hub = join(videogenHfCache(home), "hub");
  const bin = videogenBin(home);
  return {
    hasGenerateBin: () => isExecutable(bin),
    hasModelWeights: () => hasSnapshot(hub, VIDEO_MODEL_DIR),
    hasEncoderWeights: () => hasSnapshot(hub, VIDEO_ENCODER_DIR),
  };
}
