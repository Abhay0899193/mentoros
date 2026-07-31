/**
 * Reader data layer — one static bundle, fetched once, nothing else.
 *
 * The Reader is deliberately write-free: it has no core, no API and no network
 * beyond `content.json` (built by `tools/reader-export.mts`). Anything that
 * feels like state — where you left off, what you've opened — is local to the
 * phone and lives in localStorage.
 */
import {
  partNumber,
  topicValues,
  weekNumbers,
} from '../renderer/app/screens/knowledge/collections';

export interface ReaderDoc {
  id: string;
  title: string;
  tags: string[];
  markdown: string;
  minutes: number;
  readAt: string | null;
}

export interface WeekProgress {
  phase: number;
  week: number;
  focus?: string;
  days: { id: string; day: number; state: string; taskCount: number; doneCount: number }[];
}

export interface PlanDay {
  id: string;
  phase: number;
  week: number;
  day: number;
  title: string;
  focus?: string | null;
}

export interface PlanTask {
  id: string;
  dayId: string;
  kind: string;
  title: string;
  url?: string;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
}

export interface ReaderBundle {
  generatedAt: string;
  docs: ReaderDoc[];
  plan: { days: PlanDay[]; tasks: PlanTask[] };
  weeks: WeekProgress[] | null;
}

export type DocKind = 'guide' | 'sheet' | 'day';

export function docKind(doc: ReaderDoc): DocKind {
  if (doc.tags.includes('quick-review')) return 'sheet';
  if (doc.tags.includes('day-note')) return 'day';
  return 'guide';
}

/** First `week:N` tag, or null — guides can carry several; the first orders them. */
export function weekOf(doc: ReaderDoc): number | null {
  const weeks = weekNumbers(doc.tags);
  return weeks.length ? Math.min(...weeks) : null;
}

export function partOf(doc: ReaderDoc): number | null {
  return partNumber(doc.tags);
}

export function topicsOf(doc: ReaderDoc): string[] {
  return topicValues(doc.tags);
}

/** The plan day a day-note belongs to (`day:phase-1-week-2-day-3`). */
export function dayIdOf(doc: ReaderDoc): string | null {
  const tag = doc.tags.find((t) => t.startsWith('day:'));
  return tag ? tag.slice('day:'.length) : null;
}

/** Study-flow order: week asc → part asc → title (mirrors the Knowledge screen). */
export function flowCompare(a: ReaderDoc, b: ReaderDoc): number {
  const wa = weekOf(a);
  const wb = weekOf(b);
  if (wa !== wb) {
    if (wa === null) return 1;
    if (wb === null) return -1;
    return wa - wb;
  }
  const pa = partOf(a);
  const pb = partOf(b);
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }
  return a.title.localeCompare(b.title);
}

/** Other parts of the same week's guide, in reading order — powers prev/next. */
export function siblings(bundle: ReaderBundle, doc: ReaderDoc): ReaderDoc[] {
  const week = weekOf(doc);
  if (week === null || docKind(doc) !== 'guide') return [];
  return bundle.docs
    .filter((d) => docKind(d) === 'guide' && weekOf(d) === week)
    .sort(flowCompare);
}

/**
 * Title matches rank above body matches, and body matches carry the line they
 * hit so the result list can show why it matched. Plain substring scan: 185
 * docs of markdown is ~1.6 MB, which a phone filters in a few milliseconds —
 * an index would be more code and more bundle for no felt gain.
 */
export interface SearchHit {
  doc: ReaderDoc;
  snippet: string | null;
}

export function search(bundle: ReaderBundle, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const titleHits: SearchHit[] = [];
  const bodyHits: SearchHit[] = [];
  for (const doc of bundle.docs) {
    if (doc.title.toLowerCase().includes(q)) {
      titleHits.push({ doc, snippet: null });
      continue;
    }
    const at = doc.markdown.toLowerCase().indexOf(q);
    if (at === -1) continue;
    const start = Math.max(0, at - 60);
    const snippet = doc.markdown
      .slice(start, at + q.length + 90)
      .replace(/[#*`>|]/g, '')
      // Mermaid labels carry literal "\n" escapes; they'd read as noise here.
      .replace(/\\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    bodyHits.push({ doc, snippet: `${start > 0 ? '…' : ''}${snippet}…` });
  }
  return [...titleHits.sort((a, b) => flowCompare(a.doc, b.doc)), ...bodyHits].slice(0, 40);
}

/* ------------------------------ local state ----------------------------- */

const RECENT_KEY = 'reader.recent';
const SCROLL_KEY = 'reader.scroll';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the Reader works fine without memory */
  }
}

/** Doc ids most-recently opened first, capped at 12. */
export function recentIds(): string[] {
  return readJson<string[]>(RECENT_KEY, []);
}

export function pushRecent(id: string): void {
  const next = [id, ...recentIds().filter((x) => x !== id)].slice(0, 12);
  writeJson(RECENT_KEY, next);
}

/** How far through each doc you got, 0–1, so "Continue" resumes mid-page. */
export function scrollRatios(): Record<string, number> {
  return readJson<Record<string, number>>(SCROLL_KEY, {});
}

export function saveScrollRatio(id: string, ratio: number): void {
  const all = scrollRatios();
  all[id] = Math.min(1, Math.max(0, ratio));
  writeJson(SCROLL_KEY, all);
}

export async function loadBundle(): Promise<ReaderBundle> {
  // Relative so the app works on any host/path (vercel.app, a custom domain,
  // or file:// during a local check).
  const res = await fetch('./content.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`content.json: HTTP ${res.status}`);
  return (await res.json()) as ReaderBundle;
}
