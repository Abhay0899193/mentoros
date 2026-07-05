import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Embedder } from "../memory/embeddings.js";
import { chunkText, OVERLAP_CHARS } from "./chunker.js";
import { fuse, hybridSearch, makeSnippet } from "./search.js";
import { ingestSource } from "./ingest.js";
import { sourceIdForPath } from "./paths.js";
import type {
  IKbStore,
  KbChunkInput,
  KbChunkMeta,
  SourceStats,
  UpsertSourceInput,
} from "./store.js";
import type { KbVectorHit, KbVectorIndex } from "./vectorIndex.js";
import type { KbSource } from "../types.js";

/* ------------------------------- fakes ------------------------------- */

class FakeKbStore implements IKbStore {
  readonly sources = new Map<string, KbSource>();
  readonly chunks = new Map<string, KbChunkMeta>();

  upsertSource(input: UpsertSourceInput): void {
    const ex = this.sources.get(input.id);
    this.sources.set(input.id, {
      id: input.id,
      kind: input.kind,
      title: input.title,
      path: input.path,
      tags: input.tags,
      chunkCount: ex?.chunkCount ?? 0,
      fileCount: ex?.fileCount ?? 0,
      indexedAt: ex?.indexedAt ?? new Date().toISOString(),
    });
  }
  getSource(id: string): KbSource | undefined {
    return this.sources.get(id);
  }
  listSources(): KbSource[] {
    return [...this.sources.values()];
  }
  deleteSource(id: string): void {
    this.clearChunks(id);
    this.sources.delete(id);
  }
  clearChunks(sourceId: string): void {
    for (const [id, c] of this.chunks) if (c.sourceId === sourceId) this.chunks.delete(id);
  }
  insertChunk(sourceId: string, chunk: KbChunkInput): void {
    const s = this.sources.get(sourceId);
    this.chunks.set(chunk.id, {
      id: chunk.id,
      sourceId,
      sourceTitle: s?.title ?? "",
      kind: s?.kind ?? "txt",
      filePath: chunk.filePath,
      section: chunk.section,
      ord: chunk.ord,
      text: chunk.text,
    });
  }
  setSourceStats(id: string, stats: SourceStats): void {
    const s = this.sources.get(id);
    if (s) {
      s.fileCount = stats.fileCount;
      s.chunkCount = stats.chunkCount;
      s.indexedAt = stats.indexedAt;
    }
  }
  ftsSearch(query: string, limit: number, sourceIds?: string[]): string[] {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length > 0);
    const scored: Array<{ id: string; hits: number; ord: number }> = [];
    for (const c of this.chunks.values()) {
      if (sourceIds && !sourceIds.includes(c.sourceId)) continue;
      const text = c.text.toLowerCase();
      let hits = 0;
      for (const t of terms) if (text.includes(t)) hits += 1;
      if (hits > 0) scored.push({ id: c.id, hits, ord: c.ord });
    }
    scored.sort((a, b) => b.hits - a.hits || a.ord - b.ord);
    return scored.slice(0, limit).map((s) => s.id);
  }
  getChunk(chunkId: string): KbChunkMeta | undefined {
    return this.chunks.get(chunkId);
  }
  chunksForSource(sourceId: string): KbChunkMeta[] {
    return [...this.chunks.values()]
      .filter((c) => c.sourceId === sourceId)
      .sort((a, b) => a.ord - b.ord);
  }
}

class FakeKbVectorIndex implements KbVectorIndex {
  readonly vecs = new Map<string, { sourceId: string; vec: number[] }>();
  upsertVector(chunkId: string, sourceId: string, vec: number[]): void {
    this.vecs.set(chunkId, { sourceId, vec });
  }
  removeForSource(sourceId: string): void {
    for (const [id, v] of this.vecs) if (v.sourceId === sourceId) this.vecs.delete(id);
  }
  search(vec: number[], k: number, sourceIds?: string[]): KbVectorHit[] {
    const hits: KbVectorHit[] = [];
    for (const [chunkId, entry] of this.vecs) {
      if (sourceIds && !sourceIds.includes(entry.sourceId)) continue;
      let s = 0;
      for (let i = 0; i < Math.min(vec.length, entry.vec.length); i += 1) s += vec[i] * entry.vec[i];
      hits.push({ chunkId, score: s });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}

const offlineEmbed: Embedder = async () => null;

/* ------------------------------ chunker ------------------------------ */

test("chunker: breaks on paragraph boundaries (no mid-sentence cuts)", () => {
  const para = (n: number) =>
    `Paragraph ${n} discusses a distinct idea in some detail. It carries two full sentences so the packer has clean boundaries to prefer.`;
  const raw = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkText(raw, { format: "txt" });
  assert.ok(chunks.length > 1, "long input splits into multiple chunks");
  for (const c of chunks) {
    assert.ok(/[.!?]$/.test(c.text.trim()), `chunk ends at a sentence boundary: ${JSON.stringify(c.text.slice(-20))}`);
  }
});

test("chunker: consecutive chunks overlap", () => {
  const para = (n: number) =>
    `Section ${n} explains an idea with enough words to fill space and force the packer to roll over into a new chunk after a boundary is crossed.`;
  const raw = Array.from({ length: 10 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkText(raw, { format: "txt" });
  assert.ok(chunks.length > 1);
  const head = chunks[1].text.slice(0, 30);
  assert.ok(chunks[0].text.includes(head), "chunk 1 begins with a tail of chunk 0");
  assert.ok(chunks[1].text.length > OVERLAP_CHARS - 60);
});

test("chunker: markdown carries the nearest heading as section", () => {
  const md = `# Alpha\n\nAlpha body paragraph with content.\n\n## Beta\n\nBeta body paragraph with content.`;
  const chunks = chunkText(md, { format: "md" });
  // Headings are hard boundaries, so each section is its own chunk.
  assert.ok(chunks.some((c) => c.section === "Alpha"), "Alpha section present");
  assert.ok(chunks.some((c) => c.section === "Beta"), "Beta section present");
});

test("chunker: pdf page markers via form-feed", () => {
  const page = (n: number) =>
    Array.from(
      { length: 8 },
      (_, i) => `Page ${n} paragraph ${i} carries enough text to fill a chunk on its own.`,
    ).join("\n\n");
  const raw = `${page(1)}\f${page(2)}`;
  const chunks = chunkText(raw, { format: "pdf" });
  assert.equal(chunks[0].section, "p. 1");
  assert.ok(chunks.some((c) => c.section === "p. 2"), "second page labelled p. 2");
});

/* -------------------------------- RRF -------------------------------- */

test("fuse: RRF ordering + matched flags", () => {
  const fts = ["a", "b", "c"];
  const vec: KbVectorHit[] = [
    { chunkId: "b", score: 0.91 },
    { chunkId: "d", score: 0.8 },
  ];
  const rows = fuse(fts, vec, 60);

  assert.equal(rows[0].chunkId, "b", "in-both hit ranks first");
  assert.equal(rows[0].matched, "both");
  assert.equal(rows[0].score, 1, "top fused score normalized to 1");

  const a = rows.find((r) => r.chunkId === "a");
  const d = rows.find((r) => r.chunkId === "d");
  assert.equal(a?.matched, "fts");
  assert.equal(a?.vectorScore, null);
  assert.equal(d?.matched, "vector");
  assert.equal(d?.vectorScore, 0.8);

  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].score >= rows[i].score, "sorted desc");
    assert.ok(rows[i].score >= 0 && rows[i].score <= 1, "normalized 0..1");
  }
});

test("makeSnippet centers on the query term", () => {
  const text = "x".repeat(300) + " NEEDLE marker " + "y".repeat(300);
  const snip = makeSnippet(text, "needle");
  assert.ok(snip.toLowerCase().includes("needle"));
  assert.ok(snip.length <= 210);
});

/* ------------------------------ ingest ------------------------------ */

async function seedDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kb-test-"));
  await writeFile(
    join(dir, "a.md"),
    "# Two Pointers\n\nThe two pointers pattern walks a converging window. Use it on sorted arrays to find pairs in linear time. It is a distinctivetoken worth indexing.\n",
  );
  await writeFile(
    join(dir, "b.txt"),
    "Sliding window keeps a running aggregate over a contiguous range and advances the frontier as constraints allow.\n",
  );
  return dir;
}

test("ingest: idempotent — same path re-indexes in place, stable ids/count", async () => {
  const dir = await seedDir();
  const sourceId = sourceIdForPath(dir);
  const store = new FakeKbStore();
  const vectors = new FakeKbVectorIndex();
  store.upsertSource({ id: sourceId, kind: "folder", title: "Patterns", path: dir, tags: [] });

  const r1 = await ingestSource(dir, sourceId, { store, vectors, embed: offlineEmbed }, () => {});
  const ids1 = store.chunksForSource(sourceId).map((c) => c.id).sort();

  const r2 = await ingestSource(dir, sourceId, { store, vectors, embed: offlineEmbed }, () => {});
  const ids2 = store.chunksForSource(sourceId).map((c) => c.id).sort();

  assert.equal(r1.chunkCount, r2.chunkCount, "chunk count stable across re-ingest");
  assert.deepEqual(ids1, ids2, "chunk ids stable across re-ingest");
  assert.equal(sourceIdForPath(dir), sourceId, "sourceId is a stable hash of the path");
  assert.equal(store.listSources().length, 1, "no duplicate source rows");
});

test("ingest + search: FTS-only fallback when embeddings are unavailable", async () => {
  const dir = await seedDir();
  const sourceId = sourceIdForPath(dir);
  const store = new FakeKbStore();
  const vectors = new FakeKbVectorIndex();
  store.upsertSource({ id: sourceId, kind: "folder", title: "Patterns", path: dir, tags: [] });

  const steps: string[] = [];
  const res = await ingestSource(dir, sourceId, { store, vectors, embed: offlineEmbed }, (p) =>
    steps.push(p.step),
  );
  assert.equal(res.embedded, false, "no vectors stored while offline");
  assert.equal(vectors.vecs.size, 0);
  assert.ok(steps.includes("done"), "finishes with done despite no embeddings");

  const hits = await hybridSearch("distinctivetoken", {}, { store, vectors, embed: offlineEmbed });
  assert.ok(hits.length >= 1, "FTS still returns results");
  assert.equal(hits[0].matched, "fts", "degraded hits are marked fts");
});
