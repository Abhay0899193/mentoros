import { motion, useReducedMotion } from 'motion/react';
import { Check, Play } from 'lucide-react';
import { spring } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import type { LearningWeek } from '../../../lib/coreClient';

const SIZE = 34;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function weekProgress(week: LearningWeek): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const d of week.days) {
    done += d.doneCount;
    total += d.taskCount;
  }
  return { done, total };
}

/**
 * One week on the Path overview grid (plan §E): progress ring, focus line,
 * ▶ marker on the current week. Aurora treatment ONLY on the current/done
 * ring — chrome stays monochrome (§3.0.2).
 */
export function WeekTile({ week, current, onOpen }: { week: LearningWeek; current: boolean; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const { done, total } = weekProgress(week);
  const frac = total > 0 ? done / total : 0;
  const complete = total > 0 && done >= total;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={spring.snappy}
      className={cn(
        'tap-target group flex flex-col gap-2.5 rounded-[12px] bg-surface-1 p-4 text-left transition-colors hover:bg-surface-2',
        current ? 'hairline-strong aurora-glow' : 'hairline',
      )}
      aria-label={`Open week ${week.week}${week.focus ? ` — ${week.focus}` : ''}`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} className="-rotate-90">
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-[var(--surface-2)]"
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - frac)}
              className="stroke-[var(--iris)]"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center">
            {complete ? (
              <Check size={13} strokeWidth={2.5} className="text-[var(--iris)]" />
            ) : current ? (
              <Play size={11} strokeWidth={2} className="fill-[var(--iris)] text-[var(--iris)]" />
            ) : null}
          </span>
        </div>
        <span className="font-mono text-[11px] text-faint tabular">
          {done}/{total}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-small font-medium text-ink">Week {week.week}</p>
        <p className="mt-0.5 line-clamp-2 min-h-[2lh] text-[12px] leading-snug text-muted">
          {week.focus ?? '—'}
        </p>
      </div>
    </motion.button>
  );
}
