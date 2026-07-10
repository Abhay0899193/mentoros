import type { ImageGenModelInfo } from "../types.js";
import type { ApiKeyState } from "../types.js";
import { evaluateToolchain, type ToolchainProbe } from "../faces/toolchain.js";
import type { ImageGenToolchainProbe } from "./toolchain.js";

/**
 * The static Image Lab model registry. Each entry carries both the picker
 * metadata ({@link ImageGenModelInfo}) and an internal `backend` discriminator
 * the service dispatches on. Availability is computed per-request from the live
 * toolchain / key probes — the defs here are the immutable catalog.
 */

/** How a model is actually run — picked by the service, never sent to the client. */
export type ImageGenBackend = "z-turbo-local" | "z-turbo-fal" | "kontext-local";

export interface ImageGenModelDef {
  id: string;
  label: string;
  kind: "local" | "hosted";
  desc: string;
  backend: ImageGenBackend;
  requiresReference?: boolean;
  defaultSteps: number;
  maxSteps: number;
}

export const IMAGEGEN_MODELS: readonly ImageGenModelDef[] = [
  {
    id: "z-image-turbo-local",
    label: "Z-Image Turbo (local)",
    kind: "local",
    desc: "Fast local text-to-image on your GPU — no data leaves the machine.",
    backend: "z-turbo-local",
    defaultSteps: 8,
    maxSteps: 12,
  },
  {
    id: "z-image-turbo-fal",
    label: "Z-Image Turbo (fal.ai)",
    kind: "hosted",
    desc: "Same model, hosted on fal.ai — instant, no local weights or GPU.",
    backend: "z-turbo-fal",
    defaultSteps: 8,
    maxSteps: 12,
  },
  {
    id: "flux-kontext-local",
    label: "FLUX Kontext (local edit)",
    kind: "local",
    desc: "Edit a reference image from a prompt — the identity-preserving local model.",
    backend: "kontext-local",
    requiresReference: true,
    defaultSteps: 16,
    maxSteps: 30,
  },
] as const;

/** Resolve a model def by id (unknown → undefined). */
export function findModelDef(id: string): ImageGenModelDef | undefined {
  return IMAGEGEN_MODELS.find((m) => m.id === id);
}

export interface ImageGenAvailability {
  probe: ImageGenToolchainProbe;
  falState: ApiKeyState;
  /** The faces (mflux + FLUX-Kontext) toolchain probe — reused for the edit model. */
  kontextProbe: ToolchainProbe;
}

/** Project the static catalog through the live probes into picker infos. */
export function buildModelInfos(av: ImageGenAvailability): ImageGenModelInfo[] {
  return IMAGEGEN_MODELS.map((def) => modelInfo(def, av));
}

/** One model's live availability info (or undefined for an unknown id). */
export function modelInfoFor(id: string, av: ImageGenAvailability): ImageGenModelInfo | undefined {
  const def = findModelDef(id);
  return def ? modelInfo(def, av) : undefined;
}

function base(def: ImageGenModelDef): ImageGenModelInfo {
  const info: ImageGenModelInfo = {
    id: def.id,
    label: def.label,
    kind: def.kind,
    desc: def.desc,
    defaultSteps: def.defaultSteps,
    maxSteps: def.maxSteps,
    available: false,
  };
  if (def.requiresReference) info.requiresReference = true;
  return info;
}

function modelInfo(def: ImageGenModelDef, av: ImageGenAvailability): ImageGenModelInfo {
  const info = base(def);
  switch (def.backend) {
    case "z-turbo-local": {
      const hasBin = av.probe.hasZTurboBin();
      info.available = hasBin;
      if (!hasBin) {
        info.detail = "mflux (mflux-generate-z-image-turbo) not installed";
      } else if (!av.probe.hasZTurboWeights()) {
        // Bin present: still usable — mflux pulls the weights on first run.
        info.detail = "weights (~20 GB) download on first run";
      }
      return info;
    }
    case "z-turbo-fal": {
      info.available = av.falState === "valid";
      if (!info.available) info.detail = "add a fal.ai API key in Settings";
      return info;
    }
    case "kontext-local": {
      const tc = evaluateToolchain(av.kontextProbe);
      info.available = tc.state === "ready";
      if (!info.available) info.detail = tc.detail ?? "local toolchain unavailable";
      return info;
    }
  }
}
