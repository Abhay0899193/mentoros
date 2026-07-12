import { AnimatePresence, motion } from 'motion/react';
import { UploadCloud } from 'lucide-react';
import { dur } from '../../../motion/springs';

/** Full-screen drag affordance (§4.7) — shown while a file/folder hovers the screen. */
export function DropZone({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-canvas/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.base }}
        >
          <div className="glass aurora-glow mx-4 flex max-w-full flex-col items-center gap-3 rounded-[20px] border-2 border-dashed border-iris/40 px-8 py-10 text-center sm:px-16 sm:py-14">
            <UploadCloud size={32} strokeWidth={1.5} className="text-iris" />
            <p className="text-h2 text-ink">Drop to index</p>
            <p className="text-small text-muted">PDF, markdown, text, or a whole folder</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
