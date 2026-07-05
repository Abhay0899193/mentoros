import { cn } from '../../../lib/cn';
import type { HeatCell } from '../../../lib/coreClient';

/** count → Aurora intensity (§4.6): 0 = surface, 1/2/3+ = aurora at .35/.6/1 opacity. */
function intensityClass(count: number): string {
  if (count <= 0) return 'bg-surface-2';
  if (count === 1) return 'aurora-bg opacity-[.35]';
  if (count === 2) return 'aurora-bg opacity-[.6]';
  return 'aurora-bg';
}

/** 84-day calendar heat-strip — 12 columns × 7 rows of 8px squares, 3px gap. */
export function HeatStrip({ heat }: { heat: HeatCell[] }) {
  const cells: (HeatCell | null)[] =
    heat.length > 0 ? heat.slice(-84) : Array.from({ length: 84 }, () => null);

  return (
    <div className="grid grid-flow-col grid-rows-7 gap-[3px]" aria-label="84-day activity heatmap">
      {cells.map((cell, i) => (
        <div
          key={cell?.date ?? i}
          title={cell ? `${cell.date} · ${cell.count} ${cell.count === 1 ? 'task' : 'tasks'}` : 'No activity yet'}
          className={cn('size-2 rounded-[2px]', intensityClass(cell?.count ?? 0))}
        />
      ))}
    </div>
  );
}
