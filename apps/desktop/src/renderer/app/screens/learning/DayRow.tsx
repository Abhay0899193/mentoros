import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BookOpen, Check, ChevronRight } from 'lucide-react';
import { spring, dur } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { Chip } from '../../../ui';
import type { LearningDay, LearningTask } from '../../../lib/coreClient';
import { ReadingMarkdown } from '../knowledge/ReadingMarkdown';

/** Node state dot (§4.6): available=hairline circle · current=aurora pulse · done=aurora check. */
function StateDot({ state }: { state: LearningDay['state'] }) {
  const reduce = useReducedMotion();

  if (state === 'done') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full aurora-bg">
        <Check size={12} strokeWidth={2.5} className="text-white" />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <motion.span
          className="absolute inset-0 rounded-full aurora-bg"
          animate={reduce ? { opacity: 0.5 } : { opacity: [0.25, 0.55, 0.25], scale: [0.85, 1, 0.85] }}
          transition={reduce ? undefined : { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="relative size-2.5 rounded-full aurora-bg" />
      </span>
    );
  }
  return <span className="size-5 shrink-0 rounded-full hairline-strong" />;
}

function TaskRow({ task, onToggle }: { task: LearningTask; onToggle: (done: boolean) => void }) {
  const reduce = useReducedMotion();
  const difficultyTone =
    task.difficulty === 'Easy' ? 'success' : task.difficulty === 'Medium' ? 'warning' : 'danger';

  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(!task.done)}
        className="tap-target group flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-surface-2"
      >
        {/* particle burst: Phase 7 polish */}
        <motion.span
          whileTap={reduce ? undefined : { scale: 0.85 }}
          transition={spring.snappy}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border',
            task.done ? 'border-transparent aurora-bg' : 'border-line-strong',
          )}
        >
          {task.done && <Check size={10} strokeWidth={2.5} className="text-white" />}
        </motion.span>
        <span className={cn('min-w-0 flex-1 truncate text-small', task.done ? 'text-faint line-through' : 'text-ink')}>
          {task.title}
        </span>
        {task.difficulty && <Chip tone={difficultyTone}>{task.difficulty}</Chip>}
        <span className="shrink-0 text-[11px] tracking-[0.02em] text-faint uppercase">{task.kind}</span>
      </button>
    </li>
  );
}

export function DayRow({
  day,
  tasks,
  notes,
  expanded,
  onToggle,
  onCompleteTask,
  onLoadNotes,
}: {
  day: LearningDay;
  tasks?: LearningTask[];
  /** undefined = not fetched yet; null = day has no notes. */
  notes?: string | null;
  expanded: boolean;
  onToggle: () => void;
  onCompleteTask: (taskId: string, done: boolean) => void;
  onLoadNotes: () => void;
}) {
  const reduce = useReducedMotion();
  const [showNotes, setShowNotes] = useState(false);

  function toggleNotes() {
    const opening = !showNotes;
    setShowNotes(opening);
    if (opening && notes === undefined) onLoadNotes();
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'tap-target flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-surface-2',
          day.state === 'current' && 'bg-surface-1',
        )}
      >
        <StateDot state={day.state} />
        <span className="min-w-0 flex-1 truncate text-small text-ink">{day.title}</span>
        <span className="shrink-0 font-mono text-[11px] text-faint tabular">
          {day.doneCount}/{day.taskCount}
        </span>
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={spring.snappy}
          className="shrink-0 text-faint"
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="tasks"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: dur.micro } : spring.smooth}
            className="overflow-hidden pl-8"
          >
            {!tasks ? (
              <div className="flex flex-col gap-2 py-2">
                <div className="h-8 animate-pulse rounded-[8px] bg-surface-2" />
                <div className="h-8 animate-pulse rounded-[8px] bg-surface-2" />
              </div>
            ) : tasks.length === 0 ? (
              <p className="py-2 text-small text-faint">No tasks recorded for this day.</p>
            ) : (
              <ul className="flex flex-col gap-1 py-2">
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={(done) => onCompleteTask(task.id, done)} />
                ))}
              </ul>
            )}

            {day.hasNotes && (
              <div className="flex flex-col pb-2">
                <button
                  type="button"
                  onClick={toggleNotes}
                  className="tap-target flex w-fit items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-small text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <BookOpen size={13} strokeWidth={1.5} />
                  Study notes
                  <motion.span animate={{ rotate: showNotes ? 90 : 0 }} transition={spring.snappy}>
                    <ChevronRight size={12} strokeWidth={1.5} />
                  </motion.span>
                </button>
                {showNotes &&
                  (notes === undefined ? (
                    <div className="mx-2 my-2 h-24 animate-pulse rounded-[8px] bg-surface-2" />
                  ) : (
                    <div className="mx-2 my-1 min-w-0 rounded-[10px] bg-surface-1 p-4">
                      <ReadingMarkdown text={notes ?? ''} />
                    </div>
                  ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
