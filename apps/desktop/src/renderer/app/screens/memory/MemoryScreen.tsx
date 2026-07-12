import { useEffect, useRef, useState } from 'react';
import { Search, User, Waypoints } from 'lucide-react';
import { useMemories } from '../../../lib/memoryStore';
import { cn } from '../../../lib/cn';
import { GraphView } from './GraphView';
import { ProfileView } from './ProfileView';
import { MemoryDrawer } from './MemoryDrawer';

export function MemoryScreen() {
  const { init, view, setView, query, setQuery } = useMemories();
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => init(), [init]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex h-auto shrink-0 flex-col items-stretch gap-2 px-6 py-3 md:h-14 md:flex-row md:items-center md:justify-between md:gap-4 md:py-0">
        <div className="flex w-full items-center rounded-[10px] bg-surface-2 hairline p-0.5 md:w-fit">
          {(
            [
              { id: 'profile', label: 'Profile', icon: User },
              { id: 'graph', label: 'Graph', icon: Waypoints },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={cn(
                'tap-target flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-3 text-small md:flex-none md:justify-start',
                view === t.id ? 'bg-surface-1 text-ink hairline' : 'text-muted hover:text-body',
              )}
            >
              <t.icon size={14} strokeWidth={1.5} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex h-8 w-full items-center gap-2 rounded-full bg-surface-2 hairline px-3 md:w-64">
          <Search size={13} strokeWidth={1.5} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={view === 'graph' ? 'Filter the graph…' : 'Search memories…'}
            aria-label="Search memories"
            className="w-full bg-transparent text-small text-ink outline-none placeholder:text-faint"
          />
        </div>
      </header>

      <div ref={areaRef} className="min-h-0 flex-1 overflow-hidden px-6">
        {view === 'graph' ? (
          <GraphView width={size.w} height={size.h} />
        ) : (
          <div className="h-full overflow-y-auto">
            <ProfileView />
          </div>
        )}
      </div>

      <MemoryDrawer />
    </div>
  );
}
