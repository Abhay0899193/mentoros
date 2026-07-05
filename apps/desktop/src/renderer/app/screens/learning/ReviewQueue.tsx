import { Card, Chip } from '../../../ui';
import type { ReviewItem } from '../../../lib/coreClient';

/** Spaced-repetition due list (§4.6). Only rendered when items are due. */
export function ReviewQueue({ reviews }: { reviews: ReviewItem[] }) {
  return (
    <Card padding="compact" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-h2 text-ink">Review queue</h2>
        <Chip tone="warning">{reviews.length} due</Chip>
      </div>
      <ul className="flex flex-col gap-0.5">
        {reviews.map((r) => (
          <li key={r.memoryId} className="flex items-center gap-3 rounded-[8px] px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-small text-ink">{r.title}</span>
            <span className="shrink-0 text-[12px] text-muted">grade {r.lastGrade ?? '—'}/5</span>
            <span className="shrink-0 font-mono text-[11px] text-faint tabular">
              {new Date(r.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
