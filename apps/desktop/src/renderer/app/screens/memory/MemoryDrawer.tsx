import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X, Trash2 } from 'lucide-react';
import { spring, dur } from '../../../motion/springs';
import { useMemories } from '../../../lib/memoryStore';
import type { MemoryType } from '../../../lib/coreClient';
import { Button, Chip } from '../../../ui';
import { TYPE_COLOR, TYPE_ORDER, typeLabel } from './memoryMeta';

/** Memory card (§4.4): title, body, type, confidence, source, history — editable. */
export function MemoryDrawer() {
  const { records, selectedId, select, update, remove } = useMemories();
  const reduce = useReducedMotion();
  const record = records.find((r) => r.id === selectedId) ?? null;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<MemoryType>('learning');
  const dirty = record !== null && (title !== record.title || body !== record.body || type !== record.type);

  useEffect(() => {
    if (record) {
      setTitle(record.title);
      setBody(record.body);
      setType(record.type);
    }
  }, [record?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {record && (
        <motion.aside
          key={record.id}
          initial={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: 40, opacity: 0, transition: { duration: dur.micro } }}
          transition={reduce ? { duration: dur.micro } : spring.smooth}
          className="absolute top-0 right-0 bottom-0 z-20 flex w-full flex-col border-l border-line bg-surface-1 overlay-shadow md:w-96"
        >
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[record.type] }} />
              <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
                {typeLabel(record.type)} memory
              </span>
            </span>
            <button aria-label="Close" onClick={() => select(null)} className="tap-target rounded-[6px] p-1 text-faint hover:bg-surface-2 hover:text-body">
              <X size={16} strokeWidth={1.5} />
            </button>
          </header>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <label className="flex flex-col gap-1">
              <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 rounded-[10px] bg-surface-2 hairline px-3 text-small text-ink outline-none focus:border-line-strong"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">What the mentor knows</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="resize-none rounded-[10px] bg-surface-2 hairline p-3 text-small leading-relaxed text-ink outline-none focus:border-line-strong select-text"
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">Type</span>
              <div className="flex flex-wrap gap-1.5">
                {TYPE_ORDER.map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={
                      t === type
                        ? 'tap-target rounded-full bg-surface-3 hairline-strong px-2.5 py-0.5 text-[12px] text-ink'
                        : 'tap-target rounded-full bg-surface-2 hairline px-2.5 py-0.5 text-[12px] text-muted hover:text-body'
                    }
                  >
                    {typeLabel(t)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">Confidence</span>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-iris/70" style={{ width: `${record.confidence * 100}%` }} />
              </div>
              <p className="mt-1 font-mono text-[11px] text-faint tabular">
                {Math.round(record.confidence * 100)}% · source: {record.source} · updated{' '}
                {new Date(record.updatedAt).toLocaleDateString()}
              </p>
            </div>

            {record.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {record.tags.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>
            )}

            {record.history.length > 0 && (
              <div>
                <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
                  How this memory evolved
                </span>
                <ul className="mt-1.5 flex flex-col gap-2 border-l-2 border-line pl-3">
                  {record.history
                    .slice()
                    .reverse()
                    .map((h, i) => (
                      <li key={i}>
                        <p className="text-[12px] leading-relaxed text-muted select-text">{h.body}</p>
                        <p className="font-mono text-[10px] text-faint tabular">
                          {new Date(h.at).toLocaleDateString()}
                        </p>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between border-t border-line p-3">
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={14} strokeWidth={1.5} />}
              onClick={() => void remove(record.id)}
            >
              Forget
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!dirty}
              onClick={() => void update(record.id, { title, body, type })}
            >
              Save changes
            </Button>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
