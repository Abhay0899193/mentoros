import type { FaceRegion } from "../types.js";

/**
 * Crop + region-transform maths for the face pipeline (pure — unit tested).
 *
 * The user marks mouth/eyes rectangles in ORIGINAL portrait-pixel space. We
 * generate every Kontext edit at 1024², so before anything we crop a square
 * around the face and resize it to 1024². This module computes that crop and
 * carries the two rectangles into the 1024² space (used for the composite
 * ellipses).
 *
 * Heuristic: take the union of the mouth+eyes rects and expand it to a square
 * whose side is ~2.2× the union's height (eyes-to-mouth spans roughly a third
 * of a face, so ×2.2 frames head-and-shoulders comfortably). The side is
 * floored so it always covers the union's width, and clamped to the image; the
 * crop is centred on the union centre and nudged inward so it never leaves the
 * image bounds (near-edge faces just re-centre).
 */

export const OUTPUT_SIZE = 1024;
const HEIGHT_EXPANSION = 2.2;
const WIDTH_MARGIN = 1.1;

export interface CropRect {
  x: number;
  y: number;
  size: number;
}

export interface CropResult {
  /** Integer square crop in original-pixel space. */
  crop: CropRect;
  /** original→1024 scale factor. */
  scale: number;
  /** Mouth rect mapped into 1024² space. */
  mouth: FaceRegion;
  /** Eyes rect mapped into 1024² space. */
  eyes: FaceRegion;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Ellipse (centre + half-extents) for a composite window from a 1024² rect. */
export function ellipseFor(r: FaceRegion): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: Math.round(r.x + r.width / 2),
    cy: Math.round(r.y + r.height / 2),
    rx: Math.max(1, Math.round(r.width / 2)),
    ry: Math.max(1, Math.round(r.height / 2)),
  };
}

export function computeCrop(
  imgW: number,
  imgH: number,
  mouth: FaceRegion,
  eyes: FaceRegion,
): CropResult {
  const unionX = Math.min(mouth.x, eyes.x);
  const unionY = Math.min(mouth.y, eyes.y);
  const unionR = Math.max(mouth.x + mouth.width, eyes.x + eyes.width);
  const unionB = Math.max(mouth.y + mouth.height, eyes.y + eyes.height);
  const unionW = unionR - unionX;
  const unionH = unionB - unionY;
  const cx = unionX + unionW / 2;
  const cy = unionY + unionH / 2;

  // Square side: 2.2× union height, never smaller than the union's width,
  // never larger than the image (a square must fit inside both dimensions).
  let side = Math.max(unionH * HEIGHT_EXPANSION, unionW * WIDTH_MARGIN);
  side = Math.min(side, imgW, imgH);
  side = Math.round(side);

  const x = Math.round(clamp(cx - side / 2, 0, imgW - side));
  const y = Math.round(clamp(cy - side / 2, 0, imgH - side));

  const scale = OUTPUT_SIZE / side;
  const map = (r: FaceRegion): FaceRegion => ({
    x: (r.x - x) * scale,
    y: (r.y - y) * scale,
    width: r.width * scale,
    height: r.height * scale,
  });

  return { crop: { x, y, size: side }, scale, mouth: map(mouth), eyes: map(eyes) };
}
