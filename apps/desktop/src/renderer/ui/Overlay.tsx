import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { spring, dur } from '../motion/springs';
import { cn } from '../lib/cn';
import { useIsMobile } from '../lib/useBreakpoint';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Glass panel width on a wide screen; palette uses 640. Ignored on a phone. */
  width?: number;
  /** Vertical placement — 'top' floats at 18vh (palette), 'center' for dialogs. */
  align?: 'top' | 'center';
  className?: string;
}

/**
 * Glass overlay (§3.3): the only surfaces allowed blur + drop shadow.
 *
 * On a phone it stops being a floating panel and becomes a sheet that rises
 * from the bottom edge and owns the screen. A 520–640px dialog cannot float on
 * a 390px viewport, and every wizard/dialog in the app is built on this — so
 * the sheet behaviour is defined once, here, rather than 15 times downstream.
 * Content scrolls inside the sheet; the sheet itself never exceeds the visible
 * viewport (dvh, so the Safari URL bar can't hide the primary action).
 */
export function Overlay({ open, onClose, children, width = 640, align = 'top', className }: OverlayProps) {
  const reduce = useReducedMotion();
  const isMobile = useIsMobile();

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
            'fixed inset-0 z-50 flex bg-black/40',
            isMobile
              ? 'items-end justify-center'
              : cn('justify-center', align === 'top' ? 'items-start pt-[18vh]' : 'items-center'),
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
            className={cn(
              'glass overlay-shadow flex flex-col bg-surface-1/80',
              isMobile
                ? 'pb-safe max-h-[92dvh] w-full overflow-y-auto rounded-t-[20px]'
                : 'max-h-[85dvh] overflow-y-auto rounded-[14px]',
              className,
            )}
            style={isMobile ? undefined : { width, maxWidth: 'calc(100vw - 48px)' }}
            initial={
              reduce ? { opacity: 0 } : isMobile ? { y: '100%' } : { opacity: 0, y: 10, scale: 0.98 }
            }
            animate={reduce ? { opacity: 1 } : isMobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={
              reduce ? { opacity: 0 } : isMobile ? { y: '100%' } : { opacity: 0, y: 6, scale: 0.98 }
            }
            transition={reduce ? { duration: dur.micro } : spring.smooth}
          >
            {isMobile && (
              /* Grab handle: tells the user this is a sheet, and where its top edge is */
              <div className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-line-strong" />
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
