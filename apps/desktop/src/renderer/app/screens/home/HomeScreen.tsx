import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Flame, Check, ArrowRight, Moon, Download } from 'lucide-react';
import { riseIn, staggerChildren, reduced, spring, dur } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { useLearning } from '../../../lib/learningStore';
import { useMemories } from '../../../lib/memoryStore';
import { useShell } from '../../../lib/store';
import { Button, Card, Chip } from '../../../ui';
import { TYPE_COLOR, typeLabel } from '../memory/memoryMeta';
import type { MissionItem } from '../../../lib/coreClient';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Mission pill — fills with Aurora on completion (§4.1). */
function MissionPill({ item, onToggle }: { item: MissionItem; onToggle: (done: boolean) => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      layout
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={spring.snappy}
      onClick={() => onToggle(!item.done)}
      title={item.reason}
      className={cn(
        'group relative flex min-w-0 flex-1 flex-col gap-1 overflow-hidden rounded-[14px] p-4 text-left',
        item.done ? 'text-white' : 'bg-surface-1 hairline hover:bg-surface-2',
      )}
    >
      {item.done && (
        <motion.span
          layoutId={`fill-${item.id}`}
          initial={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
          transition={reduce ? { duration: dur.micro } : spring.smooth}
          className="aurora-bg absolute inset-0"
        />
      )}
      <span className="relative flex items-center gap-1.5">
        <span
          className={cn(
            'flex size-4 items-center justify-center rounded-full border',
            item.done ? 'border-white/60 bg-white/20' : 'border-line-strong',
          )}
        >
          {item.done && <Check size={10} strokeWidth={2.5} />}
        </span>
        <span className={cn('text-label font-medium tracking-[0.02em] uppercase', item.done ? 'text-white/80' : 'text-faint')}>
          {item.kind}
        </span>
      </span>
      <span className={cn('relative line-clamp-2 text-small leading-snug', item.done ? 'text-white' : 'text-ink')}>
        {item.label}
      </span>
      <span className={cn('relative truncate text-[11px]', item.done ? 'text-white/70' : 'text-faint')}>
        {item.reason}
      </span>
    </motion.button>
  );
}

function EveningCapture() {
  const save = useMemories((s) => s.save);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  if (saved) return null;
  return (
    <Card padding="compact" className="flex items-center gap-3">
      <Moon size={16} strokeWidth={1.5} className="shrink-0 text-muted" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            void save({ type: 'learning', body: text.trim(), source: 'home', tags: ['evening'] });
            setText('');
            setSaved(true);
          }
        }}
        placeholder="What did you learn today? One line — I’ll remember it."
        className="flex-1 bg-transparent text-small text-ink outline-none placeholder:text-faint"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!text.trim()}
        onClick={() => {
          void save({ type: 'learning', body: text.trim(), source: 'home', tags: ['evening'] });
          setText('');
          setSaved(true);
        }}
      >
        Save memory
      </Button>
    </Card>
  );
}

export function HomeScreen() {
  const { init, summary, mission, completeMissionItem } = useLearning();
  const memInit = useMemories((s) => s.init);
  const records = useMemories((s) => s.records);
  const profile = useMemories((s) => s.profile);
  const runImport = useMemories((s) => s.runImport);
  const importState = useMemories((s) => s.importState);
  const setActive = useShell((s) => s.setActive);
  const reduce = useReducedMotion();

  useEffect(() => {
    init();
    memInit();
  }, [init, memInit]);

  const name = profile?.identity?.name ?? 'Abhay';
  const isEvening = new Date().getHours() >= 18;
  const doneCount = mission?.items.filter((i) => i.done).length ?? 0;
  const focus = mission?.items.find((i) => !i.done)?.label;
  const recentMemories = useMemo(() => records.slice(0, 3), [records]);
  const planMissing = summary !== null && !summary.imported;

  return (
    <motion.div
      variants={reduced(reduce, staggerChildren)}
      initial="hidden"
      animate="visible"
      className="mx-auto flex max-w-4xl flex-col gap-8 px-10 py-14"
    >
      <motion.header variants={reduced(reduce, riseIn)} className="flex items-end justify-between">
        <div>
          <h1 className="text-display text-ink">
            {greeting()}, {name}.
          </h1>
          <p className="mt-1 text-body text-muted">
            {mission
              ? `${mission.items.length - doneCount} of ${mission.items.length} mission steps left${focus ? ` · focus: ${focus}` : ' · all clear'}`
              : 'Your mission for today is being prepared.'}
          </p>
        </div>
        {mission && (
          <div className="flex items-center gap-2 rounded-full bg-surface-1 hairline px-4 py-2" title={`Best streak: ${mission.streak.best}`}>
            <Flame
              size={18}
              strokeWidth={1.5}
              className={mission.streak.current > 0 ? 'text-warning' : 'text-faint'}
            />
            <span className="font-mono text-h3 text-ink tabular">{mission.streak.current}</span>
            <span className="text-small text-muted">day streak</span>
          </div>
        )}
      </motion.header>

      {planMissing && (
        <motion.div variants={reduced(reduce, riseIn)}>
          <Card padding="compact" className="flex items-center gap-3">
            <Download size={16} strokeWidth={1.5} className="shrink-0 text-muted" />
            <div className="flex-1">
              <p className="text-small font-medium text-ink">Bring in your 3-month challenge plan</p>
              <p className="text-[12px] text-muted">
                21 weeks · DSA + infra daily — MentorOS becomes the tracker your plan never had.
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              disabled={importState?.active}
              onClick={() => void runImport('3mc', '/Users/singha7/Documents/abhay/3-month-challenge')}
            >
              {importState?.active ? importState.step : 'Import plan'}
            </Button>
          </Card>
        </motion.div>
      )}

      <motion.section variants={reduced(reduce, riseIn)} className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-h2 text-ink">Today’s mission</h2>
          {mission && (
            <span className="font-mono text-small text-faint tabular">
              {doneCount} / {mission.items.length}
            </span>
          )}
        </div>
        {mission && mission.items.length > 0 ? (
          <div className="flex gap-3">
            {mission.items.map((item) => (
              <MissionPill
                key={item.id}
                item={item}
                onToggle={(done) => void completeMissionItem(item.id, done)}
              />
            ))}
          </div>
        ) : (
          <Card padding="feature" className="text-center">
            <p className="text-small text-muted">
              No mission yet — import your plan above and today’s right-sized set appears here.
            </p>
          </Card>
        )}
      </motion.section>

      {isEvening && (
        <motion.div variants={reduced(reduce, riseIn)}>
          <EveningCapture />
        </motion.div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <motion.div variants={reduced(reduce, riseIn)}>
          <Card interactive padding="compact" onClick={() => setActive('learning')} className="h-full">
            <div className="flex items-center justify-between">
              <h3 className="text-h3 text-ink">Continue where you left off</h3>
              <ArrowRight size={16} strokeWidth={1.5} className="text-faint" />
            </div>
            {summary?.imported ? (
              <>
                <p className="mt-1 text-small text-muted">
                  {summary.doneDays} of {summary.totalDays} days done · level {summary.level}
                </p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="aurora-bg h-full rounded-full"
                    style={{ width: `${summary.totalTasks ? Math.round((summary.doneTasks / summary.totalTasks) * 100) : 0}%` }}
                  />
                </div>
                <p className="mt-2 font-mono text-[11px] text-faint tabular">
                  {summary.doneTasks} / {summary.totalTasks} tasks · {summary.xp} XP
                </p>
              </>
            ) : (
              <p className="mt-1 text-small text-faint">The learning path unlocks after your plan is imported.</p>
            )}
          </Card>
        </motion.div>

        <motion.div variants={reduced(reduce, riseIn)}>
          <Card padding="compact" className="h-full">
            <h3 className="text-h3 text-ink">Recently learned</h3>
            {recentMemories.length === 0 ? (
              <p className="mt-1 text-small text-faint">New memories will appear here as you work.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {recentMemories.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: TYPE_COLOR[r.type] }} />
                    <span className="min-w-0 flex-1 truncate text-small text-body">{r.title}</span>
                    <Chip>{typeLabel(r.type)}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
