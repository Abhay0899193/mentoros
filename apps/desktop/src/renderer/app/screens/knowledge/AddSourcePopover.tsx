import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { spring, dur } from '../../../motion/springs';
import { useKb } from '../../../lib/kbStore';
import { Button } from '../../../ui';

const PLACEHOLDER_PATH = '/Users/singha7/Documents/abhay/3-month-challenge/plan.md';

/** Non-drag ingest fallback (§4.7) — a small popover with a path text input. */
export function AddSourcePopover() {
  const open = useKb((s) => s.addOpen);
  const setOpen = useKb((s) => s.setAddOpen);
  const ingest = useKb((s) => s.ingest);

  const [path, setPath] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (!open) {
      setPath('');
      setTitle('');
      setTags('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  function submit() {
    const trimmed = path.trim();
    if (!trimmed) return;
    void ingest(trimmed, {
      title: title.trim() || undefined,
      tags: tags.trim()
        ? tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    });
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <motion.div
            role="dialog"
            aria-label="Add a source"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: dur.micro } }}
            transition={spring.smooth}
            className="glass overlay-shadow absolute top-full right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-[14px] bg-surface-1/90 p-4"
          >
            <h3 className="text-h3 text-ink">Add a source</h3>
            <p className="mt-0.5 text-small text-muted">
              Point at a file or folder — PDF, markdown, or plain text.
            </p>
            <div className="mt-3 flex flex-col gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">Path</span>
                <input
                  autoFocus
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder={PLACEHOLDER_PATH}
                  className="h-9 rounded-[10px] bg-surface-2 hairline px-3 font-mono text-[12px] text-ink outline-none focus:[box-shadow:var(--focus)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
                  Title <span className="normal-case text-faint">(optional)</span>
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="3-Month Challenge plan"
                  className="h-9 rounded-[10px] bg-surface-2 hairline px-3 text-small text-ink outline-none focus:[box-shadow:var(--focus)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
                  Tags <span className="normal-case text-faint">(comma-separated, optional)</span>
                </span>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="interview-prep, dsa"
                  className="h-9 rounded-[10px] bg-surface-2 hairline px-3 text-small text-ink outline-none focus:[box-shadow:var(--focus)]"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={path.trim() === ''} onClick={submit}>
                Index
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
