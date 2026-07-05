import assert from "node:assert/strict";
import test from "node:test";
import { normalize } from "./embeddings.js";
import type { Embedder } from "./embeddings.js";
import { MemoryEngine, SIMILARITY_MERGE_THRESHOLD, deriveProfile } from "./engine.js";
import type { MergeJudge } from "./engine.js";
import type { IMemoryStore, ListOpts } from "./store.js";
import type { VectorHit, VectorIndex, VectorSearchOpts } from "./vectorIndex.js";
import type { MemoryRecord, MemoryType } from "../types.js";

/**
 * In-memory doubles for IMemoryStore + VectorIndex. The engine's non-trivial
 * logic (upsert-by-similarity, recall merge/threshold, graph, profile) is pure
 * over these seams; the concrete SQLite implementations are exercised at
 * dev-boot / curl time (the native better-sqlite3 build targets arm64 Electron,
 * not this x64 test runner).
 */
class FakeStore implements IMemoryStore {
  private readonly rows = new Map<string, MemoryRecord>();
  private readonly needs = new Set<string>();
  insert(record: MemoryRecord, needsEmbedding: boolean): void {
    this.rows.set(record.id, structuredClone(record));
    if (needsEmbedding) this.needs.add(record.id);
    else this.needs.delete(record.id);
  }
  update(record: MemoryRecord, needsEmbedding?: boolean): void {
    this.rows.set(record.id, structuredClone(record));
    if (needsEmbedding !== undefined) {
      if (needsEmbedding) this.needs.add(record.id);
      else this.needs.delete(record.id);
    }
  }
  get(id: string): MemoryRecord | undefined {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : undefined;
  }
  all(): MemoryRecord[] {
    return [...this.rows.values()]
      .map((r) => structuredClone(r))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  list(opts: ListOpts = {}): MemoryRecord[] {
    let out = this.all();
    if (opts.type) out = out.filter((r) => r.type === opts.type);
    if (opts.q) {
      const q = opts.q.toLowerCase();
      out = out.filter(
        (r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q),
      );
    }
    return out.slice(0, opts.limit ?? 200);
  }
  likeSearch(query: string, types: MemoryType[] | undefined, limit: number): MemoryRecord[] {
    const q = query.toLowerCase();
    return this.all()
      .filter((r) => !types || types.includes(r.type))
      .filter(
        (r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q),
      )
      .slice(0, limit);
  }
  delete(id: string): void {
    this.rows.delete(id);
    this.needs.delete(id);
  }
  pendingEmbedding(): MemoryRecord[] {
    return [...this.needs].map((id) => structuredClone(this.rows.get(id)!));
  }
  setNeedsEmbedding(id: string, needs: boolean): void {
    if (needs) this.needs.add(id);
    else this.needs.delete(id);
  }
}

class FakeVectorIndex implements VectorIndex {
  private readonly vecs = new Map<string, number[]>();
  constructor(private readonly store: FakeStore) {}
  upsertVector(id: string, vec: number[]): void {
    this.vecs.set(id, vec);
  }
  removeVector(id: string): void {
    this.vecs.delete(id);
  }
  search(vec: number[], k: number, opts: VectorSearchOpts = {}): VectorHit[] {
    const hits: VectorHit[] = [];
    for (const [id, v] of this.vecs) {
      if (opts.types) {
        const rec = this.store.get(id);
        if (!rec || !opts.types.includes(rec.type)) continue;
      }
      let s = 0;
      for (let i = 0; i < Math.min(v.length, vec.length); i += 1) s += v[i] * vec[i];
      hits.push({ id, score: s });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}

/**
 * Deterministic fake embedder: routes text to fixed unit vectors by keyword so
 * cosine similarity is fully controlled. "goal" texts collapse onto [1,0,0]
 * (near-duplicates), "rust" onto an orthogonal axis (distinct).
 */
function fakeEmbedder(offline = false): Embedder {
  return async (text: string) => {
    if (offline) return null;
    const t = text.toLowerCase();
    if (t.includes("staff engineer")) return normalize([1, 0, 0.02]);
    if (t.includes("rust")) return normalize([0, 1, 0]);
    if (t.includes("weak") || t.includes("graph")) return normalize([0, 0, 1]);
    return normalize([0.3, 0.3, 0.3]);
  };
}

function makeEngine(embed: Embedder, judge: MergeJudge = async () => false) {
  const store = new FakeStore();
  const vectors = new FakeVectorIndex(store);
  const engine = new MemoryEngine(store, vectors, embed, undefined, judge);
  return { engine, store, vectors };
}

test("judge band: paraphrase merges when the judge says MERGE", async () => {
  // Embeddings put the paraphrase in the ambiguous band (< 0.86, >= 0.65)
  // where only the judge can decide.
  const vecs: Record<string, number[]> = {
    a: normalize([1, 0, 0.55]),
    b: normalize([1, 0.28, 0]),
  };
  const bandEmbed: Embedder = async (text) =>
    text.includes("Staff Engineer") ? vecs.a : text.includes("become") ? vecs.b : normalize([0, 1, 0]);
  const { engine } = makeEngine(bandEmbed, async () => true);

  const a = await engine.saveMemory({ type: "goal", body: "Goal: reach Staff Engineer", source: "chat" });
  const b = await engine.saveMemory({ type: "goal", body: "I want to become a principal-level engineer", source: "chat" });
  assert.equal(a.action, "created");
  assert.equal(b.action, "merged", "judge MERGE verdict merges the paraphrase");
  assert.equal(b.record.id, a.record.id);
});

test("judge band: KEEP verdict and judge failure both create", async () => {
  const constEmbed: Embedder = async () => normalize([1, 1, 1]);

  const keep = makeEngine(constEmbed, async () => false);
  await keep.engine.saveMemory({ type: "learning", title: "Review: Word Search II", body: "grade 4/5", source: "x" });
  const kept = await keep.engine.saveMemory({ type: "learning", title: "Review: Pacific Atlantic", body: "grade 4/5", source: "x" });
  assert.equal(kept.action, "created");

  const throwing = makeEngine(constEmbed, async () => {
    throw new Error("ollama down");
  });
  await throwing.engine.saveMemory({ type: "goal", body: "Goal one here", source: "x" });
  const failedOpen = await throwing.engine.saveMemory({ type: "goal", body: "Completely different goal", source: "x" });
  assert.equal(failedOpen.action, "created", "judge failure fails open to create");
});

test("threshold constant is 0.86", () => {
  assert.equal(SIMILARITY_MERGE_THRESHOLD, 0.86);
});

test("upsert-by-similarity: near-duplicate merges, distinct creates", async () => {
  const { engine } = makeEngine(fakeEmbedder());

  const a = await engine.saveMemory({
    type: "goal",
    body: "Goal: reach Staff Engineer",
    source: "manual",
    tags: ["career"],
  });
  assert.equal(a.action, "created");
  assert.equal(a.record.confidence, 0.7); // default

  const b = await engine.saveMemory({
    type: "goal",
    body: "Reach Staff Engineer as my main goal",
    source: "chat",
    tags: ["auto"],
  });
  assert.equal(b.action, "merged");
  assert.equal(b.record.id, a.record.id, "merge keeps the same id");
  assert.ok((b.similarity ?? 0) >= SIMILARITY_MERGE_THRESHOLD);
  assert.equal(b.record.body, "Reach Staff Engineer as my main goal", "newest body wins");
  assert.deepEqual(
    [...b.record.tags].sort(),
    ["auto", "career"],
    "tags are unioned",
  );
  assert.equal(b.record.history.length, 1, "old body pushed to history");
  assert.equal(b.record.history[0].body, "Goal: reach Staff Engineer");
  assert.ok(b.record.confidence > a.record.confidence, "confidence nudged up");

  const c = await engine.saveMemory({
    type: "goal",
    body: "Learn Rust deeply",
    source: "manual",
  });
  assert.equal(c.action, "created", "orthogonal goal is a new record");
  assert.notEqual(c.record.id, a.record.id);
});

test("lexical guard: cosine-1.0 but distinct entities do NOT collapse", async () => {
  // Simulate nomic's short-text compression: every text embeds to the SAME
  // vector, so cosine is always 1.0. Only the title-Jaccard guard prevents a
  // collapse of genuinely distinct records.
  const constEmbed: Embedder = async () => normalize([1, 1, 1]);
  const { engine } = makeEngine(constEmbed);

  const a = await engine.saveMemory({
    type: "learning",
    title: "Review: Word Search II",
    body: "Spaced repetition — grade 4/5, mastery Learning",
    source: "import:interview-prep",
  });
  const b = await engine.saveMemory({
    type: "learning",
    title: "Review: Pacific Atlantic Water Flow",
    body: "Spaced repetition — grade 4/5, mastery Learning",
    source: "import:interview-prep",
  });
  assert.equal(a.action, "created");
  assert.equal(b.action, "created", "distinct entity stays separate despite cosine 1.0");

  // …but an exact restatement (identical title) still merges → idempotency.
  const again = await engine.saveMemory({
    type: "learning",
    title: "Review: Word Search II",
    body: "Spaced repetition — grade 5/5, mastery Solid",
    source: "import:interview-prep",
  });
  assert.equal(again.action, "merged");
  assert.equal(again.record.id, a.record.id);
});

test("same-type constraint: identical text under a different type creates", async () => {
  const { engine } = makeEngine(fakeEmbedder());
  const g = await engine.saveMemory({
    type: "goal",
    body: "reach Staff Engineer",
    source: "manual",
  });
  const c = await engine.saveMemory({
    type: "career",
    body: "reach Staff Engineer",
    source: "manual",
  });
  assert.equal(g.action, "created");
  assert.equal(c.action, "created", "different type = no merge candidate");
});

test("confidence bump caps at 0.99 and history caps at 20", async () => {
  const { engine } = makeEngine(fakeEmbedder());
  let last: MemoryRecord | null = null;
  for (let i = 0; i < 30; i += 1) {
    const r = await engine.saveMemory({
      type: "goal",
      body: `reach Staff Engineer take ${i}`,
      source: "manual",
      confidence: 0.95,
    });
    last = r.record;
  }
  assert.ok(last);
  assert.ok(last.confidence <= 0.99);
  assert.ok(last.history.length <= 20, "history is capped at 20");
});

test("recall sorts by score and drops sub-threshold hits", async () => {
  const { engine } = makeEngine(fakeEmbedder());
  await engine.saveMemory({ type: "goal", body: "reach Staff Engineer", source: "m" });
  await engine.saveMemory({
    type: "skill",
    body: "weak at graphs",
    source: "m",
    tags: ["weakness"],
  });

  const hits = await engine.recall("what are my weaknesses with graphs", {
    k: 5,
    minScore: 0.45,
  });
  assert.ok(hits.length >= 1);
  // weakness/graph record aligns with the query axis → ranks first.
  assert.equal(hits[0].record.type, "skill");
  for (let i = 1; i < hits.length; i += 1) {
    assert.ok(hits[i - 1].score >= hits[i].score, "sorted desc");
  }
});

test("offline: save succeeds with needs_embedding, recall falls back to LIKE", async () => {
  const { engine, store } = makeEngine(fakeEmbedder(true));
  const r = await engine.saveMemory({
    type: "goal",
    body: "reach Staff Engineer",
    source: "manual",
  });
  assert.equal(r.action, "created");
  const pending = store.pendingEmbedding();
  assert.equal(pending.length, 1, "flagged for later embedding");

  const hits = await engine.recall("Staff Engineer", { k: 5 });
  assert.equal(hits.length, 1, "LIKE fallback finds it");
  assert.equal(hits[0].score, 0.5);
});

test("re-embed pending clears the flag once embeddings return", async () => {
  const store = new FakeStore();
  const vectors = new FakeVectorIndex(store);
  let offline = true;
  const embed: Embedder = async (text) =>
    offline ? null : fakeEmbedder()(text);
  const engine = new MemoryEngine(store, vectors, embed);

  await engine.saveMemory({ type: "goal", body: "reach Staff Engineer", source: "m" });
  assert.equal(store.pendingEmbedding().length, 1);
  offline = false;
  const n = await engine.reembedPending();
  assert.equal(n, 1);
  assert.equal(store.pendingEmbedding().length, 0);
});

test("graph dedupes bidirectional edges to existing nodes", async () => {
  const { engine, store } = makeEngine(fakeEmbedder());
  const a = await engine.saveMemory({ type: "goal", body: "reach Staff Engineer", source: "m" });
  const b = await engine.saveMemory({ type: "skill", body: "weak at graphs", source: "m" });
  // link both directions + a dangling link
  await engine.updateMemory(a.record.id, { links: [b.record.id, "ghost"] });
  await engine.updateMemory(b.record.id, { links: [a.record.id] });
  const g = engine.graph();
  assert.equal(g.nodes.length, 2);
  assert.equal(g.edges.length, 1, "A<->B collapses to one edge, ghost dropped");
  void store;
});

test("deriveProfile builds derived views over records", () => {
  const now = new Date().toISOString();
  const rec = (over: Partial<MemoryRecord>): MemoryRecord => ({
    id: Math.random().toString(36).slice(2),
    type: "goal",
    title: "t",
    body: "b",
    confidence: 0.7,
    source: "m",
    tags: [],
    links: [],
    createdAt: now,
    updatedAt: now,
    history: [],
    ...over,
  });

  const records: MemoryRecord[] = [
    rec({ type: "identity", title: "Abhay — Staff Engineer candidate", body: "" }),
    rec({ type: "goal", title: "Reach Staff Engineer", confidence: 0.9 }),
    rec({ type: "goal", title: "Learn Rust", confidence: 0.6 }),
    rec({ type: "skill", title: "Dijkstra pattern", tags: ["strength"] }),
    rec({ type: "skill", title: "DP pattern", tags: ["weakness"] }),
    rec({ type: "mistake", title: "Complexity miscalculation", tags: ["count:8"] }),
    rec({ type: "mistake", title: "Communication", tags: ["count:2"] }),
    rec({ type: "book", title: "DDIA", body: "Currently 42% through" }),
  ];

  const p = deriveProfile(records);
  assert.deepEqual(p.identity, { name: "Abhay", role: "Staff Engineer candidate" });
  assert.equal(p.goals[0].title, "Reach Staff Engineer", "goals by confidence desc");
  assert.equal(p.strengths.length, 1);
  assert.equal(p.weaknesses.length, 1);
  assert.equal(p.mistakes[0].count, 8, "mistakes sorted by count desc");
  assert.equal(p.mistakes[0].title, "Complexity miscalculation");
  assert.equal(p.reading[0].percent, 42);
  assert.equal(p.counts.goal, 2);
  assert.equal(p.counts.mistake, 2);
});
