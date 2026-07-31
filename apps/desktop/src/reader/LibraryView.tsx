/**
 * Library — everything, filterable and searchable. Search runs over the whole
 * bundle in memory, so it works with the phone in airplane mode.
 */
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../renderer/lib/cn';
import {
  docKind,
  flowCompare,
  scrollRatios,
  search,
  weekOf,
  type DocKind,
  type ReaderBundle,
  type ReaderDoc,
} from './bundle';
import { navigate } from './App';
import { Chip, DocCard, Placeholder, SectionLabel } from './ui';

type Filter = { kind: DocKind | 'all'; week: number | null };

function groupLabel(doc: ReaderDoc): string {
  const kind = docKind(doc);
  if (kind === 'sheet') return 'Quick review';
  const week = weekOf(doc);
  if (week === null) return 'Unfiled';
  return kind === 'day' ? `Week ${week} · day notes` : `Week ${week}`;
}

export function LibraryView({ bundle }: { bundle: ReaderBundle }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'guide', week: null });
  const ratios = scrollRatios();

  const weeks = useMemo(
    () =>
      [...new Set(bundle.docs.map(weekOf).filter((w): w is number => w !== null))].sort(
        (a, b) => a - b,
      ),
    [bundle],
  );

  const hits = useMemo(() => search(bundle, query), [bundle, query]);

  const groups = useMemo(() => {
    const docs = bundle.docs
      .filter((d) => (filter.kind === 'all' ? true : docKind(d) === filter.kind))
      .filter((d) => (filter.week === null ? true : weekOf(d) === filter.week))
      .sort(flowCompare);
    const map = new Map<string, ReaderDoc[]>();
    for (const doc of docs) {
      const label = groupLabel(doc);
      const arr = map.get(label) ?? [];
      arr.push(doc);
      map.set(label, arr);
    }
    return [...map.entries()];
  }, [bundle, filter]);

  return (
    <>
      <header className="bg-canvas/95 border-line sticky top-0 z-20 border-b px-5 pt-safe-plus-6 pb-3 backdrop-blur-xl">
        <div className="hairline bg-surface-1 flex items-center gap-2 rounded-[10px] px-3">
          <Search size={16} strokeWidth={1.8} className="text-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search every guide…"
            aria-label="Search"
            className="text-ink placeholder:text-faint h-11 w-full bg-transparent outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="text-faint tap-hit relative shrink-0"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          )}
        </div>
        {!query && (
          <div className="scrollbar-none -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
            {(
              [
                ['guide', 'Guides'],
                ['sheet', 'Sheets'],
                ['day', 'Day notes'],
                ['all', 'Everything'],
              ] as const
            ).map(([kind, label]) => (
              <Chip
                key={kind}
                active={filter.kind === kind}
                onClick={() => setFilter((f) => ({ ...f, kind }))}
              >
                {label}
              </Chip>
            ))}
            <span className="bg-line mx-1 w-px shrink-0" aria-hidden />
            {weeks.map((w) => (
              <Chip
                key={w}
                active={filter.week === w}
                onClick={() => setFilter((f) => ({ ...f, week: f.week === w ? null : w }))}
              >
                W{w}
              </Chip>
            ))}
          </div>
        )}
      </header>

      {query ? (
        hits.length === 0 ? (
          <Placeholder title="Nothing matched" body={`No guide mentions "${query.trim()}".`} />
        ) : (
          <div className={cn('flex flex-col gap-2.5 px-5 pt-2')}>
            {hits.map(({ doc, snippet }, i) => (
              <DocCard
                key={doc.id}
                doc={doc}
                index={i}
                snippet={snippet}
                onOpen={() => navigate({ view: 'doc', id: doc.id })}
              />
            ))}
          </div>
        )
      ) : groups.length === 0 ? (
        <Placeholder title="Nothing here yet" body="Try another filter." />
      ) : (
        groups.map(([label, docs]) => (
          <section key={label}>
            <SectionLabel>{label}</SectionLabel>
            <div className="flex flex-col gap-2.5 px-5">
              {docs.map((doc, i) => (
                <DocCard
                  key={doc.id}
                  doc={doc}
                  index={i}
                  progress={ratios[doc.id]}
                  onOpen={() => navigate({ view: 'doc', id: doc.id })}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
