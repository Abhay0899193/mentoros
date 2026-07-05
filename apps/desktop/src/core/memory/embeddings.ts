/**
 * Embeddings adapter — talks HTTP to a locally running Ollama daemon and turns
 * text into a 768-dim `nomic-embed-text` vector. Framework-agnostic, no SDK.
 *
 * Graceful degradation is a first-class concern (§2.3): when Ollama is offline
 * this resolves to `null` rather than throwing, so memory writes still succeed
 * (flagged `needs_embedding`) and recall can fall back to SQLite LIKE search.
 * A small in-process LRU keeps repeat embeds (e.g. re-import idempotency, chat
 * recall of the same query) off the wire.
 */

const OLLAMA_BASE = "http://127.0.0.1:11434";
export const EMBED_MODEL = "nomic-embed-text";
export const EMBED_DIM = 768;

/** First embed can trigger a model load; give it room but never hang forever. */
const EMBED_TIMEOUT_MS = 20_000;
const CACHE_MAX = 512;

/** A function that maps text → unit-normalized vector, or `null` when offline. */
export type Embedder = (text: string) => Promise<number[] | null>;

/** Simple insertion-ordered LRU keyed by the raw text. */
class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // refresh recency
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
  clear(): void {
    this.map.clear();
  }
}

const cache = new LruCache<number[]>(CACHE_MAX);

/** L2-normalize in place so downstream cosine similarity is a plain dot product. */
export function normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

/**
 * Embed `text` via Ollama. Returns a unit vector, or `null` if the daemon is
 * unreachable / errors / returns an empty embedding. Never throws.
 */
export const embed: Embedder = async (text: string) => {
  const key = text.trim();
  if (key.length === 0) return null;
  const cached = cache.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: key }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      embedding?: number[];
      error?: string;
    };
    if (data.error || !Array.isArray(data.embedding) || data.embedding.length === 0) {
      return null;
    }
    const vec = normalize(data.embedding);
    cache.set(key, vec);
    return vec;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Test seam: drop cached vectors. */
export function clearEmbedCache(): void {
  cache.clear();
}
