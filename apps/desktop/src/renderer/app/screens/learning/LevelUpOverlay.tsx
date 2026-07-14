import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { spring, dur } from '../../../motion/springs';
import { Button } from '../../../ui';

/**
 * Level-up moment (plan §E juice). Rendered as a SIBLING of the screen's
 * animated container — an ancestor transform would turn position:fixed into
 * container-relative (KEY LESSON, PROGRESS 2026-07-12).
 */
export function LevelUpOverlay({ level, onDismiss }: { level: number | null; onDismiss: () => void }) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (level === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [level, onDismiss]);

  return (
    <AnimatePresence>
      {level !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.base }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={onDismiss}
        >
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.88, y: 12 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
            transition={reduce ? { duration: dur.micro } : spring.gentle}
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-xs flex-col items-center gap-4 rounded-[14px] bg-surface-1 hairline-strong p-8 text-center"
          >
            <div className="flex size-16 items-center justify-center rounded-full aurora-bg aurora-glow">
              <Sparkles size={28} strokeWidth={1.5} className="text-white" />
            </div>
            <div>
              <p className="text-[11px] tracking-[0.14em] text-faint uppercase">Level up</p>
              <p className="mt-1 font-mono text-[40px] leading-none font-semibold text-ink tabular">{level}</p>
            </div>
            <p className="text-small text-muted">Keep the streak alive — tomorrow counts too.</p>
            <Button variant="primary" onClick={onDismiss}>
              Continue
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
