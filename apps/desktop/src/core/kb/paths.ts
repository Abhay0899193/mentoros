import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { KbKind } from "../types.js";

/** Normalize a user-supplied path to a canonical absolute path (no trailing /). */
export function normalizePath(p: string): string {
  const abs = resolve(p);
  return abs.length > 1 ? abs.replace(/\/+$/, "") : abs;
}

/**
 * Stable source id = hash of the normalized absolute path, so re-ingesting the
 * same path re-indexes in place under the same id (idempotency).
 */
export function sourceIdForPath(p: string): string {
  return createHash("sha1").update(normalizePath(p)).digest("hex").slice(0, 20);
}

const EXT_KIND: Record<string, KbKind> = {
  ".md": "md",
  ".markdown": "md",
  ".txt": "txt",
  ".text": "txt",
  ".pdf": "pdf",
};

export const INDEXABLE_EXTS = new Set(Object.keys(EXT_KIND));

export function kindForExt(ext: string): KbKind | undefined {
  return EXT_KIND[ext.toLowerCase()];
}

/** Guard: KB ingest is restricted to paths inside the user's home directory. */
export function isInsideHome(abs: string): boolean {
  const home = resolve(homedir());
  return abs === home || abs.startsWith(home + "/");
}
