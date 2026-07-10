import type { ImageGenRequest } from "../types.js";
import type { ImageGenModelDef } from "./models.js";

/** Bad generation input (→ HTTP 422 with a designed body). */
export class ImageGenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenValidationError";
  }
}

const MIN_DIM = 512;
const MAX_DIM = 2048;
const DIM_STEP = 16;
const MAX_PROMPT = 2000;

/**
 * Validate + normalize a generate request against the chosen model. Dimensions
 * must be in [512, 2048] and multiples of 16; steps in 1..model.maxSteps; edit
 * models require a reference data URI. Returns a clean {@link ImageGenRequest};
 * seed resolution (randomize / default) happens in the service.
 */
export function validateGenerateInput(body: unknown, model: ImageGenModelDef): ImageGenRequest {
  if (typeof body !== "object" || body === null) {
    throw new ImageGenValidationError("request body must be an object");
  }
  const b = body as Record<string, unknown>;

  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (!prompt) throw new ImageGenValidationError("prompt is required");
  if (prompt.length > MAX_PROMPT) {
    throw new ImageGenValidationError(`prompt must be ≤ ${MAX_PROMPT} characters`);
  }

  const width = dimension(b.width, "width");
  const height = dimension(b.height, "height");

  const steps = integer(b.steps, "steps");
  if (steps < 1 || steps > model.maxSteps) {
    throw new ImageGenValidationError(`steps must be between 1 and ${model.maxSteps}`);
  }

  const randomizeSeed = b.randomizeSeed === true;
  const req: ImageGenRequest = {
    modelId: model.id,
    prompt,
    width,
    height,
    steps,
    randomizeSeed,
  };

  if (!randomizeSeed && b.seed !== undefined && b.seed !== null) {
    const seed = integer(b.seed, "seed");
    if (seed < 0 || seed > 0xffffffff) {
      throw new ImageGenValidationError("seed must be a uint32 (0..4294967295)");
    }
    req.seed = seed;
  }

  if (model.requiresReference) {
    if (typeof b.referenceDataUri !== "string" || !b.referenceDataUri.startsWith("data:image/")) {
      throw new ImageGenValidationError("this model requires a reference image");
    }
    req.referenceDataUri = b.referenceDataUri;
  } else if (typeof b.referenceDataUri === "string" && b.referenceDataUri.startsWith("data:image/")) {
    // Optional reference on a non-edit model is accepted but ignored downstream.
    req.referenceDataUri = b.referenceDataUri;
  }

  return req;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ImageGenValidationError(`${field} must be an integer`);
  }
  return value;
}

function dimension(value: unknown, field: string): number {
  const n = integer(value, field);
  if (n < MIN_DIM || n > MAX_DIM) {
    throw new ImageGenValidationError(`${field} must be between ${MIN_DIM} and ${MAX_DIM}`);
  }
  if (n % DIM_STEP !== 0) {
    throw new ImageGenValidationError(`${field} must be a multiple of ${DIM_STEP}`);
  }
  return n;
}
