/**
 * Today — the ten-minute screen. Whatever you were reading, plus the week
 * you're actually on. Everything else is one tap away in Library.
 */
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Moon, Sun } from 'lucide-react';
import { cn } from '../renderer/lib/cn';
import { spring } from '../renderer/motion/springs';
import { useTheme } from '../renderer/theme/ThemeProvider';
import {
  docKind,
  flowCompare,
  recentIds,
  scrollRatios,
  weekOf,
  type ReaderBundle,
} from './bundle';
import { navigate } from './App';
import { Chip, DocCard, SectionLabel } from './ui';

/** The week the desktop app says you're on; falls back to the newest week with guides. */
function currentWeek(bundle: ReaderBundle): number | null {
  const live = bundle.weeks
    ?.flatMap((w) => w.days.map((d) => ({ week: w.week, state: d.state })))
    .find((d) => d.state === 'current');
  if (live) return live.week;
  const weeks = bundle.docs
    .filter((d) => docKind(d) === 'guide')
    .map(weekOf)
    .filter((w): w is number => w !== null);
  return weeks.length ? Math.max(...weeks) : null;
}

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function TodayView({ bundle }: { bundle: ReaderBundle }) {
  const reduce = useReducedMotion();
  const theme = useTheme();
  const ratios = scrollRatios();
  const recent = recentIds()
    .map((id) => bundle.docs.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));
  const resume = recent[0];
  const week = currentWeek(bundle);
  const weekGuides = bundle.docs
    .filter((d) => docKind(d) === 'guide' && weekOf(d) === week)
    .sort(flowCompare);
  const sheets = bundle.docs.filter((d) => docKind(d) === 'sheet').sort(flowCompare);

  return (
    <>
      <header className="px-5 pt-safe-plus-8">
        <div className="flex items-start justify-between">
          <p className="text-label text-faint tracking-[0.12em] uppercase">MentorOS · Reader</p>
          {/* Reading happens on trains and in sunlight — the one control the
              Reader keeps from Settings. */}
          <button
            onClick={theme.toggle}
            aria-label={theme.theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            className="text-faint active:text-ink tap-target -mt-2.5 -mr-2 flex size-11 items-center justify-center rounded-[10px]"
          >
            {theme.theme === 'dark' ? (
              <Sun size={18} strokeWidth={1.7} />
            ) : (
              <Moon size={18} strokeWidth={1.7} />
            )}
          </button>
        </div>
        <h1 className="text-ink mt-1.5 text-[34px] leading-[1.1] font-semibold tracking-[-0.02em]">
          {week !== null ? (
            <>
              You're on <span className="aurora-text">week {week}</span>
            </>
          ) : (
            'Your library'
          )}
        </h1>
        <p className="text-small text-muted mt-2">
          {bundle.docs.length} docs · updated {relativeTime(bundle.generatedAt)}
        </p>
      </header>

      {resume && (
        <section className="px-5 pt-6">
          <motion.button
            onClick={() => navigate({ view: 'doc', id: resume.id })}
            whileTap={reduce ? undefined : { scale: 0.985 }}
            transition={spring.snappy}
            className={cn(
              'hairline bg-surface-1 relative w-full overflow-hidden rounded-[14px] p-5 text-left',
            )}
          >
            {/* Aurora wash — the one focal moment on the screen (§3.0: colour on
                state, never chrome). */}
            <span
              aria-hidden
              className="aurora-bg pointer-events-none absolute -top-16 -right-10 size-40 rounded-full opacity-25 blur-3xl"
            />
            <span className="text-label text-iris relative tracking-[0.08em] uppercase">
              Continue reading
            </span>
            <span className="text-ink relative mt-2 block text-[19px] leading-snug font-semibold">
              {resume.title}
            </span>
            <span className="text-small text-muted relative mt-2 flex items-center gap-1.5">
              {Math.round((ratios[resume.id] ?? 0) * 100)}% in · {resume.minutes} min total
              <ArrowRight size={14} strokeWidth={1.8} className="ml-auto" />
            </span>
            <span className="bg-surface-3 absolute inset-x-0 bottom-0 h-[3px]">
              <span
                className="aurora-bg block h-full"
                style={{ width: `${Math.round((ratios[resume.id] ?? 0) * 100)}%` }}
              />
            </span>
          </motion.button>
        </section>
      )}

      {weekGuides.length > 0 && (
        <section>
          <SectionLabel>This week's guides</SectionLabel>
          <div className="flex flex-col gap-2.5 px-5">
            {weekGuides.map((doc, i) => (
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
      )}

      {sheets.length > 0 && (
        <section>
          <SectionLabel>Quick review</SectionLabel>
          <div className="scrollbar-none flex gap-2 overflow-x-auto px-5 pb-1">
            {sheets.map((doc) => (
              <Chip key={doc.id} onClick={() => navigate({ view: 'doc', id: doc.id })}>
                {doc.title}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {recent.length > 1 && (
        <section>
          <SectionLabel>Recently opened</SectionLabel>
          <div className="flex flex-col gap-2.5 px-5">
            {recent.slice(1, 6).map((doc, i) => (
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
      )}
    </>
  );
}
