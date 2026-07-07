import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FaceToolchainStatus } from "../types.js";

/**
 * Local image-gen toolchain probe (GET /faces/toolchain). The pipeline shells
 * out to mflux + FLUX-Kontext + cwebp + uv kept under ~/mentoros-imagegen; when
 * any piece is absent, Settings shows a designed setup state instead of the
 * create flow. The presence checks are injected so the ready/missing/detail
 * logic is unit testable without a real install.
 */

export const KONTEXT_BIN = "mflux-generate-kontext";
export const KONTEXT_MODEL = "akx/FLUX.1-Kontext-dev-mflux-4bit";
const KONTEXT_MODEL_DIR = "models--akx--FLUX.1-Kontext-dev-mflux-4bit";

export interface ToolchainProbe {
  /** mflux-generate-kontext resolvable (in ~/.local/bin or on PATH). */
  hasKontextBin(): boolean;
  /** A complete Kontext model snapshot present in the HF cache. */
  hasKontextModel(): boolean;
  /** cwebp encoder present. */
  hasCwebp(): boolean;
  /** uv present (runs the pillow crop/composite steps). */
  hasUv(): boolean;
}

/** Compute the ready/missing status + a human detail naming what is absent. */
export function evaluateToolchain(probe: ToolchainProbe): FaceToolchainStatus {
  const missing: string[] = [];
  if (!probe.hasKontextBin()) missing.push("mflux (mflux-generate-kontext) not installed");
  if (!probe.hasKontextModel()) missing.push("FLUX-Kontext weights absent from the HF cache");
  if (!probe.hasCwebp()) missing.push("cwebp encoder not installed");
  if (!probe.hasUv()) missing.push("uv not installed");
  if (missing.length === 0) return { state: "ready" };
  return { state: "missing", detail: missing.join("; ") };
}

/** True when a binary is on PATH or in ~/.local/bin. */
function binOnPath(name: string, home: string): boolean {
  if (existsSync(join(home, ".local", "bin", name))) return true;
  const probe = spawnSync("which", [name], { stdio: ["ignore", "ignore", "ignore"] });
  return probe.status === 0;
}

/** Production probe rooted at the user's home directory. */
export function defaultToolchainProbe(home: string = homedir()): ToolchainProbe {
  const hfHub = join(home, "mentoros-imagegen", "hf-cache", "hub");
  return {
    hasKontextBin: () => binOnPath(KONTEXT_BIN, home),
    hasKontextModel: () => {
      const snapshots = join(hfHub, KONTEXT_MODEL_DIR, "snapshots");
      if (!existsSync(snapshots)) return false;
      try {
        // A usable snapshot has the diffusion transformer materialized.
        return readdirSync(snapshots).some((s) =>
          existsSync(join(snapshots, s, "transformer")),
        );
      } catch {
        return false;
      }
    },
    hasCwebp: () => binOnPath("cwebp", home),
    hasUv: () => binOnPath("uv", home),
  };
}
