import type { VideoGenRequest } from "../types.js";
import type { VideoGenModelDef } from "./models.js";

/** Bad generation input (→ HTTP 422 with a designed body). */
export class VideoGenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoGenValidationError";
  }
}

const MAX_PROMPT = 2000;
/** width/height must divide 64; out-of-range values clamp into [MIN,MAX]. */
const DIM_STEP = 64;
const MIN_DIM = 256;
const MAX_DIM = 1024;
const DEFAULT_DIM = 512;
/** num-frames must be `1 + 8k`; out-of-range values clamp into [MIN,MAX]. */
const FRAME_STEP = 8;
const MIN_FRAMES = 9;
const MAX_FRAMES = 121;
const DEFAULT_FRAMES = 49;
const MIN_FPS = 8;
const MAX_FPS = 30;
const DEFAULT_FPS = 24;

const IMAGE_PREFIXES = ["data:image/png", "data:image/jpeg", "data:image/webp"];

/**
 * Validate + normalize a generate request against the chosen model. Dimensions
 * must be multiples of 64 (then clamp to [256, 1024], default 512); num-frames
 * must be `1 + 8k` (then clamp to [9, 121], default 49); fps clamps to [8, 30]
 * (default 24). A `data:image/...` `image` is accepted for I2V and rejected on
 * models without image input. Seed resolution happens in the service.
 */
export function validateGenerateInput(body: unknown, model: VideoGenModelDef): VideoGenRequest {
  if (typeof body !== "object" || body === null) {
    throw new VideoGenValidationError("request body must be an object");
  }
  const b = body as Record<string, unknown>;

  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (!prompt) throw new VideoGenValidationError("prompt is required");
  if (prompt.length > MAX_PROMPT) {
    throw new VideoGenValidationError(`prompt must be ≤ ${MAX_PROMPT} characters`);
  }

  const width = dimension(b.width, "width");
  const height = dimension(b.height, "height");
  const numFrames = frames(b.numFrames);
  const fps = clamp(optionalInteger(b.fps, "fps") ?? DEFAULT_FPS, MIN_FPS, MAX_FPS);

  const randomizeSeed = b.randomizeSeed === true;
  const req: VideoGenRequest = {
    modelId: model.id,
    prompt,
    width,
    height,
    numFrames,
    fps,
    randomizeSeed,
  };

  if (!randomizeSeed && b.seed !== undefined && b.seed !== null) {
    const seed = integer(b.seed, "seed");
    if (seed < 0 || seed > 0xffffffff) {
      throw new VideoGenValidationError("seed must be a uint32 (0..4294967295)");
    }
    req.seed = seed;
  }

  if (b.image !== undefined && b.image !== null && b.image !== "") {
    if (typeof b.image !== "string" || !IMAGE_PREFIXES.some((p) => (b.image as string).startsWith(p))) {
      throw new VideoGenValidationError("image must be a png/jpeg/webp data URI");
    }
    if (!model.supportsImageInput) {
      throw new VideoGenValidationError("this model does not support an image input");
    }
    req.image = b.image;
  }

  return req;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new VideoGenValidationError(`${field} must be an integer`);
  }
  return value;
}

/** An optional integer field (absent → undefined; present → must be an integer). */
function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return integer(value, field);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A multiple-of-64 dimension (default 512), clamped to [256, 1024]. */
function dimension(value: unknown, field: string): number {
  const n = optionalInteger(value, field);
  if (n === undefined) return DEFAULT_DIM;
  if (n % DIM_STEP !== 0) {
    throw new VideoGenValidationError(`${field} must be a multiple of ${DIM_STEP}`);
  }
  return clamp(n, MIN_DIM, MAX_DIM);
}

/** A `1 + 8k` frame count (default 49), clamped to [9, 121]. */
function frames(value: unknown): number {
  const n = optionalInteger(value, "numFrames");
  if (n === undefined) return DEFAULT_FRAMES;
  if ((n - 1) % FRAME_STEP !== 0) {
    throw new VideoGenValidationError("numFrames must be 1 plus a multiple of 8 (e.g. 49)");
  }
  return clamp(n, MIN_FRAMES, MAX_FRAMES);
}
