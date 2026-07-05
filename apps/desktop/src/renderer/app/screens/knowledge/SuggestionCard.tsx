import { useKb } from '../../../lib/kbStore';
import type { KbSuggestedSource } from '../../../lib/coreClient';
import { Button, Card, Chip } from '../../../ui';
import { KindGlyph } from './KindGlyph';

/** Proactive index offer (§4.7) — teaching transparency via `reason`. */
export function SuggestionCard({
  suggestion,
  onIndex,
}: {
  suggestion: KbSuggestedSource;
  onIndex: () => void;
}) {
  const ingesting = useKb((s) => {
    const p = s.ingests[suggestion.path];
    return p ? !p.done : false;
  });

  return (
    <Card padding="compact" className="flex items-start gap-3">
      <KindGlyph kind={suggestion.kind} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-h3 text-ink">{suggestion.title}</h3>
        <p className="mt-0.5 text-small text-muted">{suggestion.reason}</p>
        {suggestion.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestion.tags.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        )}
      </div>
      <Button size="sm" variant="primary" loading={ingesting} loadingLabel="Indexing…" onClick={onIndex}>
        Index
      </Button>
    </Card>
  );
}
