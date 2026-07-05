import { statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  CoreEvents,
  KbKind,
  KbSearchHit,
  KbSource,
  KbSuggestedSource,
} from "../types.js";
import { embed as defaultEmbed, type Embedder } from "../memory/embeddings.js";
import { extractFileText, ingestSource, type IngestProgress } from "./ingest.js";
import { isInsideHome, kindForExt, normalizePath, sourceIdForPath } from "./paths.js";
import {
  hybridSearch,
  isGrounded,
  toKbSearchHit,
  type HybridHit,
  type HybridSearchOpts,
} from "./search.js";
import type { IKbStore } from "./store.js";
import type { KbVectorIndex } from "./vectorIndex.js";
import { suggestSources } from "./suggestions.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

export interface KbSourceText {
  title: string;
  kind: KbKind;
  text: string;
  files?: string[];
}

export interface PreparedSource {
  sourceId: string;
  absPath: string;
  kind: KbKind;
}

/**
 * KbEngine — the KB façade the routes and chat grounding call. Wraps the store,
 * vector index and embedder; owns ingest orchestration, hybrid search, source
 * text retrieval and suggestions.
 */
export class KbEngine {
  constructor(
    private readonly store: IKbStore,
    private readonly vectors: KbVectorIndex,
    private readonly broadcast: Broadcast,
    private readonly embed: Embedder = defaultEmbed,
  ) {}

  listSources(): KbSource[] {
    return this.store.listSources();
  }

  getSource(id: string): KbSource | undefined {
    return this.store.getSource(id);
  }

  suggestions(): KbSuggestedSource[] {
    return suggestSources(this.store);
  }

  /**
   * Validate the path, resolve its kind, and upsert the (empty) source row so a
   * sourceId can be returned to the caller before the heavy ingest runs. Throws
   * on an invalid/out-of-home/nonexistent path.
   */
  prepareSource(path: string, opts: { title?: string; tags?: string[] } = {}): PreparedSource {
    const absPath = normalizePath(path);
    if (!isInsideHome(absPath)) {
      throw new Error("path must be inside the home directory");
    }
    let st;
    try {
      st = statSync(absPath);
    } catch {
      throw new Error("path does not exist");
    }
    const kind: KbKind = st.isDirectory() ? "folder" : kindForExt(extname(absPath)) ?? "txt";
    const sourceId = sourceIdForPath(absPath);
    const existing = this.store.getSource(sourceId);
    const title = opts.title?.trim() || existing?.title || basename(absPath);
    const tags = opts.tags ?? existing?.tags ?? [];
    this.store.upsertSource({ id: sourceId, kind, title, path: absPath, tags });
    this.broadcast("kb.updated", { sources: this.store.listSources() });
    return { sourceId, absPath, kind };
  }

  /** Run the async chunk/embed/index pipeline, emitting kb.ingest progress. */
  async runIngest(prepared: PreparedSource): Promise<void> {
    const { sourceId, absPath } = prepared;
    const emit = (p: IngestProgress) =>
      this.broadcast("kb.ingest", {
        sourceId,
        path: absPath,
        step: p.step,
        chunksDone: p.chunksDone,
        chunksTotal: p.chunksTotal,
        done: p.done,
        ...(p.fileIndex !== undefined ? { fileIndex: p.fileIndex } : {}),
        ...(p.fileCount !== undefined ? { fileCount: p.fileCount } : {}),
        ...(p.error ? { error: p.error } : {}),
      });
    try {
      await ingestSource(absPath, sourceId, {
        store: this.store,
        vectors: this.vectors,
        embed: this.embed,
      }, emit);
    } catch (err) {
      this.broadcast("kb.ingest", {
        sourceId,
        path: absPath,
        step: "error",
        chunksDone: 0,
        chunksTotal: 0,
        done: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.broadcast("kb.updated", { sources: this.store.listSources() });
  }

  deleteSource(id: string): boolean {
    if (!this.store.getSource(id)) return false;
    this.vectors.removeForSource(id);
    this.store.deleteSource(id);
    this.broadcast("kb.updated", { sources: this.store.listSources() });
    return true;
  }

  /** Rich hybrid search — used by chat grounding (keeps the raw vector cosine). */
  search(query: string, opts: HybridSearchOpts = {}): Promise<HybridHit[]> {
    return hybridSearch(query, opts, {
      store: this.store,
      vectors: this.vectors,
      embed: this.embed,
    });
  }

  /** Contract-shaped hybrid search for the HTTP route (strips vectorScore). */
  async searchPublic(query: string, opts: HybridSearchOpts = {}): Promise<KbSearchHit[]> {
    return (await this.search(query, opts)).map(toKbSearchHit);
  }

  isGrounded(hits: HybridHit[]): boolean {
    return isGrounded(hits);
  }

  /** Raw text of a source (or one file inside a folder) for the reading view. */
  async sourceText(id: string, filePath?: string): Promise<KbSourceText | undefined> {
    const source = this.store.getSource(id);
    if (!source) return undefined;

    if (source.kind !== "folder") {
      const text = await extractFileText(source.path).catch(() => "");
      return { title: source.title, kind: source.kind, text };
    }

    // Folder: list the indexed relative file paths; select one via `filePath`.
    const files = Array.from(
      new Set(this.store.chunksForSource(id).map((c) => c.filePath)),
    ).sort();
    const selected =
      filePath && files.includes(filePath) ? filePath : files[0];
    let text = "";
    if (selected) {
      text = await extractFileText(join(source.path, selected)).catch(() => "");
    }
    return { title: source.title, kind: "folder", text, files };
  }
}
