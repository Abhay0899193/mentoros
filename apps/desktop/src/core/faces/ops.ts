import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CropRect } from "./crop.js";
import { KONTEXT_BIN, KONTEXT_MODEL } from "./toolchain.js";
import type { ImageDims, ImageProbe } from "./validate.js";

/**
 * The injected side-effect seam for the generation pipeline. Everything the
 * runner shells out to lives behind this interface so tests fake mflux/cwebp/uv
 * with instant scripts, and a dev-only fast path can swap the GPU step.
 *
 *   - prepBase / composite / fullBody run through `uv run --with pillow`
 *   - kontextEdit is the ~10-13 min GPU step (mflux-generate-kontext)
 *   - encodeWebp shells cwebp -q 82
 */
export interface FaceOps {
  /** Crop the portrait to a 1024² PNG and sample its accent hex. */
  prepBase(portraitPath: string, crop: CropRect, outPng: string, signal: AbortSignal): Promise<{ accent: string }>;
  /** One identity-preserving Kontext edit (mouth aperture / blink). */
  kontextEdit(inPng: string, outPng: string, prompt: string, seed: number, signal: AbortSignal): Promise<void>;
  /** Feathered-ellipse paste of an edit back onto the base (anti-drift). */
  composite(basePng: string, editPng: string, ellipse: { cx: number; cy: number; rx: number; ry: number }, outPng: string, signal: AbortSignal): Promise<void>;
  /** Crop a full-body photo to 2:3, longest side ≤1536, → PNG. */
  fullBody(fullPath: string, outPng: string, signal: AbortSignal): Promise<void>;
  /** cwebp -q 82. */
  encodeWebp(inPath: string, outWebp: string, signal: AbortSignal): Promise<void>;
}

/* ---------------------------- process helpers ----------------------------- */

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; signal: AbortSignal },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) {
      reject(new FaceAbortError());
      return;
    }
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const onAbort = (): void => {
      child.kill("SIGKILL");
    };
    opts.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (err) => {
      opts.signal.removeEventListener("abort", onAbort);
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${cmd} not found`)
          : err,
      );
    });
    child.on("close", (code) => {
      opts.signal.removeEventListener("abort", onAbort);
      if (opts.signal.aborted) {
        reject(new FaceAbortError());
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Thrown when a step is killed by cancellation — the runner maps it to 'cancelled'. */
export class FaceAbortError extends Error {
  constructor() {
    super("cancelled");
    this.name = "FaceAbortError";
  }
}

/* ------------------------------ real FaceOps ------------------------------ */

export interface RealFaceOpsConfig {
  home?: string;
  /** Swap the GPU step for an instant tinted copy of the base (MENTOROS_FACES_FAKE=1). */
  fakeGeneration?: boolean;
}

/**
 * Production ops. Writes an embedded pillow helper into a per-run scripts dir
 * and shells uv/mflux/cwebp. When `fakeGeneration`, kontextEdit tints the base
 * instead of spawning mflux — real webp frames in seconds for UI verification
 * with no GPU (the frames still differ per aperture so lip-sync visibly cycles).
 */
export function createRealFaceOps(scriptsDir: string, config: RealFaceOpsConfig = {}): FaceOps {
  const home = config.home ?? homedir();
  const localBin = join(home, ".local", "bin");
  const hfHome = join(home, "mentoros-imagegen", "hf-cache");
  const pyPath = join(scriptsDir, "pipeline.py");
  let pyWritten = false;
  const ensurePy = (): string => {
    if (!pyWritten) {
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(pyPath, PIPELINE_PY);
      pyWritten = true;
    }
    return pyPath;
  };
  const uv = (args: string[], signal: AbortSignal): Promise<RunResult> =>
    run("uv", ["run", "--with", "pillow", "python", ensurePy(), ...args], {
      env: { PATH: `${localBin}:${process.env.PATH ?? ""}` },
      signal,
    });
  const check = (r: RunResult, what: string): void => {
    if (r.code !== 0) throw new Error(`${what} failed: ${lastLine(r.stderr) || r.stdout || `exit ${r.code}`}`);
  };

  return {
    async prepBase(portraitPath, crop, outPng, signal) {
      const r = await uv(
        ["prep", portraitPath, String(crop.x), String(crop.y), String(crop.size), outPng],
        signal,
      );
      check(r, "base crop");
      const accent = parseAccent(r.stdout);
      return { accent };
    },
    async kontextEdit(inPng, outPng, prompt, seed, signal) {
      if (config.fakeGeneration) {
        // Tint the base by a per-variant amount so the sprite frames differ.
        // Index by the prompt too — the seed is job-constant, and m2/m3 share
        // the same source frame, so seed-only picks identical tints for them.
        let promptHash = 0;
        for (let i = 0; i < prompt.length; i++) promptHash = (promptHash * 31 + prompt.charCodeAt(i)) >>> 0;
        const tint = TINTS[(seed + promptHash) % TINTS.length] ?? TINTS[0]!;
        const r = await uv(["tint", inPng, outPng, ...tint.map(String)], signal);
        check(r, "fake edit");
        return;
      }
      const r = await run(
        localBinOr(localBin, KONTEXT_BIN),
        [
          "--model", KONTEXT_MODEL,
          "--base-model", "dev",
          "--image-path", inPng,
          "--prompt", prompt,
          "--steps", "16",
          "--guidance", "4.0",
          "--seed", String(seed),
          "--width", "1024",
          "--height", "1024",
          "--output", outPng,
        ],
        { env: { HF_HOME: hfHome, HF_HUB_DISABLE_XET: "1", PATH: `${localBin}:${process.env.PATH ?? ""}` }, signal },
      );
      check(r, "Kontext edit");
    },
    async composite(basePng, editPng, ellipse, outPng, signal) {
      const r = await uv(
        ["composite", basePng, editPng, String(ellipse.cx), String(ellipse.cy), String(ellipse.rx), String(ellipse.ry), outPng],
        signal,
      );
      check(r, "composite");
    },
    async fullBody(fullPath, outPng, signal) {
      const r = await uv(["full", fullPath, outPng], signal);
      check(r, "full-body crop");
    },
    async encodeWebp(inPath, outWebp, signal) {
      const r = await run(localBinOr(localBin, "cwebp"), ["-q", "82", inPath, "-o", outWebp], { signal });
      check(r, "webp encode");
    },
  };
}

/* ------------------------------ image probe ------------------------------- */

/**
 * Default image dimension probe (validation). Uses macOS `sips`, which is
 * native, instant and treats undecodable files as an error → null. Injected in
 * production; tests supply a fake.
 */
export const sipsProbe: ImageProbe = (path: string): ImageDims | null => {
  try {
    const r = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path], {
      encoding: "utf8",
    });
    if (r.status !== 0 || !r.stdout) return null;
    const w = /pixelWidth:\s*(\d+)/.exec(r.stdout);
    const h = /pixelHeight:\s*(\d+)/.exec(r.stdout);
    if (!w || !h) return null;
    return { width: Number(w[1]), height: Number(h[1]) };
  } catch {
    return null;
  }
};

/* -------------------------------- helpers --------------------------------- */

const TINTS: number[][] = [
  [255, 210, 180], // warm — m2
  [200, 220, 255], // cool — m1
  [255, 190, 210], // pink — m3
  [180, 255, 210], // green — blink
];

function localBinOr(localBin: string, name: string): string {
  // Prefer the explicit ~/.local/bin copy the toolchain installs; otherwise let
  // spawn resolve `name` on PATH.
  const local = join(localBin, name);
  return existsSync(local) ? local : name;
}

function lastLine(text: string): string {
  const parts = text.trim().split("\n").filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : "";
}

function parseAccent(stdout: string): string {
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const j = JSON.parse(line) as { accent?: unknown };
      if (typeof j.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(j.accent)) return j.accent;
    } catch {
      /* keep scanning */
    }
  }
  return "#8a8f98";
}

/* ------------------------- embedded pillow pipeline ----------------------- */

export const PIPELINE_PY = String.raw`import sys, json
from PIL import Image, ImageDraw, ImageFilter

def prep(portrait, cx, cy, size, out):
    im = Image.open(portrait).convert("RGB")
    box = (cx, cy, cx + size, cy + size)
    im = im.crop(box).resize((1024, 1024), Image.LANCZOS)
    im.save(out)
    small = im.resize((16, 16), Image.LANCZOS)
    px = list(small.getdata())
    n = len(px)
    r = sum(p[0] for p in px) // n
    g = sum(p[1] for p in px) // n
    b = sum(p[2] for p in px) // n
    print(json.dumps({"accent": "#%02x%02x%02x" % (r, g, b)}), flush=True)

def composite(base_p, edit_p, cx, cy, rx, ry, out):
    base = Image.open(base_p).convert("RGB")
    edit = Image.open(edit_p).convert("RGB")
    if edit.size != base.size:
        edit = edit.resize(base.size, Image.LANCZOS)
    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(10))
    base.paste(edit, (0, 0), mask)
    base.save(out)

def full(full_p, out):
    im = Image.open(full_p).convert("RGB")
    w, h = im.size
    # centre-crop to a 2:3 (w:h) portrait
    target = 2.0 / 3.0
    if w / h > target:
        nw = int(round(h * target)); x = (w - nw) // 2
        im = im.crop((x, 0, x + nw, h))
    else:
        nh = int(round(w / target)); y = (h - nh) // 2
        im = im.crop((0, y, w, y + nh))
    w, h = im.size
    longest = max(w, h)
    if longest > 1536:
        s = 1536.0 / longest
        im = im.resize((int(round(w * s)), int(round(h * s))), Image.LANCZOS)
    im.save(out)

def tint(inp, out, r, g, b):
    im = Image.open(inp).convert("RGB")
    layer = Image.new("RGB", im.size, (int(r), int(g), int(b)))
    im = Image.blend(im, layer, 0.28)
    im.save(out)

def main():
    cmd = sys.argv[1]
    a = sys.argv[2:]
    if cmd == "prep":
        prep(a[0], int(a[1]), int(a[2]), int(a[3]), a[4])
    elif cmd == "composite":
        composite(a[0], a[1], int(a[2]), int(a[3]), int(a[4]), int(a[5]), a[6])
    elif cmd == "full":
        full(a[0], a[1])
    elif cmd == "tint":
        tint(a[0], a[1], a[2], a[3], a[4])
    else:
        sys.exit("unknown command: " + cmd)

main()
`;
