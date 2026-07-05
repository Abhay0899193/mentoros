import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { KbKind } from "../types.js";
import type { Embedder } from "../memory/embeddings.js";
import { chunkText, type ChunkFormat } from "./chunker.js";
import { INDEXABLE_EXTS, kindForExt } from "./paths.js";
import type { IKbStore, KbChunkInput } from "./store.js";
import type { KbVectorIndex } from "./vectorIndex.js";

/**
 * Ingest — turn a file or folder into indexed, embedded chunks. Idempotent: the
 * caller passes a stable sourceId (hash of the path); we wipe the source's old
 * chunks/vectors/FTS rows and re-index in place. Embeddings degrade gracefully:
 * if Ollama is offline we still populate FTS5 (search works, keyword-only) and
 * finish with `done` — no vectors stored for that run.
 */

export interface IngestDeps {
  store: IKbStore;
  vectors: KbVectorIndex;
  embed: Embedder;
}

export type IngestStep =
  | "reading"
  | "chunking"
  | "embedding"
  | "indexing"
  | "done"
  | "error";

export interface IngestProgress {
  step: IngestStep;
  fileIndex?: number;
  fileCount?: number;
  chunksDone: number;
  chunksTotal: number;
  done: boolean;
  error?: string;
}

export interface IngestResult {
  chunkCount: number;
  fileCount: number;
  /** True when at least one chunk was embedded (i.e. vector search is live). */
  embedded: boolean;
}

interface SourceFile {
  absPath: string;
  relPath: string;
  format: ChunkFormat;
}

const DEFAULT_MAX_DEPTH = 8;

function formatForKind(kind: KbKind): ChunkFormat {
  return kind === "pdf" ? "pdf" : kind === "md" ? "md" : "txt";
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // dotfiles/dirs
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, depth - 1, out);
    } else if (entry.isFile() && INDEXABLE_EXTS.has(extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

/** Resolve the concrete files to index for a source path. */
export async function collectFiles(absPath: string): Promise<{
  kind: KbKind;
  files: SourceFile[];
}> {
  const st = await stat(absPath);
  if (st.isDirectory()) {
    const found: string[] = [];
    await walk(absPath, DEFAULT_MAX_DEPTH, found);
    found.sort(); // deterministic ordering → stable chunk ids across re-ingest
    const files: SourceFile[] = found.map((f) => ({
      absPath: f,
      relPath: relative(absPath, f),
      format: formatForKind(kindForExt(extname(f)) ?? "txt"),
    }));
    return { kind: "folder", files };
  }
  const kind = kindForExt(extname(absPath)) ?? "txt";
  return {
    kind,
    files: [{ absPath, relPath: basename(absPath), format: formatForKind(kind) }],
  };
}

async function extractText(file: SourceFile): Promise<string> {
  if (file.format === "pdf") return extractPdf(file.absPath);
  return readFile(file.absPath, "utf8");
}

/** Raw text of a single file, picked by extension. Used by the reading view. */
export async function extractFileText(absPath: string): Promise<string> {
  const kind = kindForExt(extname(absPath)) ?? "txt";
  return extractText({ absPath, relPath: basename(absPath), format: formatForKind(kind) });
}

async function extractPdf(absPath: string): Promise<string> {
  // Import the internal entrypoint directly (see pdf-parse.d.ts) and load lazily
  // so pdf-parse stays off the test/typecheck hot path.
  const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
  const buf = await readFile(absPath);
  // A custom page renderer appends a form-feed so the chunker can attach `p. N`
  // markers; if it fails we fall back to a plain parse (single page label).
  try {
    const withPages = pdfParse as unknown as (
      data: Buffer,
      opts?: { pagerender?: (pageData: PdfPageData) => Promise<string> },
    ) => Promise<{ text: string }>;
    const res = await withPages(buf, { pagerender: renderPageWithFormFeed });
    return res.text;
  } catch {
    const res = await pdfParse(buf);
    return res.text;
  }
}

interface PdfTextItem {
  str: string;
  transform: number[];
}
interface PdfPageData {
  getTextContent(opts: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }): Promise<{ items: PdfTextItem[] }>;
}

/** Mirrors pdf-parse's default renderer, then appends a form-feed page break. */
async function renderPageWithFormFeed(pageData: PdfPageData): Promise<string> {
  const content = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  let lastY: number | undefined;
  let text = "";
  for (const item of content.items) {
    if (lastY === item.transform[5] || lastY === undefined) text += item.str;
    else text += "\n" + item.str;
    lastY = item.transform[5];
  }
  return text + "\f";
}

export async function ingestSource(
  absPath: string,
  sourceId: string,
  deps: IngestDeps,
  emit: (p: IngestProgress) => void,
): Promise<IngestResult> {
  emit({ step: "reading", chunksDone: 0, chunksTotal: 0, done: false });
  const { files } = await collectFiles(absPath);
  const fileCount = files.length;

  // Read + chunk every file first so we know the total up front.
  const chunks: KbChunkInput[] = [];
  for (let fi = 0; fi < files.length; fi += 1) {
    const file = files[fi];
    emit({
      step: "reading",
      fileIndex: fi + 1,
      fileCount,
      chunksDone: 0,
      chunksTotal: 0,
      done: false,
    });
    let text: string;
    try {
      text = await extractText(file);
    } catch {
      continue; // unreadable file — skip, keep indexing the rest
    }
    const parts = chunkText(text, { format: file.format });
    for (const part of parts) {
      const chunk: KbChunkInput = {
        id: `${sourceId}:${fi}:${part.ord}`,
        filePath: file.relPath,
        ord: part.ord,
        text: part.text,
      };
      if (part.section) chunk.section = part.section;
      chunks.push(chunk);
    }
  }

  const chunksTotal = chunks.length;
  emit({ step: "chunking", fileCount, chunksDone: 0, chunksTotal, done: false });

  // Idempotent replace: drop the source's prior vectors + chunks + FTS rows.
  deps.vectors.removeForSource(sourceId);
  deps.store.clearChunks(sourceId);
  for (const chunk of chunks) deps.store.insertChunk(sourceId, chunk);
  emit({ step: "indexing", fileCount, chunksDone: 0, chunksTotal, done: false });

  // Embed each chunk; skip silently (FTS-only) if Ollama is down.
  let embedded = 0;
  let offline = false;
  for (let i = 0; i < chunks.length; i += 1) {
    if (offline) break;
    const vec = await deps.embed(chunks[i].text, "document");
    if (vec) {
      deps.vectors.upsertVector(chunks[i].id, sourceId, vec);
      embedded += 1;
    } else {
      offline = true; // first null ⇒ daemon down; don't hammer the wire
    }
    emit({
      step: "embedding",
      fileCount,
      chunksDone: i + 1,
      chunksTotal,
      done: false,
    });
  }

  const indexedAt = new Date().toISOString();
  deps.store.setSourceStats(sourceId, { fileCount, chunkCount: chunksTotal, indexedAt });
  emit({ step: "done", fileCount, chunksDone: chunksTotal, chunksTotal, done: true });

  return { chunkCount: chunksTotal, fileCount, embedded: embedded > 0 };
}
