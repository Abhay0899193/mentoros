import { motion, useReducedMotion } from 'motion/react';
import { Download } from 'lucide-react';
import { riseIn, staggerChildren, reduced } from '../../../motion/springs';
import { useMemories } from '../../../lib/memoryStore';
import type { MemoryRecord } from '../../../lib/coreClient';
import { Card, Chip, Button } from '../../../ui';
import { TYPE_COLOR, typeLabel } from './memoryMeta';

const IMPORT_DEFAULTS = {
  'interview-prep': '/Users/singha7/Documents/abhay/interview-prep',
  '3mc': '/Users/singha7/Documents/abhay/3-month-challenge',
} as const;

function RecordRow({ record, onOpen }: { record: MemoryRecord; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(record.id)}
      className="group flex w-full items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-surface-2"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[record.type] }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small text-ink">{record.title}</span>
        <span className="block truncate text-[12px] text-muted">{record.body}</span>
      </span>
      <span className="mt-1 shrink-0 font-mono text-[11px] text-faint tabular">
        {Math.round(record.confidence * 100)}%
      </span>
    </button>
  );
}

/** Structured "who you are" (§4.4) — derived views over memory records. */
export function ProfileView() {
  const { profile, records, select, importState, runImport, query } = useMemories();
  const reduce = useReducedMotion();
  const empty = !profile || (records.length === 0 && !importState?.active);
  const q = query.trim().toLowerCase();
  const visibleRecords =
    q === ''
      ? records
      : records.filter(
          (r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q) || r.type.includes(q),
        );

  return (
    <motion.div
      variants={reduced(reduce, staggerChildren)}
      initial="hidden"
      animate="visible"
      className="mx-auto flex max-w-3xl flex-col gap-4 pb-10"
    >
      {/* Import card — the bridge to Abhay's real data */}
      <motion.div variants={reduced(reduce, riseIn)}>
        <Card padding="compact" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-h3 text-ink">Import your real data</h3>
              <p className="text-small text-muted">
                Re-running is safe — repeated facts merge into the same memory instead of duplicating.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                icon={<Download size={14} strokeWidth={1.5} />}
                disabled={importState?.active}
                onClick={() => void runImport('interview-prep', IMPORT_DEFAULTS['interview-prep'])}
              >
                interview-prep
              </Button>
            </div>
          </div>
          {importState && (
            <div className="flex items-center gap-3 border-t border-line pt-2">
              <span className="text-small text-muted">{importState.step}</span>
              <span className="ml-auto font-mono text-[11px] text-faint tabular">
                {importState.created} new · {importState.merged} merged
              </span>
              {importState.error && <span className="text-small text-danger">{importState.error}</span>}
            </div>
          )}
        </Card>
      </motion.div>

      {empty ? (
        <motion.div variants={reduced(reduce, riseIn)} className="py-16 text-center">
          <p className="text-h2 text-ink">The mentor doesn’t know you yet</p>
          <p className="mx-auto mt-1 max-w-md text-small text-muted">
            Say “my goal is…” or “I’m weak at…” in Chat or Voice, or import above — every fact
            becomes one evolving memory, not a chat log.
          </p>
        </motion.div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <motion.div variants={reduced(reduce, riseIn)}>
              <Card padding="compact" className="h-full">
                <h3 className="mb-2 text-label font-medium tracking-[0.02em] text-faint uppercase">Goals</h3>
                {profile!.goals.length === 0 ? (
                  <p className="text-small text-faint">None yet — tell the mentor where you’re headed.</p>
                ) : (
                  profile!.goals.slice(0, 4).map((r) => <RecordRow key={r.id} record={r} onOpen={select} />)
                )}
              </Card>
            </motion.div>

            <motion.div variants={reduced(reduce, riseIn)}>
              <Card padding="compact" className="h-full">
                <h3 className="mb-2 text-label font-medium tracking-[0.02em] text-faint uppercase">
                  Recurring mistakes
                </h3>
                {profile!.mistakes.length === 0 ? (
                  <p className="text-small text-faint">Nothing recorded — interviews will fill this in.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {profile!.mistakes.slice(0, 5).map((m) => (
                      <li key={m.recordId}>
                        <button
                          onClick={() => select(m.recordId)}
                          className="flex w-full items-baseline gap-2 rounded-[8px] px-2 py-1 text-left hover:bg-surface-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-small text-ink">{m.title}</span>
                          <span className="shrink-0 font-mono text-mono text-danger tabular">×{m.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </motion.div>

            <motion.div variants={reduced(reduce, riseIn)}>
              <Card padding="compact" className="h-full">
                <h3 className="mb-2 text-label font-medium tracking-[0.02em] text-faint uppercase">Strengths</h3>
                {profile!.strengths.length === 0 ? (
                  <p className="text-small text-faint">None tagged yet.</p>
                ) : (
                  profile!.strengths.slice(0, 4).map((r) => <RecordRow key={r.id} record={r} onOpen={select} />)
                )}
              </Card>
            </motion.div>

            <motion.div variants={reduced(reduce, riseIn)}>
              <Card padding="compact" className="h-full">
                <h3 className="mb-2 text-label font-medium tracking-[0.02em] text-faint uppercase">Weaknesses</h3>
                {profile!.weaknesses.length === 0 ? (
                  <p className="text-small text-faint">None tagged yet.</p>
                ) : (
                  profile!.weaknesses.slice(0, 4).map((r) => <RecordRow key={r.id} record={r} onOpen={select} />)
                )}
              </Card>
            </motion.div>
          </div>

          <motion.div variants={reduced(reduce, riseIn)}>
            <Card padding="compact">
              <h3 className="mb-2 text-label font-medium tracking-[0.02em] text-faint uppercase">
                All memories
              </h3>
              <div className="flex flex-wrap gap-2 pb-2">
                {Object.entries(profile!.counts).map(([t, n]) => (
                  <Chip key={t}>
                    <span className="mr-1 size-1.5 rounded-full" style={{ background: TYPE_COLOR[t as keyof typeof TYPE_COLOR] }} />
                    {typeLabel(t as never)} · {n}
                  </Chip>
                ))}
              </div>
              <div className="flex max-h-96 flex-col overflow-y-auto">
                {visibleRecords.length === 0 ? (
                  <p className="px-2 py-4 text-small text-faint">No memories match “{query}”.</p>
                ) : (
                  visibleRecords.map((r) => <RecordRow key={r.id} record={r} onOpen={select} />)
                )}
              </div>
            </Card>
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
