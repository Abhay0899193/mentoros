import type { VideoGenModelInfo } from "../types.js";
import type { VideoGenToolchainProbe } from "./toolchain.js";

/**
 * The static Video Lab model registry. Each entry carries both the picker
 * metadata ({@link VideoGenModelInfo}) and an internal `backend` discriminator
 * the service dispatches on. Availability is computed per-request from the live
 * toolchain probe — the defs here are the immutable catalog.
 *
 * Only `ltx-local` is live today; `wan-local` (T2V fallback) and `ltx-fal`
 * (hosted, seconds-fast) slot in later behind the same shape.
 */

/** How a model is actually run — picked by the service, never sent to the client. */
export type VideoGenBackend = "ltx-local" | "wan-local" | "ltx-fal";

export interface VideoGenModelDef {
  id: string;
  label: string;
  kind: "local" | "hosted";
  desc: string;
  backend: VideoGenBackend;
  supportsImageInput: boolean;
  defaultFrames: number;
  defaultFps: number;
}

export const VIDEOGEN_MODELS: readonly VideoGenModelDef[] = [
  {
    id: "ltx-local",
    label: "LTX-2.3 (local)",
    kind: "local",
    desc: "Local text- and image-to-video with audio — ~80–90 s per 2 s 512² clip on your GPU, no data leaves the machine.",
    backend: "ltx-local",
    supportsImageInput: true,
    defaultFrames: 49,
    defaultFps: 24,
  },
] as const;

/** Resolve a model def by id (unknown → undefined). */
export function findModelDef(id: string): VideoGenModelDef | undefined {
  return VIDEOGEN_MODELS.find((m) => m.id === id);
}

export interface VideoGenAvailability {
  probe: VideoGenToolchainProbe;
}

/** Project the static catalog through the live probe into picker infos. */
export function buildModelInfos(av: VideoGenAvailability): VideoGenModelInfo[] {
  return VIDEOGEN_MODELS.map((def) => modelInfo(def, av));
}

/** One model's live availability info (or undefined for an unknown id). */
export function modelInfoFor(id: string, av: VideoGenAvailability): VideoGenModelInfo | undefined {
  const def = findModelDef(id);
  return def ? modelInfo(def, av) : undefined;
}

function base(def: VideoGenModelDef): VideoGenModelInfo {
  return {
    id: def.id,
    label: def.label,
    kind: def.kind,
    desc: def.desc,
    supportsImageInput: def.supportsImageInput,
    defaultFrames: def.defaultFrames,
    defaultFps: def.defaultFps,
    available: false,
  };
}

function modelInfo(def: VideoGenModelDef, av: VideoGenAvailability): VideoGenModelInfo {
  const info = base(def);
  switch (def.backend) {
    case "ltx-local": {
      const gaps: string[] = [];
      if (!av.probe.hasGenerateBin()) gaps.push("mlx-video (video-env) not installed");
      if (!av.probe.hasModelWeights()) gaps.push("LTX-2.3 weights (~23 GB) not downloaded");
      if (!av.probe.hasEncoderWeights()) gaps.push("gemma-3 text encoder (~8 GB) not downloaded");
      info.available = gaps.length === 0;
      if (gaps.length) info.detail = gaps.join("; ");
      return info;
    }
    case "wan-local":
    case "ltx-fal":
      // Not yet in the catalog — placeholder branches keep the switch exhaustive.
      info.detail = "coming soon";
      return info;
  }
}
