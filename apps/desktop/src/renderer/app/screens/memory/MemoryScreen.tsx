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
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-6">
        <div className="flex items-center rounded-[10px] bg-surface-2 hairline p-0.5">
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
                'flex h-7 items-center gap-1.5 rounded-[8px] px-3 text-small',
                view === t.id ? 'bg-surface-1 text-ink hairline' : 'text-muted hover:text-body',
              )}
            >
              <t.icon size={14} strokeWidth={1.5} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex h-8 w-64 items-center gap-2 rounded-full bg-surface-2 hairline px-3">
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
