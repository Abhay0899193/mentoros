import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Local Image Lab toolchain probe. The z-image-turbo backend shells out to the
 * mflux CLI (`mflux-generate-z-image-turbo`, shipped alongside the
 * `mflux-generate-kontext` the faces pipeline already uses) with weights in the
 * HF cache. Presence checks are injected so the available/detail logic is unit
 * testable without a real install.
 */

export const Z_TURBO_BIN = "mflux-generate-z-image-turbo";
const Z_TURBO_MODEL_DIR = "models--Tongyi-MAI--Z-Image-Turbo";

export interface ImageGenToolchainProbe {
  /** mflux-generate-z-image-turbo resolvable (in ~/.local/bin or on PATH). */
  hasZTurboBin(): boolean;
  /** Z-Image-Turbo weights materialized in either watched HF cache. */
  hasZTurboWeights(): boolean;
}

/** True when a binary is on PATH or in ~/.local/bin (mirror of the faces probe). */
function binOnPath(name: string, home: string): boolean {
  if (existsSync(join(home, ".local", "bin", name))) return true;
  const probe = spawnSync("which", [name], { stdio: ["ignore", "ignore", "ignore"] });
  return probe.status === 0;
}

/** A usable HF snapshot dir for `modelDir` under `hub` (has ≥1 materialized snapshot). */
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
 * Production probe rooted at the user's home directory. Weights are searched in
 * BOTH our own HF_HOME (~/mentoros-imagegen/hf-cache/hub, see faces/toolchain)
 * and the default HF cache (~/.cache/huggingface/hub) — mflux may have pulled
 * Z-Image-Turbo into either.
 */
export function defaultImageGenProbe(home: string = homedir()): ImageGenToolchainProbe {
  const hubs = [
    join(home, "mentoros-imagegen", "hf-cache", "hub"),
    join(home, ".cache", "huggingface", "hub"),
  ];
  return {
    hasZTurboBin: () => binOnPath(Z_TURBO_BIN, home),
    hasZTurboWeights: () => hubs.some((h) => hasSnapshot(h, Z_TURBO_MODEL_DIR)),
  };
}
