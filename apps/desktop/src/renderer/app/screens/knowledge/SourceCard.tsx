import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { spring, dur } from '../../../motion/springs';
import { useKb } from '../../../lib/kbStore';
import type { KbSource } from '../../../lib/coreClient';
import { Card, Chip } from '../../../ui';
import { KindGlyph } from './KindGlyph';
import { KIND_LABEL } from './kbMeta';

/** One indexed source (§4.7): glyph, tags, chunk/file counts, delete-with-confirm. */
export function SourceCard({ source }: { source: KbSource }) {
  const openReading = useKb((s) => s.openReading);
  const remove = useKb((s) => s.remove);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
    setConfirming(false);
  }

  return (
    <Card
      interactive
      padding="compact"
      className="group relative flex cursor-pointer flex-col gap-3"
      onClick={() => openReading(source.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <KindGlyph kind={source.kind} />
          <div className="min-w-0">
            <h3 className="truncate text-h3 text-ink">{source.title}</h3>
            <span className="text-[12px] text-faint">{KIND_LABEL[source.kind]}</span>
          </div>
        </div>

        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            aria-label={`Actions for ${source.title}`}
            onClick={() => setMenuOpen((o) => !o)}
            className="tap-target rounded-[6px] p-1 text-faint opacity-0 coarse:opacity-100 group-hover:opacity-100 hover:bg-surface-3 hover:text-body focus-visible:opacity-100"
          >
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={closeMenu} />
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: dur.micro } }}
                  transition={spring.smooth}
                  className="glass overlay-shadow absolute top-7 right-0 z-40 w-60 max-w-[calc(100vw-2rem)] rounded-[14px] bg-surface-1/90 p-1.5"
                >
                  {!confirming ? (
                    <button
                      onClick={() => setConfirming(true)}
                      className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-small text-danger hover:bg-danger/10"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                      Remove from knowledge base
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2 px-3 py-2">
                      <p className="text-small text-ink">Delete “{source.title}” and its chunks?</p>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={closeMenu}
                          className="tap-target rounded-[8px] px-2.5 py-1 text-small text-muted hover:bg-surface-2 hover:text-body"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            closeMenu();
                            void remove(source.id);
                          }}
                          className="tap-target rounded-[8px] bg-danger/10 px-2.5 py-1 text-small text-danger hover:bg-danger/15"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {source.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {source.tags.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
      )}

      <p className="mt-auto font-mono text-[11px] text-faint tabular">
        {source.chunkCount.toLocaleString()} chunks · {source.fileCount}{' '}
        {source.fileCount === 1 ? 'file' : 'files'} · indexed {new Date(source.indexedAt).toLocaleDateString()}
      </p>
    </Card>
  );
}
