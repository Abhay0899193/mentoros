/**
 * Plan — the 3mc path, read-only. Day-level progress comes from the desktop app
 * at publish time (per-task ticks stay on the laptop: the Reader never writes).
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronRight, ExternalLink, FileText } from 'lucide-react';
import { cn } from '../renderer/lib/cn';
import { spring, dur } from '../renderer/motion/springs';
import { dayIdOf, type PlanDay, type PlanTask, type ReaderBundle } from './bundle';
import { navigate } from './App';
import { Placeholder, SectionLabel } from './ui';

interface WeekGroup {
  key: string;
  phase: number;
  week: number;
  focus?: string | null;
  days: PlanDay[];
  done: number;
  total: number;
}

const DIFFICULTY_TONE = {
  Easy: 'text-success',
  Medium: 'text-warning',
  Hard: 'text-danger',
} as const;

export function PlanView({ bundle }: { bundle: ReaderBundle }) {
  const reduce = useReducedMotion();
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, PlanTask[]>();
    for (const task of bundle.plan.tasks) {
      const arr = map.get(task.dayId) ?? [];
      arr.push(task);
      map.set(task.dayId, arr);
    }
    return map;
  }, [bundle]);

  const notesByDay = useMemo(() => {
    const map = new Map<string, { id: string; title: string }>();
    for (const doc of bundle.docs) {
      const dayId = dayIdOf(doc);
      if (dayId) map.set(dayId, { id: doc.id, title: doc.title });
    }
    return map;
  }, [bundle]);

  const weeks = useMemo<WeekGroup[]>(() => {
    const progress = new Map(
      (bundle.weeks ?? []).flatMap((w) => w.days.map((d) => [d.id, d] as const)),
    );
    const map = new Map<string, WeekGroup>();
    for (const day of bundle.plan.days) {
      const key = `${day.phase}-${day.week}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          phase: day.phase,
          week: day.week,
          focus: day.focus,
          days: [],
          done: 0,
          total: 0,
        };
        map.set(key, group);
      }
      group.days.push(day);
      if (!group.focus && day.focus) group.focus = day.focus;
      const live = progress.get(day.id);
      if (live) {
        group.done += live.doneCount;
        group.total += live.taskCount;
      }
    }
    return [...map.values()].sort((a, b) => a.phase - b.phase || a.week - b.week);
  }, [bundle]);

  if (weeks.length === 0) {
    return <Placeholder title="No plan in this bundle" body="Publish again with the plan present." />;
  }

  return (
    <>
      <header className="px-5 pt-safe-plus-8">
        <p className="text-label text-faint tracking-[0.12em] uppercase">The path</p>
        <h1 className="text-ink mt-1.5 text-[34px] leading-[1.1] font-semibold tracking-[-0.02em]">
          {weeks.length} weeks
        </h1>
        {!bundle.weeks && (
          <p className="text-small text-muted mt-2">
            Published without progress — the desktop app wasn't running.
          </p>
        )}
      </header>

      <SectionLabel>Weeks</SectionLabel>
      <div className="flex flex-col gap-2.5 px-5">
        {weeks.map((group) => {
          const expanded = openWeek === group.key;
          const pct = group.total > 0 ? group.done / group.total : 0;
          return (
            <div key={group.key} className="hairline bg-surface-1 overflow-hidden rounded-[14px]">
              <button
                onClick={() => setOpenWeek(expanded ? null : group.key)}
                aria-expanded={expanded}
                className="tap-target flex w-full items-center gap-3 p-4 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-ink block text-[15px] font-semibold">
                    Week {group.week}
                    <span className="text-faint font-normal"> · phase {group.phase}</span>
                  </span>
                  {group.focus && (
                    <span className="text-small text-muted mt-0.5 line-clamp-1 block">
                      {group.focus}
                    </span>
                  )}
                </span>
                {group.total > 0 && (
                  <span className="text-small text-faint tabular shrink-0">
                    {group.done}/{group.total}
                  </span>
                )}
                <ChevronRight
                  size={17}
                  strokeWidth={1.8}
                  className={cn('text-faint shrink-0 transition-transform', expanded && 'rotate-90')}
                />
              </button>
              {group.total > 0 && (
                <span className="bg-surface-3 block h-[2px]">
                  <span className="aurora-bg block h-full" style={{ width: `${pct * 100}%` }} />
                </span>
              )}

              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                    transition={reduce ? { duration: dur.micro } : spring.smooth}
                    className="overflow-hidden"
                  >
                    <ul className="border-line border-t">
                      {group.days.map((day) => {
                        const tasks = tasksByDay.get(day.id) ?? [];
                        const note = notesByDay.get(day.id);
                        const dayOpen = openDay === day.id;
                        // The plan JSON often has no day title and falls back to
                        // "Phase 1 · Week 4 · Day 2"; the day note's own heading
                        // ("Week 4 - Day 2: Graph DFS") actually says something.
                        const label = /^Phase \d+ · Week \d+ · Day \d+$/.test(day.title)
                          ? (note?.title ?? day.title)
                          : day.title;
                        return (
                          <li key={day.id} className="border-line border-b last:border-b-0">
                            <button
                              onClick={() => setOpenDay(dayOpen ? null : day.id)}
                              aria-expanded={dayOpen}
                              className="tap-target flex w-full items-center gap-3 px-4 py-3 text-left"
                            >
                              <span className="text-small text-faint tabular w-10 shrink-0">
                                Day {day.day}
                              </span>
                              <span className="text-body text-ink line-clamp-1 min-w-0 flex-1">
                                {label}
                              </span>
                              <span className="text-small text-faint shrink-0">{tasks.length}</span>
                            </button>
                            {dayOpen && (
                              <div className="px-4 pb-3">
                                {note && (
                                  <button
                                    onClick={() => navigate({ view: 'doc', id: note.id })}
                                    className="hairline text-small text-ink bg-surface-2 tap-target mb-2 flex w-full items-center gap-2 rounded-[10px] px-3 py-2"
                                  >
                                    <FileText size={15} strokeWidth={1.7} className="text-iris" />
                                    Read the day's notes
                                  </button>
                                )}
                                <ul className="flex flex-col gap-1.5">
                                  {tasks.map((task) => (
                                    <li key={task.id}>
                                      {task.url ? (
                                        <a
                                          href={task.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-small text-body tap-target flex items-start gap-2 py-1"
                                        >
                                          <span className="bg-faint mt-[7px] size-1 shrink-0 rounded-full" />
                                          <span className="min-w-0 flex-1">
                                            {task.title}
                                            {task.difficulty && (
                                              <span
                                                className={cn(
                                                  'ml-1.5 text-[11px]',
                                                  DIFFICULTY_TONE[task.difficulty],
                                                )}
                                              >
                                                {task.difficulty}
                                              </span>
                                            )}
                                          </span>
                                          <ExternalLink
                                            size={13}
                                            strokeWidth={1.7}
                                            className="text-faint mt-1 shrink-0"
                                          />
                                        </a>
                                      ) : (
                                        <span className="text-small text-body flex items-start gap-2 py-1">
                                          <span className="bg-faint mt-[7px] size-1 shrink-0 rounded-full" />
                                          {task.title}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </>
  );
}
