/**
 * imageTiles — canvas utilities for the Avatar Studio's manual-create path:
 * decode user images, slice sprite sheets into frames, encode webp data URIs
 * (the wire format core validates), and sample an accent color. Everything is
 * client-side; core only ever sees finished webp frames.
 */

import type { FaceRegion } from './coreClient';

export interface DecodedImage {
  img: HTMLImageElement;
  width: number;
  height: number;
  /** Object URL — callers must revoke it when done (revokeDecoded). */
  url: string;
}

export function decodeImageFile(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) && !/^image\//.test(file.type)) {
      reject(new Error('Use a JPEG, PNG or WebP image.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () =>
      resolve({ img, width: img.naturalWidth, height: img.naturalHeight, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

export function revokeDecoded(d: DecodedImage): void {
  URL.revokeObjectURL(d.url);
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  return [c, ctx];
}

export function encodeCanvasWebp(canvas: HTMLCanvasElement, quality = 0.85): string {
  const uri = canvas.toDataURL('image/webp', quality);
  if (!uri.startsWith('data:image/webp')) throw new Error('WebP encoding unavailable');
  return uri;
}

/**
 * Draw a source rect cover-fitted into a square webp data URI. Portrait
 * frames are squared so every frame of a preset composites into the same
 * round cameo identically (the AI pipeline's 1024² convention).
 */
export function cropToSquareWebp(
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  maxEdge = 1024,
): string {
  const side = Math.min(maxEdge, Math.max(64, Math.min(sw, sh)));
  const [c, ctx] = canvas2d(side, side);
  // cover: crop the longer axis around its center
  const srcSide = Math.min(sw, sh);
  const cx = sx + (sw - srcSide) / 2;
  const cy = sy + (sh - srcSide) / 2;
  ctx.drawImage(img, cx, cy, srcSide, srcSide, 0, 0, side, side);
  return encodeCanvasWebp(c);
}

/** Full-body base: keep aspect, cap the long edge (2:3-ish stills stay intact). */
export function toWebpMaxEdge(img: HTMLImageElement, maxEdge = 1536): string {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const [c, ctx] = canvas2d(img.naturalWidth * scale, img.naturalHeight * scale);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return encodeCanvasWebp(c);
}

/** Mean color of the center region → #rrggbb (tints the ambient aura). */
export function sampleAccent(img: HTMLImageElement): string {
  const [, ctx] = canvas2d(48, 48);
  ctx.drawImage(img, 0, 0, 48, 48);
  const data = ctx.getImageData(12, 12, 24, 24).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/* ------------------------------ sheet slicing ----------------------------- */

export interface GridSuggestion {
  rows: number;
  cols: number;
  /** true when gutters were actually detected (else a 3×3 default). */
  detected: boolean;
}

/**
 * Suggest a rows×cols grid by scanning for gutter bands — runs of rows/cols
 * whose pixels are near-uniformly the background color (sampled at the
 * corners). Works for the classic white-gutter sprite sheet; anything
 * ambiguous falls back to 3×3, and the UI always offers manual steppers.
 */
export function detectGrid(img: HTMLImageElement): GridSuggestion {
  const scale = Math.min(1, 384 / Math.max(img.naturalWidth, img.naturalHeight));
  const [c, ctx] = canvas2d(img.naturalWidth * scale, img.naturalHeight * scale);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const px = (x: number, y: number) => {
    const i = (y * c.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const corners = [px(0, 0), px(c.width - 1, 0), px(0, c.height - 1), px(c.width - 1, c.height - 1)];
  const bg = corners.reduce((acc, cur) => [acc[0] + cur[0] / 4, acc[1] + cur[1] / 4, acc[2] + cur[2] / 4], [0, 0, 0]);
  const isBg = (x: number, y: number) => {
    const p = px(x, y);
    return Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) < 90;
  };

  const segments = (length: number, cross: number, sample: (i: number, j: number) => boolean): number => {
    let count = 0;
    let inContent = false;
    for (let i = 0; i < length; i += 1) {
      let bgHits = 0;
      const step = Math.max(1, Math.floor(cross / 64));
      let samples = 0;
      for (let j = 0; j < cross; j += step) {
        samples += 1;
        if (sample(i, j)) bgHits += 1;
      }
      const blank = bgHits / samples > 0.97;
      if (!blank && !inContent) {
        count += 1;
        inContent = true;
      } else if (blank) {
        inContent = false;
      }
    }
    return count;
  };

  const rows = segments(c.height, c.width, (y, x) => isBg(x, y));
  const cols = segments(c.width, c.height, (x, y) => isBg(x, y));
  if (rows >= 1 && rows <= 8 && cols >= 1 && cols <= 8 && rows * cols > 1) {
    return { rows, cols, detected: true };
  }
  return { rows: 3, cols: 3, detected: false };
}

/**
 * Slice an equal rows×cols grid into square webp tiles (row-major). Gutters
 * are absorbed by the square cover-crop of each cell; `inset` trims a uniform
 * fraction off every cell edge first (0.04 default eats hairline gutters).
 */
export function sliceGrid(img: HTMLImageElement, rows: number, cols: number, inset = 0.04): string[] {
  const cw = img.naturalWidth / cols;
  const ch = img.naturalHeight / rows;
  const dx = cw * inset;
  const dy = ch * inset;
  const tiles: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let col = 0; col < cols; col += 1) {
      tiles.push(cropToSquareWebp(img, col * cw + dx, r * ch + dy, cw - 2 * dx, ch - 2 * dy, 768));
    }
  }
  return tiles;
}

/** Data-URI-safe unique id for pool tiles. */
export function tileId(): string {
  return `t${Math.random().toString(36).slice(2, 9)}`;
}

/* ---------------------------- align to base ------------------------------ */

/**
 * Decode a frame source back into an HTMLImageElement (no object URL to
 * revoke). Accepts data URIs and served art URLs — http(s) sources load with
 * crossOrigin so they stay canvas-safe (core's CORS covers /faces/art).
 */
export function loadFrameImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(uri)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode a frame.'));
    img.src = uri;
  });
}

/**
 * Mirror of the core pipeline's anti-drift composite (ops.ts PIPELINE_PY):
 * paste only the frame's region ellipses onto the base through a feathered
 * mask, so every layer is pixel-identical to the base outside mouth/eyes and
 * sprite swaps stop jumping. Regions are in the base's natural pixels;
 * `shift` translates the frame (from estimateShift) before pasting. Feather
 * matches PIL GaussianBlur(10) at the pipeline's 1024² scale (CSS blur radius
 * is the Gaussian stddev, same convention as PIL).
 */
export function alignFrameToBase(
  base: HTMLImageElement,
  frame: HTMLImageElement,
  regions: FaceRegion[],
  shift: { dx: number; dy: number } = { dx: 0, dy: 0 },
): string {
  const w = base.naturalWidth;
  const h = base.naturalHeight;

  const [mask, maskCtx] = canvas2d(w, h);
  maskCtx.fillStyle = '#fff';
  for (const r of regions) {
    maskCtx.beginPath();
    maskCtx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
    maskCtx.fill();
  }
  const [feathered, featheredCtx] = canvas2d(w, h);
  featheredCtx.filter = `blur(${Math.max(2, Math.round((10 * Math.max(w, h)) / 1024))}px)`;
  featheredCtx.drawImage(mask, 0, 0);

  const [masked, maskedCtx] = canvas2d(w, h);
  maskedCtx.drawImage(frame, shift.dx, shift.dy, w, h);
  maskedCtx.globalCompositeOperation = 'destination-in';
  maskedCtx.drawImage(feathered, 0, 0);

  const [out, outCtx] = canvas2d(w, h);
  outCtx.drawImage(base, 0, 0, w, h);
  outCtx.drawImage(masked, 0, 0);
  return encodeCanvasWebp(out);
}

function grayscale(img: HTMLImageElement, size: number): Float32Array {
  const [, ctx] = canvas2d(size, size);
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i += 1) {
    g[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  return g;
}

/** Mean absolute difference of frame shifted by (dx,dy) vs base, skipping excluded pixels. */
function sad(base: Float32Array, frame: Float32Array, size: number, dx: number, dy: number, excluded: Uint8Array): number {
  let sum = 0;
  let n = 0;
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(size, size - dy);
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(size, size - dx);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = y * size + x;
      if (excluded[i]) continue;
      sum += Math.abs(base[i] - frame[(y + dy) * size + (x + dx)]);
      n += 1;
    }
  }
  return n === 0 ? Infinity : sum / n;
}

/**
 * Estimate the global translation that best maps `frame` onto `base`
 * (whole-photo drift between hand-made frames). Regions that legitimately
 * differ (mouth/eyes) are excluded from the match. Coarse-to-fine SAD search;
 * returns natural-pixel {dx, dy} to feed alignFrameToBase, biased toward zero
 * so identical frames never pick up a spurious shift.
 */
export function estimateShift(
  base: HTMLImageElement,
  frame: HTMLImageElement,
  exclude: FaceRegion[],
): { dx: number; dy: number } {
  const natural = Math.max(base.naturalWidth, base.naturalHeight);

  const search = (size: number, cx: number, cy: number, radius: number): { dx: number; dy: number } => {
    const b = grayscale(base, size);
    const f = grayscale(frame, size);
    const excluded = new Uint8Array(size * size);
    const s = size / base.naturalWidth;
    for (const r of exclude) {
      const rx0 = Math.max(0, Math.floor(r.x * s));
      const ry0 = Math.max(0, Math.floor(r.y * s));
      const rx1 = Math.min(size, Math.ceil((r.x + r.width) * s));
      const ry1 = Math.min(size, Math.ceil((r.y + r.height) * s));
      for (let y = ry0; y < ry1; y += 1) for (let x = rx0; x < rx1; x += 1) excluded[y * size + x] = 1;
    }
    let best = { dx: cx, dy: cy };
    let bestCost = Infinity;
    for (let dy = cy - radius; dy <= cy + radius; dy += 1) {
      for (let dx = cx - radius; dx <= cx + radius; dx += 1) {
        // tiny distance penalty: zero shift wins ties on already-aligned frames
        const cost = sad(b, f, size, dx, dy, excluded) + 0.002 * Math.hypot(dx, dy);
        if (cost < bestCost) {
          bestCost = cost;
          best = { dx, dy };
        }
      }
    }
    return best;
  };

  const coarse = search(160, 0, 0, 8);
  const fineSize = Math.min(512, natural);
  const scaleUp = fineSize / 160;
  const fine = search(fineSize, Math.round(coarse.dx * scaleUp), Math.round(coarse.dy * scaleUp), 3);

  const toNatural = natural / fineSize;
  // drawImage(frame, dx, dy) moves the frame; SAD found where the frame's
  // content sits relative to the base, so the correction is the negation.
  return { dx: Math.round(-fine.dx * toNatural), dy: Math.round(-fine.dy * toNatural) };
}
