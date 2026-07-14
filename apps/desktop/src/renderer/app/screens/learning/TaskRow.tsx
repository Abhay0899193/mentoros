import { motion, useReducedMotion } from 'motion/react';
import {
  BookOpen,
  Check,
  Code2,
  ExternalLink,
  GraduationCap,
  PlayCircle,
  RotateCcw,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { spring } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { Chip } from '../../../ui';
import type { LearningTask, TaskKind } from '../../../lib/coreClient';

const kindIcons: Record<TaskKind, LucideIcon> = {
  leetcode: Code2,
  video: PlayCircle,
  article: BookOpen,
  docs: BookOpen,
  book: BookOpen,
  'hands-on': Wrench,
  course: GraduationCap,
  review: RotateCcw,
  other: BookOpen,
};

/**
 * Task row v2 (plan §E): kind icon · title · difficulty chip · +XP badge ·
 * open-externally action · done toggle. Row click toggles done (unchanged
 * from v1); the ↗ opens the task's URL (LeetCode/video/article) without
 * toggling. In-app Solve lands with Phase F practice mode.
 */
export function TaskRow({ task, onToggle }: { task: LearningTask; onToggle: (done: boolean) => void }) {
  const reduce = useReducedMotion();
  const Icon = kindIcons[task.kind] ?? BookOpen;
  const difficultyTone =
    task.difficulty === 'Easy' ? 'success' : task.difficulty === 'Medium' ? 'warning' : 'danger';

  return (
    <li>
      <div
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 transition-colors hover:bg-surface-2',
          task.done && 'opacity-80',
        )}
      >
        <button
          type="button"
          onClick={() => onToggle(!task.done)}
          aria-label={task.done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
          className="tap-hit relative flex shrink-0 items-center justify-center"
        >
          <motion.span
            whileTap={reduce ? undefined : { scale: 0.85 }}
            transition={spring.snappy}
            className={cn(
              'flex size-[18px] items-center justify-center rounded-full border',
              task.done ? 'border-transparent aurora-bg' : 'border-line-strong group-hover:border-line-strong',
            )}
          >
            {task.done && <Check size={11} strokeWidth={2.5} className="text-white" />}
          </motion.span>
        </button>

        <Icon size={14} strokeWidth={1.5} className="shrink-0 text-faint" />

        <button
          type="button"
          onClick={() => onToggle(!task.done)}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-small',
            task.done ? 'text-faint line-through' : 'text-ink',
          )}
        >
          {task.title}
        </button>

        {task.difficulty && <Chip tone={difficultyTone}>{task.difficulty}</Chip>}

        <span
          className={cn(
            'shrink-0 font-mono text-[12px] tabular',
            task.done ? 'text-faint' : 'text-[var(--iris)]',
          )}
        >
          +{task.xpWorth}
        </span>

        {task.url && (
          <a
            href={task.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open "${task.title}" externally`}
            title={task.kind === 'leetcode' ? 'Open on LeetCode' : 'Open link'}
            className="tap-hit relative shrink-0 rounded-[6px] p-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 coarse:opacity-100 hover:text-ink focus-visible:opacity-100"
          >
            <ExternalLink size={13} strokeWidth={1.5} />
          </a>
        )}
      </div>
    </li>
  );
}
