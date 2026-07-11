import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CropRect } from "./crop.js";
import { KONTEXT_BIN, KONTEXT_MODEL } from "./toolchain.js";
import { Z_TURBO_BIN, Z_TURBO_MODEL } from "../imagegen/toolchain.js";
import type { FaceRegion } from "../types.js";
import type { ImageDims, ImageProbe } from "./validate.js";

/** An auto-detected composite window plus whether detection fell back to the default. */
export interface DetectedRegion {
  region: FaceRegion;
  source: "auto" | "default";
}

/**
 * The injected side-effect seam for the generation pipeline. Everything the
 * runner shells out to lives behind this interface so tests fake mflux/cwebp/uv
 * with instant scripts, and a dev-only fast path can swap the GPU step.
 *
 *   - prepBase / normalizeBase / composite / detectRegion / accent / fullBody
 *     run through `uv run --with pillow`
 *   - kontextEdit is the ~10-13 min GPU step (mflux-generate-kontext, photo path)
 *   - zTurboGenerate is the ~100s GPU step (mflux-generate-z-image-turbo, t2i path)
 *   - encodeWebp shells cwebp -q 82
 */
export interface FaceOps {
  /** Crop the portrait to a 1024² PNG and sample its accent hex. */
  prepBase(portraitPath: string, crop: CropRect, outPng: string, signal: AbortSignal): Promise<{ accent: string }>;
  /** One identity-preserving Kontext edit (mouth aperture / blink). */
  kontextEdit(inPng: string, outPng: string, prompt: string, seed: number, signal: AbortSignal): Promise<void>;
  /** One z-image-turbo text-to-image render (Preset Generator t2i frame). */
  zTurboGenerate(outPng: string, prompt: string, seed: number, width: number, height: number, signal: AbortSignal): Promise<void>;
  /** Normalize any base candidate (png/webp/jpg) to a 1024² RGB PNG. */
  normalizeBase(srcPath: string, outPng: string, signal: AbortSignal): Promise<void>;
  /**
   * Feathered-ellipse paste of an edit back onto the base (anti-drift). When
   * `align`, a coarse-to-fine SAD shift is estimated and applied first (t2i path).
   */
  composite(basePng: string, editPng: string, ellipse: { cx: number; cy: number; rx: number; ry: number }, outPng: string, signal: AbortSignal, align?: boolean): Promise<void>;
  /** Diff-based auto-detect of the changed region (edit vs base) inside a zone. */
  detectRegion(basePng: string, editPng: string, zone: FaceRegion, fallback: FaceRegion, signal: AbortSignal): Promise<DetectedRegion>;
  /** Mean-color accent hex over a region (or the whole image when null). */
  accent(imgPng: string, region: FaceRegion | null, signal: AbortSignal): Promise<string>;
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
    async zTurboGenerate(outPng, prompt, seed, width, height, signal) {
      if (config.fakeGeneration) {
        // No GPU: paint a solid seed/prompt-derived tint so frames visibly differ
        // and the pipeline exercises composite/encode end-to-end (region detect
        // then falls back to the group default — see PIPELINE_PY detect guard).
        let promptHash = 0;
        for (let i = 0; i < prompt.length; i++) promptHash = (promptHash * 31 + prompt.charCodeAt(i)) >>> 0;
        const tint = TINTS[(seed + promptHash) % TINTS.length] ?? TINTS[0]!;
        const r = await uv(["blank", outPng, ...tint.map(String), String(width), String(height)], signal);
        check(r, "fake generate");
        return;
      }
      const r = await run(
        localBinOr(localBin, Z_TURBO_BIN),
        [
          "--model", Z_TURBO_MODEL,
          "--base-model", "z-image-turbo",
          "--prompt", prompt,
          "--width", String(width),
          "--height", String(height),
          "--steps", "8",
          "--seed", String(seed),
          "--output", outPng,
        ],
        { env: { HF_HOME: hfHome, HF_HUB_DISABLE_XET: "1", PATH: `${localBin}:${process.env.PATH ?? ""}` }, signal },
      );
      check(r, "z-image-turbo generate");
    },
    async normalizeBase(srcPath, outPng, signal) {
      const r = await uv(["base", srcPath, outPng], signal);
      check(r, "base prep");
    },
    async composite(basePng, editPng, ellipse, outPng, signal, align) {
      const r = await uv(
        [
          "composite", basePng, editPng,
          String(ellipse.cx), String(ellipse.cy), String(ellipse.rx), String(ellipse.ry),
          outPng, align ? "1" : "0",
        ],
        signal,
      );
      check(r, "composite");
    },
    async detectRegion(basePng, editPng, zone, fallback, signal) {
      const r = await uv(
        [
          "detect", basePng, editPng,
          String(zone.x), String(zone.y), String(zone.width), String(zone.height),
          String(fallback.x), String(fallback.y), String(fallback.width), String(fallback.height),
        ],
        signal,
      );
      check(r, "region detect");
      return parseDetect(r.stdout, fallback);
    },
    async accent(imgPng, region, signal) {
      const args = region
        ? [String(region.x), String(region.y), String(region.width), String(region.height)]
        : [];
      const r = await uv(["accent", imgPng, ...args], signal);
      check(r, "accent");
      return parseAccent(r.stdout);
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

/** Parse the last JSON line printed by the `detect` subcommand; else fall back. */
export function parseDetect(stdout: string, fallback: FaceRegion): DetectedRegion {
  for (const raw of stdout.split("\n").reverse()) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const j = JSON.parse(line) as Partial<FaceRegion> & { source?: unknown };
      if (
        typeof j.x === "number" && typeof j.y === "number" &&
        typeof j.width === "number" && typeof j.height === "number" &&
        j.width > 0 && j.height > 0
      ) {
        const region: FaceRegion = { x: j.x, y: j.y, width: j.width, height: j.height };
        return { region, source: j.source === "auto" ? "auto" : "default" };
      }
    } catch {
      /* keep scanning */
    }
  }
  return { region: fallback, source: "default" };
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

def base_prep(src, out):
    im = Image.open(src).convert("RGB")
    if im.size != (1024, 1024):
        im = im.resize((1024, 1024), Image.LANCZOS)
    im.save(out)

def sad(a, b):
    pa, pb = a.load(), b.load()
    w, h = a.size
    total = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            total += abs(pa[x, y] - pb[x, y])
    return total

def estimate_shift(base, edit, exclude):
    """Coarse-to-fine global translation (edit -> base), excluding the edited
    region from the match. Returns (dx, dy) to shift edit by, in natural px.
    Ported verbatim from finalize_kiki.py (SAD, tie-break toward zero)."""
    cx, cy, rx, ry = exclude
    best = (0, 0)
    for size, radius in ((160, 8), (512, 3)):
        s = size / base.size[0]
        bg = base.resize((size, size)).convert("L")
        eg = edit.resize((size, size)).convert("L")
        # mask out the edited region by painting both with mid-gray
        box = (int((cx - rx) * s) - 2, int((cy - ry) * s) - 2,
               int((cx + rx) * s) + 2, int((cy + ry) * s) + 2)
        for im in (bg, eg):
            ImageDraw.Draw(im).rectangle(box, fill=128)
        center = (round(best[0] * s), round(best[1] * s)) if size != 160 else (0, 0)
        scores = {}
        m = radius + max(abs(center[0]), abs(center[1]))
        bc = bg.crop((m, m, size - m, size - m))
        for dy in range(center[1] - radius, center[1] + radius + 1):
            for dx in range(center[0] - radius, center[0] + radius + 1):
                ec = eg.crop((m + dx, m + dy, size - m + dx, size - m + dy))
                scores[(dx, dy)] = sad(bc, ec) + (abs(dx) + abs(dy))  # tie-break toward 0
        (dx, dy) = min(scores, key=scores.get)
        best = (dx / s, dy / s)
    return (round(best[0]), round(best[1]))

def composite(base_p, edit_p, cx, cy, rx, ry, out, align=False):
    base = Image.open(base_p).convert("RGB")
    edit = Image.open(edit_p).convert("RGB")
    if edit.size != base.size:
        edit = edit.resize(base.size, Image.LANCZOS)
    if align:
        dx, dy = estimate_shift(base, edit, (cx, cy, rx, ry))
        if (dx, dy) != (0, 0):
            shifted = base.copy()  # base fills the exposed border
            shifted.paste(edit, (-dx, -dy))
            edit = shifted
            print("drift corrected: dx=%d dy=%d" % (dx, dy), flush=True)
    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(10))
    base.paste(edit, (0, 0), mask)
    base.save(out)

def detect(base_p, edit_p, zx, zy, zw, zh, fx, fy, fw, fh):
    """Diff-based region auto-detect. Drift-correct the edit (excluding the
    detection zone), take |edit-base| in grayscale, threshold, despeckle, keep
    the largest connected blob(s) inside a padded plausibility zone, pad the
    union bbox to a rect. Emits {x,y,width,height,source:'auto'} or the given
    fallback {source:'default'} when the change is implausibly small/large."""
    base = Image.open(base_p).convert("RGB")
    edit = Image.open(edit_p).convert("RGB")
    if edit.size != base.size:
        edit = edit.resize(base.size, Image.LANCZOS)
    W, H = base.size
    fallback = {"x": int(fx), "y": int(fy), "width": int(fw), "height": int(fh), "source": "default"}
    # 1 — drift-correct the edit against the base, excluding the detection zone
    ecx, ecy = zx + zw / 2.0, zy + zh / 2.0
    dx, dy = estimate_shift(base, edit, (ecx, ecy, zw / 2.0, zh / 2.0))
    if (dx, dy) != (0, 0):
        shifted = base.copy(); shifted.paste(edit, (-dx, -dy)); edit = shifted
    # 2 — grayscale abs-diff on a coarse grid, restricted to the padded zone
    S = 192
    sx = S / float(W); sy = S / float(H)
    bg = base.resize((S, S)).convert("L").load()
    ep = edit.resize((S, S)).convert("L").load()
    THRESH = 26
    pad = 0.25
    z0x = int(max(0.0, zx - zw * pad) * sx); z1x = int(min(float(W), zx + zw * (1 + pad)) * sx)
    z0y = int(max(0.0, zy - zh * pad) * sy); z1y = int(min(float(H), zy + zh * (1 + pad)) * sy)
    z0x = max(0, min(S - 1, z0x)); z1x = max(0, min(S, z1x))
    z0y = max(0, min(S - 1, z0y)); z1y = max(0, min(S, z1y))
    zone_count = max(0, (z1x - z0x)) * max(0, (z1y - z0y))
    mask = [[0] * S for _ in range(S)]
    for y in range(z0y, z1y):
        for x in range(z0x, z1x):
            if abs(bg[x, y] - ep[x, y]) > THRESH:
                mask[y][x] = 1
    # 3 — despeckle: keep a set pixel only with >=3 of 8 neighbors set
    clean = [[0] * S for _ in range(S)]
    changed = 0
    for y in range(z0y, z1y):
        for x in range(z0x, z1x):
            if not mask[y][x]:
                continue
            n = 0
            for yy in range(max(0, y - 1), min(S, y + 2)):
                for xx in range(max(0, x - 1), min(S, x + 2)):
                    if (xx != x or yy != y) and mask[yy][xx]:
                        n += 1
            if n >= 3:
                clean[y][x] = 1; changed += 1
    # plausibility guards: too little signal, or nearly the whole zone changed
    if zone_count == 0 or changed < 6 or changed > 0.72 * zone_count:
        print(json.dumps(fallback), flush=True); return
    # 4 — connected components (BFS); keep comps with area >= 0.35*largest
    seen = [[False] * S for _ in range(S)]
    comps = []
    for y in range(z0y, z1y):
        for x in range(z0x, z1x):
            if clean[y][x] and not seen[y][x]:
                stack = [(x, y)]; seen[y][x] = True
                minx = maxx = x; miny = maxy = y; area = 0
                while stack:
                    px, py = stack.pop(); area += 1
                    if px < minx: minx = px
                    if px > maxx: maxx = px
                    if py < miny: miny = py
                    if py > maxy: maxy = py
                    for yy in range(max(0, py - 1), min(S, py + 2)):
                        for xx in range(max(0, px - 1), min(S, px + 2)):
                            if clean[yy][xx] and not seen[yy][xx]:
                                seen[yy][xx] = True; stack.append((xx, yy))
                comps.append((area, minx, miny, maxx, maxy))
    if not comps:
        print(json.dumps(fallback), flush=True); return
    top = max(c[0] for c in comps)
    kept = [c for c in comps if c[0] >= 0.35 * top]
    minx = min(c[1] for c in kept); miny = min(c[2] for c in kept)
    maxx = max(c[3] for c in kept); maxy = max(c[4] for c in kept)
    # 5 — back to native space, pad, clamp
    PADPX = 10
    rx0 = max(0.0, minx / sx - PADPX); ry0 = max(0.0, miny / sy - PADPX)
    rx1 = min(float(W), (maxx + 1) / sx + PADPX); ry1 = min(float(H), (maxy + 1) / sy + PADPX)
    out = {"x": int(round(rx0)), "y": int(round(ry0)),
           "width": int(round(rx1 - rx0)), "height": int(round(ry1 - ry0)), "source": "auto"}
    print(json.dumps(out), flush=True)

def accent(img, coords):
    im = Image.open(img).convert("RGB")
    if len(coords) >= 4:
        x, y, w, h = int(coords[0]), int(coords[1]), int(coords[2]), int(coords[3])
        im = im.crop((x, y, x + w, y + h))
    small = im.resize((16, 16), Image.LANCZOS)
    px = list(small.getdata()); n = len(px)
    r = sum(p[0] for p in px) // n; g = sum(p[1] for p in px) // n; b = sum(p[2] for p in px) // n
    print(json.dumps({"accent": "#%02x%02x%02x" % (r, g, b)}), flush=True)

def blank(out, r, g, b, w, h):
    Image.new("RGB", (int(w), int(h)), (int(r), int(g), int(b))).save(out)

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
    elif cmd == "base":
        base_prep(a[0], a[1])
    elif cmd == "composite":
        composite(a[0], a[1], int(a[2]), int(a[3]), int(a[4]), int(a[5]), a[6],
                  align=(len(a) > 7 and a[7] == "1"))
    elif cmd == "detect":
        detect(a[0], a[1], float(a[2]), float(a[3]), float(a[4]), float(a[5]),
               float(a[6]), float(a[7]), float(a[8]), float(a[9]))
    elif cmd == "accent":
        accent(a[0], a[1:])
    elif cmd == "blank":
        blank(a[0], a[1], a[2], a[3], a[4], a[5])
    elif cmd == "full":
        full(a[0], a[1])
    elif cmd == "tint":
        tint(a[0], a[1], a[2], a[3], a[4])
    else:
        sys.exit("unknown command: " + cmd)

main()
`;
