import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { GraduationCap } from 'lucide-react';
import { riseIn, staggerChildren, reduced, spring, dur } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { useLearning, weekKey } from '../../../lib/learningStore';
import { useKb } from '../../../lib/kbStore';
import { useShell } from '../../../lib/store';
import { Button, Card } from '../../../ui';
import type { LearningWeek } from '../../../lib/coreClient';
import { LevelRing } from './LevelRing';
import { LevelUpOverlay } from './LevelUpOverlay';
import { ContinueCard } from './ContinueCard';
import { WeekTile } from './WeekTile';
import { WeekPage } from './WeekPage';
import { StatsTab } from './StatsTab';

const TABS = [
  { id: 'path', label: 'Path' },
  { id: 'stats', label: 'Stats' },
] as const;

/**
 * Learning path v2 (plan §E): game-forward drill-down. Overview = phase
 * sections of week tiles (never task rows); week page = the drill-down;
 * Stats tab = heatmap, XP chart, quests, badges, reviews.
 */
export function LearningScreen() {
  const init = useLearning((s) => s.init);
  const loadWeeks = useLearning((s) => s.loadWeeks);
  const loadDayTasks = useLearning((s) => s.loadDayTasks);
  const summary = useLearning((s) => s.summary);
  const weeks = useLearning((s) => s.weeks);
  const reviews = useLearning((s) => s.reviews);
  const heat = useLearning((s) => s.heat);
  const dayTasks = useLearning((s) => s.dayTasks);
  const tab = useLearning((s) => s.tab);
  const setTab = useLearning((s) => s.setTab);
  const openWeekKey = useLearning((s) => s.openWeekKey);
  const openWeek = useLearning((s) => s.openWeek);
  const levelUpTo = useLearning((s) => s.levelUpTo);
  const clearLevelUp = useLearning((s) => s.clearLevelUp);
  const setActive = useShell((s) => s.setActive);
  const kbInit = useKb((s) => s.init);
  const openReading = useKb((s) => s.openReading);
  const reduce = useReducedMotion();

  // KB store feeds the guide read-ticks on week pages.
  useEffect(() => {
    init();
    kbInit();
    void loadWeeks();
  }, [init, kbInit, loadWeeks]);

  const phases = useMemo(() => {
    const map = new Map<number, LearningWeek[]>();
    for (const w of weeks) {
      if (!map.has(w.phase)) map.set(w.phase, []);
      map.get(w.phase)!.push(w);
    }
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [weeks]);

  const currentDayId = summary?.currentDayId ?? null;
  const currentWeek = useMemo(
    () => (currentDayId ? weeks.find((w) => w.days.some((d) => d.id === currentDayId)) : undefined),
    [weeks, currentDayId],
  );
  const currentDay = currentWeek?.days.find((d) => d.id === currentDayId);

  // The Continue hero needs the current day's tasks before any drill-down.
  useEffect(() => {
    if (currentDayId && !dayTasks[currentDayId]) void loadDayTasks(currentDayId);
  }, [currentDayId, dayTasks, loadDayTasks]);

  const openedWeek = useMemo(
    () => (openWeekKey ? weeks.find((w) => weekKey(w) === openWeekKey) : undefined),
    [weeks, openWeekKey],
  );

  const imported = summary?.imported ?? false;

  function openDoc(sourceId: string) {
    openReading(sourceId);
    setActive('knowledge');
  }

  return (
    <>
      <motion.div
        variants={reduced(reduce, staggerChildren)}
        initial="hidden"
        animate="visible"
        className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 md:px-10 md:py-14"
      >
        <motion.header variants={reduced(reduce, riseIn)} className="flex flex-col gap-4">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-h1 text-ink">Learning path</h1>
            {imported && summary && <LevelRing summary={summary} />}
          </div>
          {imported && (
            <div className="flex w-fit items-center gap-1 rounded-full bg-surface-1 hairline p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'tap-target relative rounded-full px-4 py-1 text-small transition-colors',
                    tab === t.id ? 'text-ink' : 'text-muted hover:text-ink',
                  )}
                >
                  {tab === t.id && (
                    <motion.span
                      layoutId="learning-tab"
                      transition={reduce ? { duration: 0 } : spring.smooth}
                      className="absolute inset-0 rounded-full bg-surface-3 hairline"
                    />
                  )}
                  <span className="relative">{t.label}</span>
                </button>
              ))}
            </div>
          )}
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
        ) : tab === 'stats' && summary ? (
          <StatsTab summary={summary} heat={heat} reviews={reviews} />
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {openedWeek ? (
              <motion.div
                key={openWeekKey}
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
                transition={reduce ? { duration: dur.micro } : spring.smooth}
              >
                <WeekPage
                  week={openedWeek}
                  initialDayId={currentWeek === openedWeek ? currentDayId : null}
                  onBack={() => openWeek(null)}
                  onOpenDoc={openDoc}
                />
              </motion.div>
            ) : (
              <motion.div
                key="overview"
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
                transition={reduce ? { duration: dur.micro } : spring.smooth}
                className="flex flex-col gap-6"
              >
                {currentWeek && currentDay && (
                  <ContinueCard
                    week={currentWeek}
                    day={currentDay}
                    tasks={dayTasks[currentDay.id]}
                    onContinue={() => openWeek(weekKey(currentWeek))}
                  />
                )}

                {phases.length === 0 ? (
                  <Card padding="feature" className="text-center">
                    <p className="text-small text-muted">
                      Your day-by-day path is being generated — check back in a moment.
                    </p>
                  </Card>
                ) : (
                  phases.map(([phase, phaseWeeks]) => (
                    <section key={phase} className="flex flex-col gap-3">
                      <h2 className="text-[11px] tracking-[0.14em] text-faint uppercase">Phase {phase}</h2>
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                        {phaseWeeks.map((week) => (
                          <WeekTile
                            key={weekKey(week)}
                            week={week}
                            current={currentWeek === week}
                            onOpen={() => openWeek(weekKey(week))}
                          />
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>

      {/* Sibling of the animated container — fixed positioning stays viewport-relative. */}
      <LevelUpOverlay level={levelUpTo} onDismiss={clearLevelUp} />
    </>
  );
}
