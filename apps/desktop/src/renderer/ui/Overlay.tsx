import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { spring, dur } from '../motion/springs';
import { cn } from '../lib/cn';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Glass panel width; palette uses 640. */
  width?: number;
  /** Vertical placement — 'top' floats at 20vh (palette), 'center' for dialogs. */
  align?: 'top' | 'center';
  className?: string;
}

/** Glass overlay (§3.3): the only surfaces allowed blur + drop shadow. */
export function Overlay({ open, onClose, children, width = 640, align = 'top', className }: OverlayProps) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={cn(
            'fixed inset-0 z-50 flex justify-center bg-black/40',
            align === 'top' ? 'items-start pt-[18vh]' : 'items-center',
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.micro }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn('glass overlay-shadow rounded-[14px] bg-surface-1/80', className)}
            style={{ width, maxWidth: 'calc(100vw - 48px)' }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={reduce ? { duration: dur.micro } : spring.smooth}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
