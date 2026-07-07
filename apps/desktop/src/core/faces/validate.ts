import type { CreateFacePresetInput, FaceRegion } from "../types.js";

/**
 * Input validation for POST /faces/custom (→ HTTP 422 with a designed body).
 * Image decoding/dimensions come from an injected {@link ImageProbe} so the
 * validation matrix is unit testable without real files.
 */

export class FaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceValidationError";
  }
}

export const MIN_SHORT_SIDE = 768;

export interface ImageDims {
  width: number;
  height: number;
}
/** Returns dimensions, or null when the path is missing/unreadable/undecodable. */
export type ImageProbe = (path: string) => ImageDims | null;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function normalizeRegion(value: unknown, label: string): FaceRegion {
  if (!value || typeof value !== "object") {
    throw new FaceValidationError(`${label} region is required`);
  }
  const r = value as Record<string, unknown>;
  if (![r.x, r.y, r.width, r.height].every(isFiniteNumber)) {
    throw new FaceValidationError(`${label} region must have numeric x, y, width, height`);
  }
  const region = { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number };
  if (region.width <= 0 || region.height <= 0) {
    throw new FaceValidationError(`${label} region must have positive width and height`);
  }
  if (region.x < 0 || region.y < 0) {
    throw new FaceValidationError(`${label} region must be inside the image`);
  }
  return region;
}

function assertInside(r: FaceRegion, dims: ImageDims, label: string): void {
  if (r.x + r.width > dims.width || r.y + r.height > dims.height) {
    throw new FaceValidationError(`${label} region falls outside the image bounds`);
  }
}

/**
 * Validate + normalize a create payload. Throws {@link FaceValidationError} on
 * any bad field. Returns a clean CreateFacePresetInput plus the probed portrait
 * dimensions (so the caller can compute the crop without re-probing).
 */
export function validateCreateInput(
  input: unknown,
  probe: ImageProbe,
): { input: CreateFacePresetInput; portraitDims: ImageDims } {
  if (!input || typeof input !== "object") {
    throw new FaceValidationError("payload must be an object");
  }
  const o = input as Record<string, unknown>;

  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (name.length < 1 || name.length > 60) {
    throw new FaceValidationError("name must be 1-60 characters");
  }

  if (typeof o.portraitPath !== "string" || o.portraitPath.trim().length === 0) {
    throw new FaceValidationError("portraitPath is required");
  }
  const portraitPath = o.portraitPath;
  const portraitDims = probe(portraitPath);
  if (!portraitDims) {
    throw new FaceValidationError("portrait photo could not be read — use a JPEG, PNG or WebP");
  }
  if (Math.min(portraitDims.width, portraitDims.height) < MIN_SHORT_SIDE) {
    throw new FaceValidationError(
      `portrait is too small — at least ${MIN_SHORT_SIDE}px on the short side`,
    );
  }

  const mouth = normalizeRegion(o.mouth, "mouth");
  const eyes = normalizeRegion(o.eyes, "eyes");
  assertInside(mouth, portraitDims, "mouth");
  assertInside(eyes, portraitDims, "eyes");
  // Mouth sits below the eyes (centre-to-centre) — guards a swapped picker.
  if (mouth.y + mouth.height / 2 <= eyes.y + eyes.height / 2) {
    throw new FaceValidationError("mouth region must be below the eyes region");
  }

  const clean: CreateFacePresetInput = { name, portraitPath, mouth, eyes };

  if (o.fullPath !== undefined && o.fullPath !== null && o.fullPath !== "") {
    if (typeof o.fullPath !== "string") {
      throw new FaceValidationError("fullPath must be a string");
    }
    if (!probe(o.fullPath)) {
      throw new FaceValidationError("full-body photo could not be read");
    }
    clean.fullPath = o.fullPath;
  }

  return { input: clean, portraitDims };
}
