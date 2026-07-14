import { ArrowRight } from 'lucide-react';
import { Button, Card, Chip } from '../../../ui';
import type { LearningDay, LearningTask, LearningWeek } from '../../../lib/coreClient';

/**
 * Path-tab hero (plan §E): "W1 · D3 — Sliding Window · Next: LC 3 · +150 XP".
 * The action drills into the week page with the day expanded.
 */
export function ContinueCard({
  week,
  day,
  tasks,
  onContinue,
}: {
  week: LearningWeek;
  day: LearningDay;
  /** The current day's tasks; undefined while loading. */
  tasks?: LearningTask[];
  onContinue: () => void;
}) {
  const next = tasks?.find((t) => !t.done);

  return (
    <Card padding="feature" className="relative overflow-hidden">
      {/* aurora wash — data/state color, kept behind the content */}
      <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full aurora-bg opacity-[.14] blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-[0.08em] text-faint uppercase tabular">
            Phase {week.phase} · Week {week.week} · Day {day.day}
          </p>
          <h2 className="mt-1 truncate text-h2 text-ink">{day.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {next ? (
              <>
                <span className="text-small text-muted">Next:</span>
                <span className="min-w-0 truncate text-small text-ink">{next.title}</span>
                {next.difficulty && (
                  <Chip
                    tone={
                      next.difficulty === 'Easy' ? 'success' : next.difficulty === 'Medium' ? 'warning' : 'danger'
                    }
                  >
                    {next.difficulty}
                  </Chip>
                )}
                <span className="shrink-0 font-mono text-[12px] text-[var(--iris)] tabular">
                  +{next.xpWorth} XP
                </span>
              </>
            ) : (
              <span className="text-small text-muted">
                {tasks ? `All ${day.taskCount} tasks done — pick the next day` : `${day.doneCount}/${day.taskCount} tasks done`}
              </span>
            )}
          </div>
        </div>
        <Button variant="primary" onClick={onContinue} className="shrink-0" icon={<ArrowRight size={14} strokeWidth={2} />}>
          Continue
        </Button>
      </div>
    </Card>
  );
}
