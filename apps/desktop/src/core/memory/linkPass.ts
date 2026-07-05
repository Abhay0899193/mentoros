/**
 * Memory auto-linking. The graph is otherwise edge-less: this pass links two
 * records when one record's title-concept is referenced in another's body. For
 * each record O whose cleaned title has ≥2 significant tokens (stop-words
 * removed), any record R whose body mentions ALL of those tokens gets a
 * bidirectional link to O. Links are deduped and capped per record.
 *
 * Pure over a minimal record shape so it is unit-testable without the DB.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at",
  "by", "from", "as", "is", "are", "was", "be", "this", "that", "it", "its",
  "review", "pattern", "notes", "confidence", "grade", "mastery", "new",
  "spaced", "repetition", "import", "your", "you",
]);

const MIN_TOKEN_LEN = 3;
const MIN_SIGNIFICANT_TOKENS = 2;
const MAX_LINKS = 5;

export interface LinkableRecord {
  id: string;
  title: string;
  body: string;
  links: string[];
}

function significantTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < MIN_TOKEN_LEN) continue;
    if (STOP_WORDS.has(raw)) continue;
    seen.add(raw);
  }
  return [...seen];
}

function bodyWordSet(body: string): Set<string> {
  return new Set(
    body.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= MIN_TOKEN_LEN),
  );
}

/**
 * Compute the merged link set for every record. Returns a map of recordId →
 * new links array (existing links preserved, deduped, capped) ONLY for records
 * whose link set changed.
 */
export function computeLinks(
  records: LinkableRecord[],
): Map<string, string[]> {
  const titleTokens = new Map<string, string[]>();
  for (const r of records) {
    const toks = significantTokens(r.title);
    if (toks.length >= MIN_SIGNIFICANT_TOKENS) titleTokens.set(r.id, toks);
  }

  // Start from existing links so the pass is additive + idempotent.
  const linkSets = new Map<string, Set<string>>();
  for (const r of records) linkSets.set(r.id, new Set(r.links));

  for (const r of records) {
    const words = bodyWordSet(r.body);
    for (const [oid, toks] of titleTokens) {
      if (oid === r.id) continue;
      if (toks.every((t) => words.has(t))) {
        linkSets.get(r.id)!.add(oid);
        linkSets.get(oid)!.add(r.id);
      }
    }
  }

  const changed = new Map<string, string[]>();
  for (const r of records) {
    const set = linkSets.get(r.id)!;
    set.delete(r.id);
    const capped = [...set].slice(0, MAX_LINKS);
    const before = [...new Set(r.links)].filter((x) => x !== r.id);
    const sameLength = capped.length === before.length;
    const same = sameLength && before.every((x) => capped.includes(x));
    if (!same) changed.set(r.id, capped);
  }
  return changed;
}
