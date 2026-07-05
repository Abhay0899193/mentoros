import { motion, useReducedMotion } from 'motion/react';
import { Sparkles, Library } from 'lucide-react';
import { riseIn, staggerChildren, reduced } from '../../../motion/springs';
import { useKb } from '../../../lib/kbStore';
import { Button, Card } from '../../../ui';
import { SourceCard } from './SourceCard';
import { SuggestionCard } from './SuggestionCard';

function SkeletonCard() {
  return (
    <Card padding="compact" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="size-9 shrink-0 animate-pulse rounded-[10px] bg-surface-2" />
        <div className="h-3 w-28 animate-pulse rounded-full bg-surface-2" />
      </div>
      <div className="h-2 w-full animate-pulse rounded-full bg-surface-2" />
      <div className="h-2 w-2/3 animate-pulse rounded-full bg-surface-2" />
    </Card>
  );
}

/** Library grid + suggestions row + empty state (§4.7). */
export function LibraryGrid() {
  const sources = useKb((s) => s.sources);
  // Select the raw array and filter after — an inline .filter() returns a new
  // reference every snapshot and sends useSyncExternalStore into a render loop.
  const suggestions = useKb((s) => s.suggestions).filter((sug) => !sug.ingested);
  const loading = useKb((s) => s.loading);
  const ingest = useKb((s) => s.ingest);
  const setAddOpen = useKb((s) => s.setAddOpen);
  const reduce = useReducedMotion();

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 pt-6 @xl:grid-cols-2 @4xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const empty = sources.length === 0;

  return (
    <div className="flex flex-col gap-6 pt-6 pb-4">
      {suggestions.length > 0 && (
        <motion.section
          variants={reduced(reduce, riseIn)}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-[8px] aurora-bg">
              <Sparkles size={14} strokeWidth={1.5} className="text-white" />
            </span>
            <h2 className="text-h3 text-ink">MentorOS found sources worth indexing</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.path}
                suggestion={s}
                onIndex={() => void ingest(s.path, { title: s.title, tags: s.tags })}
              />
            ))}
          </div>
        </motion.section>
      )}

      {empty ? (
        <motion.div variants={reduced(reduce, riseIn)} initial="hidden" animate="visible">
          <Card padding="feature" className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-[10px] bg-surface-2 hairline">
              <Library size={26} strokeWidth={1.5} className="text-muted" />
            </div>
            <div>
              <h2 className="text-h2 text-ink">Nothing indexed yet</h2>
              <p className="mx-auto mt-1 max-w-sm text-small text-muted">
                Drop a PDF, markdown note, or folder — I’ll index it and cite it in answers.
              </p>
            </div>
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              Add a source
            </Button>
          </Card>
        </motion.div>
      ) : (
        <motion.div
          variants={reduced(reduce, staggerChildren)}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3"
        >
          {sources.map((s) => (
            <motion.div key={s.id} variants={reduced(reduce, riseIn)}>
              <SourceCard source={s} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
