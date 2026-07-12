import type { ReactNode } from 'react';
import { Search, SearchX } from 'lucide-react';
import { useKb } from '../../../lib/kbStore';
import type { KbSearchHit } from '../../../lib/coreClient';
import { Button, Chip } from '../../../ui';
import { KindGlyph } from './KindGlyph';

const MATCH_LABEL: Record<KbSearchHit['matched'], string> = {
  fts: 'Keyword',
  vector: 'Semantic',
  both: 'Hybrid',
};

function highlight(snippet: string, query: string): ReactNode {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (terms.length === 0) return snippet;
  const re = new RegExp(`(${terms.join('|')})`, 'gi');
  return snippet
    .split(re)
    .map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="rounded-[3px] bg-iris/20 px-0.5 text-ink">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 border-b border-line px-2 py-4">
      <div className="size-9 shrink-0 animate-pulse rounded-[10px] bg-surface-2" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-surface-2" />
        <div className="h-2 w-full animate-pulse rounded-full bg-surface-2" />
        <div className="h-2 w-2/3 animate-pulse rounded-full bg-surface-2" />
      </div>
    </div>
  );
}

/** Hybrid search results (§4.7) — FTS5 + vector, RRF-fused, term-highlighted. */
export function SearchView() {
  const query = useKb((s) => s.query);
  const results = useKb((s) => s.results);
  const searching = useKb((s) => s.searching);
  const searched = useKb((s) => s.searched);
  const searchError = useKb((s) => s.searchError);
  const openReading = useKb((s) => s.openReading);
  const setQuery = useKb((s) => s.setQuery);
  const runSearch = useKb((s) => s.runSearch);

  if (query.trim() === '') {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <Search size={28} strokeWidth={1.5} className="text-faint" />
        <p className="text-small text-muted">Search across every indexed source — keyword and meaning both.</p>
      </div>
    );
  }

  if (searching) {
    return (
      <div className="flex flex-col pt-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (searchError) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <SearchX size={28} strokeWidth={1.5} className="text-faint" />
        <div>
          <h2 className="text-h2 text-ink">Search is unavailable</h2>
          <p className="mx-auto mt-1 max-w-sm text-small text-muted">{searchError}</p>
        </div>
        <Button size="sm" onClick={() => void runSearch(query)}>
          Retry
        </Button>
      </div>
    );
  }

  if (searched && results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <SearchX size={28} strokeWidth={1.5} className="text-faint" />
        <div>
          <h2 className="text-h2 text-ink">No matches for “{query}”</h2>
          <p className="mx-auto mt-1 max-w-sm text-small text-muted">
            Try different terms, or index more sources — hybrid search only finds what’s ingested.
          </p>
        </div>
        <button
          onClick={() => setQuery('')}
          className="text-small font-medium text-ink underline-offset-2 hover:underline"
        >
          Back to library
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col pt-4 pb-10">
      {results.map((hit) => (
        <button
          key={hit.chunkId}
          onClick={() => openReading(hit.sourceId)}
          className="flex items-start gap-3 border-b border-line px-2 py-4 text-left last:border-b-0 hover:bg-surface-2"
        >
          <KindGlyph kind={hit.kind} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-small font-medium text-ink">{hit.sourceTitle}</span>
              {hit.section && (
                <span className="hidden max-w-[120px] shrink-0 truncate text-[12px] text-faint sm:inline">
                  › {hit.section}
                </span>
              )}
              <Chip className="shrink-0">{MATCH_LABEL[hit.matched]}</Chip>
            </div>
            <p className="mt-1 line-clamp-2 text-small leading-relaxed text-muted">
              {highlight(hit.snippet, query)}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1 w-24 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-iris/70"
                  style={{ width: `${Math.round(hit.score * 100)}%` }}
                />
              </div>
              <span className="font-mono text-[11px] text-faint tabular">{Math.round(hit.score * 100)}%</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
