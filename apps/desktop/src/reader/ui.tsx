/**
 * Reader UI atoms. Small on purpose — the Reader is four screens, so shared
 * pieces earn their place by being used on at least two of them.
 */
import { motion, useReducedMotion } from 'motion/react';
import { BookOpen, CalendarDays, Check, Zap } from 'lucide-react';
import { cn } from '../renderer/lib/cn';
import { spring } from '../renderer/motion/springs';
import { docKind, partOf, weekOf, type ReaderDoc } from './bundle';

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-label text-faint px-5 pt-6 pb-2 tracking-[0.08em] uppercase">{children}</h2>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'hairline text-small shrink-0 rounded-full px-3.5 py-1.5 whitespace-nowrap transition-colors',
        'tap-target flex items-center',
        active ? 'border-iris/40 bg-iris/12 text-ink' : 'text-muted bg-surface-1',
      )}
    >
      {children}
    </button>
  );
}

const KIND_ICON = {
  guide: BookOpen,
  sheet: Zap,
  day: CalendarDays,
} as const;

/** The one card the whole app is built from: a doc you can tap to read. */
export function DocCard({
  doc,
  onOpen,
  progress,
  snippet,
  index = 0,
}: {
  doc: ReaderDoc;
  onOpen: () => void;
  /** 0–1 reading position, when there is one. */
  progress?: number;
  /** Search context line. */
  snippet?: string | null;
  index?: number;
}) {
  const reduce = useReducedMotion();
  const kind = docKind(doc);
  const Icon = KIND_ICON[kind];
  const week = weekOf(doc);
  const part = partOf(doc);
  const read = doc.readAt !== null;

  return (
    <motion.button
      onClick={onOpen}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0.12 } : { ...spring.gentle, delay: Math.min(index, 8) * 0.02 }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      className={cn(
        'hairline bg-surface-1 relative block w-full overflow-hidden rounded-[14px] p-4 text-left',
        'active:bg-surface-2 transition-colors',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px]',
            read ? 'bg-surface-2 text-faint' : 'bg-iris/12 text-iris',
          )}
        >
          <Icon size={17} strokeWidth={1.6} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-ink line-clamp-2 block text-[15px] leading-snug font-semibold">
            {doc.title}
          </span>
          <span className="text-small text-faint mt-1 flex items-center gap-1.5">
            {week !== null && <span>Week {week}</span>}
            {week !== null && part !== null && <span aria-hidden>·</span>}
            {part !== null && <span>Part {part}</span>}
            {(week !== null || part !== null) && <span aria-hidden>·</span>}
            <span>{doc.minutes} min</span>
            {read && (
              <>
                <span aria-hidden>·</span>
                <Check size={13} strokeWidth={2} className="text-success" />
              </>
            )}
          </span>
          {snippet && <span className="text-small text-muted mt-2 line-clamp-2 block">{snippet}</span>}
        </span>
      </div>
      {progress !== undefined && progress > 0.02 && progress < 0.98 && (
        <span className="bg-surface-3 absolute inset-x-0 bottom-0 h-[2px]">
          <span
            className="aurora-bg block h-full"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      )}
    </motion.button>
  );
}

/** Full-bleed empty/loading state — centred, quiet, never a spinner-only. */
export function Placeholder({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-8 text-center">
      <p className="text-ink text-[17px] font-semibold">{title}</p>
      {body && <p className="text-small text-muted mt-2 max-w-xs">{body}</p>}
    </div>
  );
}
