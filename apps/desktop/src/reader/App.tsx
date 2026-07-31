/**
 * MentorOS Reader — the read-only, offline-capable half of MentorOS, sized for
 * a phone and ten spare minutes (docs/READER.md).
 *
 * Routing is the URL hash on purpose: the iOS back gesture and the Android back
 * button then mean what a reader expects, with no router dependency.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BookOpen, CalendarRange, Home } from 'lucide-react';
import { cn } from '../renderer/lib/cn';
import { spring, dur } from '../renderer/motion/springs';
import { loadBundle, type ReaderBundle } from './bundle';
import { Placeholder } from './ui';
import { TodayView } from './TodayView';
import { LibraryView } from './LibraryView';
import { PlanView } from './PlanView';
import { DocView } from './DocView';

export type Route =
  | { view: 'today' }
  | { view: 'library' }
  | { view: 'plan' }
  | { view: 'doc'; id: string };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('read/')) return { view: 'doc', id: decodeURIComponent(hash.slice(5)) };
  if (hash === 'library') return { view: 'library' };
  if (hash === 'plan') return { view: 'plan' };
  return { view: 'today' };
}

export function hrefFor(route: Route): string {
  switch (route.view) {
    case 'doc':
      return `#/read/${encodeURIComponent(route.id)}`;
    case 'today':
      return '#/';
    default:
      return `#/${route.view}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = (): void => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

const TABS = [
  { view: 'today', label: 'Today', icon: Home },
  { view: 'library', label: 'Library', icon: BookOpen },
  { view: 'plan', label: 'Plan', icon: CalendarRange },
] as const;

function TabBar({ route }: { route: Route }) {
  const reduce = useReducedMotion();
  return (
    <nav
      className={cn(
        'bg-canvas/95 border-line fixed inset-x-0 bottom-0 z-30 flex border-t px-2 backdrop-blur-xl',
        'pb-safe px-safe',
      )}
    >
      {TABS.map(({ view, label, icon: Icon }) => {
        const active = route.view === view;
        return (
          <a
            key={view}
            href={hrefFor({ view })}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'tap-target relative flex flex-1 flex-col items-center justify-center gap-1 pt-2.5 pb-2',
              'text-faint transition-colors',
              active && 'text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId="reader-tab"
                transition={reduce ? { duration: dur.micro } : spring.smooth}
                className="aurora-bg absolute top-0 h-[2px] w-8 rounded-full"
              />
            )}
            <Icon size={21} strokeWidth={1.6} />
            <span className="text-[11px] leading-none font-medium">{label}</span>
          </a>
        );
      })}
    </nav>
  );
}

export default function App() {
  const [bundle, setBundle] = useState<ReaderBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = useRoute();
  const reduce = useReducedMotion();

  useEffect(() => {
    loadBundle()
      .then(setBundle)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Each screen owns its scroll position; a fresh route always starts at the
  // top (DocView restores its own saved position afterwards).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.view, route.view === 'doc' ? route.id : '']);

  if (error) {
    return (
      <Placeholder
        title="Couldn't load your library"
        body={`${error}. If this is the first run, publish a bundle with "pnpm reader:export".`}
      />
    );
  }
  if (!bundle) {
    return <Placeholder title="Opening your library…" />;
  }

  const doc = route.view === 'doc' ? bundle.docs.find((d) => d.id === route.id) : undefined;

  return (
    <div className="bg-canvas min-h-dvh">
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={route.view === 'doc' ? `doc:${route.id}` : route.view}
          initial={reduce ? false : { opacity: 0, y: route.view === 'doc' ? 12 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={reduce ? { duration: dur.micro } : spring.smooth}
          className={cn('px-safe', route.view === 'doc' ? 'pb-16' : 'pb-safe-plus-20')}
        >
          {route.view === 'today' && <TodayView bundle={bundle} />}
          {route.view === 'library' && <LibraryView bundle={bundle} />}
          {route.view === 'plan' && <PlanView bundle={bundle} />}
          {route.view === 'doc' &&
            (doc ? (
              <DocView bundle={bundle} doc={doc} />
            ) : (
              <Placeholder
                title="Not in this bundle"
                body="It may have been written after the last publish."
              />
            ))}
        </motion.main>
      </AnimatePresence>
      {route.view !== 'doc' && <TabBar route={route} />}
    </div>
  );
}
