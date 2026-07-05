import type { KbSearchHit } from "../types.js";
import type { Embedder } from "../memory/embeddings.js";
import type { IKbStore, KbChunkMeta } from "./store.js";
import type { KbVectorHit, KbVectorIndex } from "./vectorIndex.js";

/**
 * Hybrid search (§4.7): fuse an FTS5 lexical leg and a vector semantic leg with
 * reciprocal-rank fusion. Either leg may be empty — when Ollama is down the
 * vector leg is skipped and results degrade gracefully to FTS-only (every hit
 * `matched: 'fts'`). Fused scores are normalized 0..1 within the result set.
 */

export const RRF_K = 60;
const FTS_TAKE = 20;
const VEC_TAKE = 20;
const DEFAULT_K = 8;
const SNIPPET_CHARS = 200;

export interface HybridHit extends KbSearchHit {
  /** Best raw cosine for the vector leg, or null if this chunk was FTS-only. */
  vectorScore: number | null;
  /** Full chunk text — used to build grounded excerpts; stripped for the route. */
  text: string;
}

export interface FusedRow {
  chunkId: string;
  score: number;
  matched: "vector" | "fts" | "both";
  vectorScore: number | null;
}

/**
 * Reciprocal-rank fusion of a lexical rank list and a scored vector list. Both
 * inputs are best-first. `score` is the raw RRF sum normalized by the top score
 * so the best hit is 1.0 and everything else is a 0..1 fraction of it (stable
 * even for a single result, unlike min-max). Pure + deterministic for tests.
 */
export function fuse(
  ftsIds: string[],
  vecHits: KbVectorHit[],
  rrfK = RRF_K,
): FusedRow[] {
  const rrf = new Map<string, number>();
  const inFts = new Set<string>();
  const vectorScore = new Map<string, number>();

  ftsIds.forEach((id, i) => {
    inFts.add(id);
    rrf.set(id, (rrf.get(id) ?? 0) + 1 / (rrfK + i + 1));
  });
  vecHits.forEach((hit, i) => {
    vectorScore.set(hit.chunkId, hit.score);
    rrf.set(hit.chunkId, (rrf.get(hit.chunkId) ?? 0) + 1 / (rrfK + i + 1));
  });

  const rows: FusedRow[] = [];
  for (const [chunkId, raw] of rrf) {
    const hasVec = vectorScore.has(chunkId);
    const hasFts = inFts.has(chunkId);
    rows.push({
      chunkId,
      score: raw,
      matched: hasVec && hasFts ? "both" : hasVec ? "vector" : "fts",
      vectorScore: hasVec ? (vectorScore.get(chunkId) as number) : null,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const max = rows.length ? rows[0].score : 0;
  if (max > 0) for (const r of rows) r.score = r.score / max;
  return rows;
}

/** Build a ~200-char snippet centered on the first query-term match. */
export function makeSnippet(text: string, query: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= SNIPPET_CHARS) return clean;
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2);
  const lower = clean.toLowerCase();
  let hit = -1;
  for (const t of terms) {
    const idx = lower.indexOf(t);
    if (idx !== -1) {
      hit = idx;
      break;
    }
  }
  let start = 0;
  if (hit !== -1) start = Math.max(0, hit - Math.floor(SNIPPET_CHARS / 2));
  // Snap start back to a word boundary.
  if (start > 0) {
    const sp = clean.indexOf(" ", start);
    if (sp !== -1 && sp - start < 30) start = sp + 1;
  }
  const end = Math.min(clean.length, start + SNIPPET_CHARS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

export interface KbSearchDeps {
  store: IKbStore;
  vectors: KbVectorIndex;
  embed: Embedder;
}

export interface HybridSearchOpts {
  k?: number;
  sourceIds?: string[];
}

/**
 * Run the hybrid search. Returns rich {@link HybridHit}s (with the raw vector
 * cosine) so callers such as chat grounding can gate on lexical vs. semantic
 * strength; the HTTP route strips `vectorScore` down to the KbSearchHit contract.
 */
export async function hybridSearch(
  query: string,
  opts: HybridSearchOpts,
  deps: KbSearchDeps,
): Promise<HybridHit[]> {
  const q = query.trim();
  if (!q) return [];
  const k = opts.k && opts.k > 0 ? opts.k : DEFAULT_K;
  const sourceIds = opts.sourceIds && opts.sourceIds.length ? opts.sourceIds : undefined;

  const ftsIds = deps.store.ftsSearch(q, FTS_TAKE, sourceIds);

  let vecHits: KbVectorHit[] = [];
  const vec = await deps.embed(q, "query");
  // Gate the semantic leg: without it a nonsense query still "finds" the
  // nearest chunks and rank-normalization dresses them up as 90%+ relevant.
  // A vector hit counts only when the lexical leg corroborates it (short
  // keyword queries score as low as junk on nomic — measured: "sliding
  // window" 0.53 vs "asdf qwerty" 0.57) or its cosine clears the floor that
  // junk never reaches (junk tops out ~0.57; real semantic matches 0.72+).
  if (vec) {
    const ftsSet = new Set(ftsIds);
    vecHits = deps.vectors
      .search(vec, VEC_TAKE, sourceIds)
      .filter((h) => ftsSet.has(h.chunkId) || h.score >= GROUND_VECTOR_MIN);
  }

  const fused = fuse(ftsIds, vecHits).slice(0, k);
  const hits: HybridHit[] = [];
  for (const row of fused) {
    const chunk: KbChunkMeta | undefined = deps.store.getChunk(row.chunkId);
    if (!chunk) continue;
    const hit: HybridHit = {
      chunkId: chunk.id,
      sourceId: chunk.sourceId,
      sourceTitle: chunk.sourceTitle,
      kind: chunk.kind,
      snippet: makeSnippet(chunk.text, q),
      score: row.score,
      matched: row.matched,
      vectorScore: row.vectorScore,
      text: chunk.text,
    };
    if (chunk.section) hit.section = chunk.section;
    hits.push(hit);
  }
  return hits;
}

export function toKbSearchHit(hit: HybridHit): KbSearchHit {
  const out: KbSearchHit = {
    chunkId: hit.chunkId,
    sourceId: hit.sourceId,
    sourceTitle: hit.sourceTitle,
    kind: hit.kind,
    snippet: hit.snippet,
    score: hit.score,
    matched: hit.matched,
  };
  if (hit.section) out.section = hit.section;
  return out;
}

/* ------------------------------ grounding gate ----------------------------- */

/**
 * Pre-fusion cosine at/above which an uncorroborated vector hit is trusted —
 * used both to gate the semantic search leg and to decide chat grounding for a
 * vector-only top hit. Calibrated against the real KB with nomic-embed-text
 * (query→document, asymmetric): junk/off-topic queries top out ≈0.57 while
 * genuine semantic matches land 0.72+, so 0.6 sits in the gap. Lexical
 * (FTS / both-leg) hits bypass this — an exact keyword match in the docs is a
 * strong signal on its own.
 */
export const GROUND_VECTOR_MIN = 0.6;

export function isGrounded(hits: HybridHit[]): boolean {
  const top = hits[0];
  if (!top) return false;
  if (top.matched === "fts" || top.matched === "both") return true;
  return top.vectorScore !== null && top.vectorScore >= GROUND_VECTOR_MIN;
}
