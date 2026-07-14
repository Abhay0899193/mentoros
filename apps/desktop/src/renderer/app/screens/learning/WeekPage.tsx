import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Check } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { useKb } from '../../../lib/kbStore';
import type { LearningWeek } from '../../../lib/coreClient';
import { useLearning } from '../../../lib/learningStore';
import { DayRow } from './DayRow';
import { weekProgress } from './WeekTile';

/**
 * Week drill-down page (plan §E): back link, outcome/focus line, guide-parts
 * row with read ticks (read state cross-referenced from the KB store — same
 * source of truth Knowledge uses), day rows with task rows v2.
 */
export function WeekPage({
  week,
  initialDayId,
  onBack,
  onOpenDoc,
}: {
  week: LearningWeek;
  /** Day to auto-expand on entry (the Continue card's target). */
  initialDayId?: string | null;
  onBack: () => void;
  onOpenDoc: (sourceId: string) => void;
}) {
  const dayTasks = useLearning((s) => s.dayTasks);
  const dayNotes = useLearning((s) => s.dayNotes);
  const loadDayTasks = useLearning((s) => s.loadDayTasks);
  const loadDayNotes = useLearning((s) => s.loadDayNotes);
  const completeTask = useLearning((s) => s.completeTask);
  const kbSources = useKb((s) => s.sources);
  const [expandedDay, setExpandedDay] = useState<string | null>(initialDayId ?? null);

  useEffect(() => {
    if (initialDayId) {
      setExpandedDay(initialDayId);
      if (!dayTasks[initialDayId]) void loadDayTasks(initialDayId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when the target changes
  }, [initialDayId]);

  const { done, total } = weekProgress(week);
  const readById = new Map(kbSources.map((s) => [s.id, s.readAt !== null]));

  function toggleDay(dayId: string) {
    const opening = expandedDay !== dayId;
    setExpandedDay(opening ? dayId : null);
    if (opening && !dayTasks[dayId]) void loadDayTasks(dayId);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="tap-target -ml-2 flex w-fit items-center gap-1.5 rounded-[8px] px-2 py-1 text-small text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          All weeks
        </button>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-h2 text-ink">Week {week.week}</h2>
          <span className="font-mono text-[12px] text-faint tabular">
            Phase {week.phase} · {done}/{total} tasks
          </span>
        </div>
        {week.focus && <p className="mt-1 max-w-xl text-small text-muted">After this week: {week.focus}</p>}
      </div>

      {week.docs && week.docs.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-[11px] tracking-[0.06em] text-faint uppercase">
            <BookOpen size={12} strokeWidth={1.5} />
            Guides & quick review
          </span>
          <div className="flex flex-wrap gap-1.5">
            {week.docs.map((doc) => {
              const read = readById.get(doc.sourceId) ?? false;
              return (
                <button
                  key={doc.sourceId}
                  type="button"
                  onClick={() => onOpenDoc(doc.sourceId)}
                  className={cn(
                    'tap-target flex items-center gap-1.5 rounded-full bg-surface-1 hairline px-3 py-1 text-[12px] transition-colors hover:bg-surface-2',
                    read ? 'text-muted' : 'font-medium text-ink',
                  )}
                >
                  {read ? (
                    <Check size={12} strokeWidth={2} className="text-[var(--iris)]" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-[var(--iris)]" aria-label="unread" />
                  )}
                  {doc.title}
                </button>
              );
            })}
          </div>
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
            onCompleteTask={(taskId, taskDone) => void completeTask(taskId, taskDone)}
            onLoadNotes={() => void loadDayNotes(day.id)}
          />
        ))}
      </div>
    </div>
  );
}
