import { create } from 'zustand';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { spring, dur } from '../motion/springs';
import { cn } from '../lib/cn';

type Tone = 'success' | 'warning' | 'danger' | 'info';

export interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
  /** Errors must offer a next action (§0.2.5). */
  action?: { label: string; onClick: () => void };
}

interface ToastStore {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = (t: Omit<ToastItem, 'id'>) => useToasts.getState().push(t);

const icons: Record<Tone, typeof Info> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

/* Tone color appears only on the status icon — the toast chrome stays neutral. */
const iconTones: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

/** Mount once in the app root. Glass, bottom-right, springs in from below. */
export function Toaster() {
  const { toasts, dismiss } = useToasts();
  const reduce = useReducedMotion();

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-90 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: dur.micro } }}
              transition={reduce ? { duration: dur.micro } : spring.smooth}
              className="glass overlay-shadow pointer-events-auto flex items-start gap-3 rounded-[14px] bg-surface-1/80 p-4"
            >
              <Icon size={20} strokeWidth={1.5} className={cn('mt-px shrink-0', iconTones[t.tone])} />
              <div className="min-w-0 flex-1">
                <p className="text-small font-medium text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 text-small text-muted">{t.description}</p>}
                {t.action && (
                  <button
                    onClick={t.action.onClick}
                    className="mt-2 text-small font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded-[6px] p-0.5 text-faint hover:text-body"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
