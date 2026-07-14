import { cn } from '../../../lib/cn';

/**
 * Weekly XP column chart (plan §E Stats tab; dataviz method).
 * Single series → no legend, the card title names it; one hue = the iris
 * data accent from the theme (adapts to dark/light/accent automatically);
 * thin bars with 4px rounded data-ends anchored to the baseline, 2px gaps;
 * per-bar hover tooltip; direct label ONLY on the current week.
 */
export function WeeklyXpChart({ weeklyXp }: { weeklyXp: number[] }) {
  const max = Math.max(...weeklyXp, 1);
  const empty = weeklyXp.every((v) => v === 0);
  const n = weeklyXp.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-label={`XP per week, last ${n} weeks`}>
        {weeklyXp.map((xp, i) => {
          const current = i === n - 1;
          const h = xp > 0 ? Math.max((xp / max) * 100, 4) : 0;
          return (
            <div
              key={i}
              className="group relative flex h-full flex-1 flex-col items-center justify-end"
              title={`${current ? 'This week' : `${n - 1 - i} week${n - 1 - i === 1 ? '' : 's'} ago`} · ${xp.toLocaleString()} XP`}
            >
              {current && xp > 0 && (
                <span className="mb-1 font-mono text-[11px] text-ink tabular">{xp.toLocaleString()}</span>
              )}
              <div
                style={{ height: `${h}%` }}
                className={cn(
                  'w-full max-w-7 rounded-t-[4px] transition-opacity',
                  xp > 0 ? 'bg-[var(--iris)]' : 'h-[2px] bg-surface-2',
                  xp > 0 && !current && 'opacity-70 group-hover:opacity-100',
                )}
              />
            </div>
          );
        })}
      </div>
      <div className="h-px w-full bg-line" />
      <div className="flex justify-between text-[11px] text-faint">
        <span>{n - 1}w ago</span>
        <span>{empty ? 'No XP yet — complete a task to start the chart' : 'this week'}</span>
      </div>
    </div>
  );
}
