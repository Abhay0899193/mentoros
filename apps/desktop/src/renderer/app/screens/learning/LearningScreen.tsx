import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BookOpen, GraduationCap } from 'lucide-react';
import { riseIn, staggerChildren, reduced } from '../../../motion/springs';
import { useLearning } from '../../../lib/learningStore';
import { useKb } from '../../../lib/kbStore';
import { useShell } from '../../../lib/store';
import { Button, Card, Chip } from '../../../ui';
import type { LearningWeek } from '../../../lib/coreClient';
import { HeatStrip } from './HeatStrip';
import { ReviewQueue } from './ReviewQueue';
import { DayRow } from './DayRow';

/** Duolingo-style day-by-day path over the imported plan (plan.md §4.6). */
export function LearningScreen() {
  const init = useLearning((s) => s.init);
  const loadWeeks = useLearning((s) => s.loadWeeks);
  const loadDayTasks = useLearning((s) => s.loadDayTasks);
  const loadDayNotes = useLearning((s) => s.loadDayNotes);
  const completeTask = useLearning((s) => s.completeTask);
  const summary = useLearning((s) => s.summary);
  const weeks = useLearning((s) => s.weeks);
  const reviews = useLearning((s) => s.reviews);
  const heat = useLearning((s) => s.heat);
  const dayTasks = useLearning((s) => s.dayTasks);
  const dayNotes = useLearning((s) => s.dayNotes);
  const setActive = useShell((s) => s.setActive);
  const reduce = useReducedMotion();
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const openReading = useKb((s) => s.openReading);

  function openQuickReview(sourceId: string) {
    openReading(sourceId);
    setActive('knowledge');
  }

  useEffect(() => {
    init();
    void loadWeeks();
  }, [init, loadWeeks]);

  const phases = useMemo(() => {
    const map = new Map<number, LearningWeek[]>();
    for (const w of weeks) {
      if (!map.has(w.phase)) map.set(w.phase, []);
      map.get(w.phase)!.push(w);
    }
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [weeks]);

  const imported = summary?.imported ?? false;

  function toggleDay(dayId: string) {
    const opening = expandedDay !== dayId;
    setExpandedDay(opening ? dayId : null);
    if (opening && !dayTasks[dayId]) void loadDayTasks(dayId);
  }

  return (
    <motion.div
      variants={reduced(reduce, staggerChildren)}
      initial="hidden"
      animate="visible"
      className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 md:px-10 md:py-14"
    >
      <motion.header
        variants={reduced(reduce, riseIn)}
        className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6"
      >
        <h1 className="text-h1 text-ink">Learning path</h1>
        <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-2">
          <span className="shrink-0 font-mono text-small text-muted tabular">
            Level {summary?.level ?? 1} · {(summary?.xp ?? 0).toLocaleString()} XP
          </span>
          <HeatStrip heat={heat} />
        </div>
      </motion.header>

      {!imported ? (
        <motion.div variants={reduced(reduce, riseIn)}>
          <Card padding="feature" className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-[10px] aurora-bg aurora-glow">
              <GraduationCap size={26} strokeWidth={1.5} className="text-white" />
            </div>
            <div>
              <h2 className="text-h2 text-ink">Your learning path isn’t imported yet</h2>
              <p className="mx-auto mt-1 max-w-sm text-small text-muted">
                Bring in your 3-month challenge plan from Home — 21 weeks of DSA and infra, tracked
                day by day.
              </p>
            </div>
            <Button variant="primary" onClick={() => setActive('home')}>
              Import your plan from Home
            </Button>
          </Card>
        </motion.div>
      ) : (
        <>
          {reviews.length > 0 && (
            <motion.div variants={reduced(reduce, riseIn)}>
              <ReviewQueue reviews={reviews} />
            </motion.div>
          )}

          <motion.div variants={reduced(reduce, riseIn)} className="flex flex-col gap-8">
            {phases.length === 0 ? (
              <Card padding="feature" className="text-center">
                <p className="text-small text-muted">
                  Your day-by-day path is being generated — check back in a moment.
                </p>
              </Card>
            ) : (
              phases.map(([phase, phaseWeeks]) => (
                <section key={phase} className="flex flex-col gap-4">
                  <h2 className="text-h2 text-ink">Phase {phase}</h2>
                  {phaseWeeks.map((week) => (
                    <div key={`${week.phase}-${week.week}`} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <Chip className="w-fit shrink-0">Week {week.week}</Chip>
                        {week.focus && (
                          <span className="min-w-0 flex-1 truncate text-small text-muted">{week.focus}</span>
                        )}
                      </div>
                      {week.docs && week.docs.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pb-1">
                          <span className="flex items-center gap-1 text-[12px] text-faint">
                            <BookOpen size={12} strokeWidth={1.5} />
                            Quick review
                          </span>
                          {week.docs.map((doc) => (
                            <button
                              key={doc.sourceId}
                              type="button"
                              onClick={() => openQuickReview(doc.sourceId)}
                              className="tap-target rounded-full bg-surface-1 hairline px-2.5 py-0.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                            >
                              {doc.title}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5">
                        {week.days.map((day) => (
                          <DayRow
                            key={day.id}
                            day={day}
                            tasks={dayTasks[day.id]}
                            notes={dayNotes[day.id]}
                            expanded={expandedDay === day.id}
                            onToggle={() => toggleDay(day.id)}
                            onCompleteTask={(taskId, done) => void completeTask(taskId, done)}
                            onLoadNotes={() => void loadDayNotes(day.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ))
            )}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
