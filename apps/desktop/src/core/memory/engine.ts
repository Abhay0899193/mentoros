import { randomUUID } from "node:crypto";
import type {
  CoreEvents,
  DerivedProfile,
  MemoryGraphData,
  MemoryRecord,
  MemoryType,
  RecallHit,
  SaveMemoryInput,
  SaveMemoryResult,
} from "../types.js";
import { embed as defaultEmbed, type Embedder } from "./embeddings.js";
import type { MemoryStore } from "./store.js";
import type { VectorIndex } from "./vectorIndex.js";

/**
 * MemoryEngine — the differentiator (§2.3). Stores knowledge, not chat logs:
 * every save embeds `title? + body`, finds the nearest same-type record, and if
 * they are near-duplicates (cosine ≥ {@link SIMILARITY_MERGE_THRESHOLD}) MERGES
 * into that record instead of appending a new one. Profile/graph are derived
 * views computed on read, never stored.
 */

/** Cosine at/above which a save merges into the nearest same-type record. */
export const SIMILARITY_MERGE_THRESHOLD = 0.86;
/** Recall drops hits weaker than this (contract default for /memories/recall). */
export const RECALL_MIN_SCORE = 0.45;
const DEFAULT_CONFIDENCE = 0.7;
const CONFIDENCE_BUMP = 0.05;
const CONFIDENCE_CAP = 0.99;
const HISTORY_CAP = 20;
const TITLE_MAX = 60;
/** Flat score assigned to LIKE-fallback hits when embeddings are unavailable. */
const LIKE_FALLBACK_SCORE = 0.5;
const REEMBED_INTERVAL_MS = 20_000;

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

export interface RecallOpts {
  k?: number;
  types?: MemoryType[];
  minScore?: number;
}

function deriveTitle(body: string): string {
  const clean = body.trim().replace(/\s+/g, " ");
  return clean.length > TITLE_MAX ? clean.slice(0, TITLE_MAX) : clean;
}

function unionTags(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

export class MemoryEngine {
  private reembedTimer: ReturnType<typeof setInterval> | null = null;
  private reembedding = false;

  constructor(
    private readonly store: MemoryStore,
    private readonly vectors: VectorIndex,
    private readonly embed: Embedder = defaultEmbed,
    private readonly broadcast?: Broadcast,
  ) {}

  /* ----------------------- upsert-by-similarity ----------------------- */

  async saveMemory(input: SaveMemoryInput): Promise<SaveMemoryResult> {
    const body = input.body.trim();
    const title = input.title?.trim();
    const now = new Date().toISOString();
    const embedText = (title ? `${title}\n` : "") + body;
    const vec = await this.embed(embedText);

    // Dedupe only when we can compare: nearest same-type record.
    if (vec) {
      const [top] = this.vectors.search(vec, 1, { types: [input.type] });
      if (top && top.score >= SIMILARITY_MERGE_THRESHOLD) {
        const existing = this.store.get(top.id);
        if (existing) {
          return this.merge(existing, input, body, title, vec, now, top.score);
        }
      }
    }
    return this.create(input, body, title, vec, now);
  }

  private create(
    input: SaveMemoryInput,
    body: string,
    title: string | undefined,
    vec: number[] | null,
    now: string,
  ): SaveMemoryResult {
    const record: MemoryRecord = {
      id: randomUUID(),
      type: input.type,
      title: title && title.length > 0 ? title : deriveTitle(body),
      body,
      confidence: input.confidence ?? DEFAULT_CONFIDENCE,
      source: input.source,
      tags: input.tags ? [...input.tags] : [],
      links: [],
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    this.store.insert(record, vec === null);
    if (vec) this.vectors.upsertVector(record.id, vec);
    const result: SaveMemoryResult = { record, action: "created" };
    this.broadcast?.("memory.saved", result);
    return result;
  }

  private merge(
    existing: MemoryRecord,
    input: SaveMemoryInput,
    body: string,
    title: string | undefined,
    vec: number[],
    now: string,
    similarity: number,
  ): SaveMemoryResult {
    const history = [
      ...existing.history,
      { at: existing.updatedAt, body: existing.body },
    ].slice(-HISTORY_CAP);
    const newConfidence = Math.min(
      CONFIDENCE_CAP,
      Math.max(existing.confidence, input.confidence ?? existing.confidence) +
        CONFIDENCE_BUMP,
    );
    const record: MemoryRecord = {
      ...existing,
      title: title && title.length > 0 ? title : existing.title,
      body,
      confidence: newConfidence,
      tags: unionTags(existing.tags, input.tags ?? []),
      updatedAt: now,
      history,
    };
    this.store.update(record, false);
    this.vectors.upsertVector(record.id, vec);
    const result: SaveMemoryResult = {
      record,
      action: "merged",
      similarity,
    };
    this.broadcast?.("memory.saved", result);
    return result;
  }

  /* ------------------------------- CRUD ------------------------------- */

  listMemories(opts: { type?: MemoryType; q?: string; limit?: number } = {}): MemoryRecord[] {
    return this.store.list(opts);
  }

  getMemory(id: string): MemoryRecord | undefined {
    return this.store.get(id);
  }

  async updateMemory(
    id: string,
    patch: Partial<
      Pick<MemoryRecord, "title" | "body" | "type" | "tags" | "confidence" | "links">
    >,
  ): Promise<MemoryRecord | undefined> {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const titleChanged =
      patch.title !== undefined && patch.title !== existing.title;
    const record: MemoryRecord = {
      ...existing,
      title: patch.title ?? existing.title,
      body: patch.body ?? existing.body,
      type: patch.type ?? existing.type,
      tags: patch.tags ?? existing.tags,
      confidence: patch.confidence ?? existing.confidence,
      links: patch.links ?? existing.links,
      updatedAt: new Date().toISOString(),
    };

    if (bodyChanged || titleChanged) {
      const embedText = `${record.title}\n${record.body}`;
      const vec = await this.embed(embedText);
      this.store.update(record, vec === null);
      if (vec) this.vectors.upsertVector(record.id, vec);
    } else {
      this.store.update(record);
    }
    return record;
  }

  deleteMemory(id: string): boolean {
    if (!this.store.get(id)) return false;
    this.store.delete(id);
    this.vectors.removeVector(id);
    return true;
  }

  /* ------------------------------ recall ------------------------------ */

  async recall(query: string, opts: RecallOpts = {}): Promise<RecallHit[]> {
    const k = opts.k ?? 5;
    const minScore = opts.minScore ?? RECALL_MIN_SCORE;
    const vec = await this.embed(query);

    if (vec) {
      const hits = this.vectors.search(vec, k, { types: opts.types });
      const out: RecallHit[] = [];
      for (const h of hits) {
        if (h.score < minScore) continue;
        const record = this.store.get(h.id);
        if (record) out.push({ record, score: h.score });
      }
      return out;
    }

    // Embeddings unavailable: LIKE fallback over title+body, flat score.
    if (LIKE_FALLBACK_SCORE < minScore) return [];
    const records = this.store.likeSearch(query, opts.types, k);
    return records.map((record) => ({ record, score: LIKE_FALLBACK_SCORE }));
  }

  /* ------------------------------- graph ------------------------------ */

  graph(): MemoryGraphData {
    const records = this.store.all();
    const ids = new Set(records.map((r) => r.id));
    const nodes = records.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      confidence: r.confidence,
    }));
    const seen = new Set<string>();
    const edges: { source: string; target: string }[] = [];
    for (const r of records) {
      for (const target of r.links) {
        if (!ids.has(target) || target === r.id) continue;
        const key = r.id < target ? `${r.id}|${target}` : `${target}|${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: r.id, target });
      }
    }
    return { nodes, edges };
  }

  /* ------------------------------ profile ----------------------------- */

  profile(): DerivedProfile {
    return deriveProfile(this.store.all());
  }

  /* ------------------- background re-embedding retry ------------------ */

  startBackgroundReembed(): void {
    if (this.reembedTimer) return;
    this.reembedTimer = setInterval(() => {
      void this.reembedPending();
    }, REEMBED_INTERVAL_MS);
    // Do not keep the event loop alive on account of this timer.
    (this.reembedTimer as unknown as { unref?: () => void }).unref?.();
  }

  /** Try to embed any records flagged needs_embedding. Safe to call anytime. */
  async reembedPending(): Promise<number> {
    if (this.reembedding) return 0;
    this.reembedding = true;
    let done = 0;
    try {
      for (const record of this.store.pendingEmbedding()) {
        const vec = await this.embed(`${record.title}\n${record.body}`);
        if (!vec) break; // still offline; try again next tick
        this.vectors.upsertVector(record.id, vec);
        this.store.setNeedsEmbedding(record.id, false);
        done += 1;
      }
    } finally {
      this.reembedding = false;
    }
    return done;
  }

  close(): void {
    if (this.reembedTimer) {
      clearInterval(this.reembedTimer);
      this.reembedTimer = null;
    }
  }
}

/* --------------------------- derived profile --------------------------- */

const META_TAGS = new Set([
  "stack",
  "import",
  "auto",
  "strength",
  "weakness",
  "pattern",
  "review-queue",
  "progress",
]);

function parseIdentity(record: MemoryRecord): { name: string; role: string } | null {
  // Heuristic: "Name — Role" (em dash / hyphen) in title, then body.
  const candidates = [record.title, record.body];
  for (const text of candidates) {
    const m = text.match(/^\s*([^—\-\n]+?)\s*[—-]\s*(.+?)\s*$/);
    if (m && m[1].trim() && m[2].trim()) {
      return { name: m[1].trim(), role: m[2].split("\n")[0].trim() };
    }
  }
  return null;
}

function parsePercent(body: string): number | null {
  const m = body.match(/(\d{1,3})\s*%/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? Math.min(100, n) : null;
}

function parseCount(tags: string[]): number {
  for (const t of tags) {
    const m = t.match(/^count:(\d+)$/i);
    if (m) return Number.parseInt(m[1], 10);
  }
  return 1;
}

export function deriveProfile(records: MemoryRecord[]): DerivedProfile {
  const byType = (t: MemoryType) => records.filter((r) => r.type === t);
  const hasTag = (r: MemoryRecord, tag: string) => r.tags.includes(tag);

  const identityRecords = byType("identity").sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const identity = identityRecords.length ? parseIdentity(identityRecords[0]) : null;

  const goals = byType("goal").sort((a, b) => b.confidence - a.confidence);
  const strengths = byType("skill").filter((r) => hasTag(r, "strength"));
  const weaknesses = byType("skill").filter((r) => hasTag(r, "weakness"));

  // stack: non-meta tags carried by records tagged 'stack', plus preferences
  // tagged 'stack'. Kept deliberately simple (documented heuristic).
  const stackSet = new Set<string>();
  for (const r of records) {
    if (!hasTag(r, "stack")) continue;
    for (const t of r.tags) if (!META_TAGS.has(t)) stackSet.add(t);
  }
  const stack = Array.from(stackSet);

  const reading = byType("book").map((r) => ({
    title: r.title,
    percent: parsePercent(r.body),
    recordId: r.id,
  }));

  const mistakes = byType("mistake")
    .map((r) => ({
      recordId: r.id,
      title: r.title,
      count: parseCount(r.tags),
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => b.count - a.count);

  const counts: Partial<Record<MemoryType, number>> = {};
  for (const r of records) counts[r.type] = (counts[r.type] ?? 0) + 1;

  return {
    identity,
    goals,
    strengths,
    weaknesses,
    stack,
    reading,
    mistakes,
    counts,
  };
}
