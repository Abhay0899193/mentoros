import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Target, TrendingDown, BookOpen } from 'lucide-react';
import { spring, dur } from '../../motion/springs';
import { useShell } from '../../lib/store';
import { recalledMemories, personas, type RecalledMemory } from '../../lib/seed';
import { Chip } from '../../ui';

const typeIcon: Record<RecalledMemory['type'], typeof Target> = {
  goal: Target,
  skill: TrendingDown,
  learning: BookOpen,
  identity: Target,
};

function MemoryRow({ mem }: { mem: RecalledMemory }) {
  const Icon = typeIcon[mem.type];
  return (
    <li className="rounded-[10px] p-2 hover:bg-surface-2">
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={1.5} className="shrink-0 text-muted" />
        <span className="truncate text-small font-medium text-ink">{mem.title}</span>
      </div>
      <p className="mt-0.5 pl-6 text-[12px] leading-relaxed text-muted">{mem.detail}</p>
      {/* Confidence bar — data viz, so accent is allowed here */}
      <div className="mt-1.5 ml-6 h-0.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-iris/60" style={{ width: `${mem.confidence * 100}%` }} />
      </div>
    </li>
  );
}

/** Right context panel (§4.0): what the mentor is using right now — a trust signal. */
export function ContextPanel() {
  const { contextPanelOpen } = useShell();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {contextPanelOpen && (
        <motion.aside
          aria-label="Mentor context"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 288, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={reduce ? { duration: dur.micro } : spring.smooth}
          className="shrink-0 overflow-hidden border-l border-line bg-surface-1"
        >
          <div className="flex h-full w-72 flex-col gap-5 overflow-y-auto p-4">
            <section>
              <h3 className="mb-2 text-label font-medium tracking-[0.02em] text-faint uppercase">
                Active persona
              </h3>
              <Chip>{personas[0]}</Chip>
            </section>

            <section>
              <h3 className="mb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">
                Memories in use
              </h3>
              <ul className="-mx-2 flex flex-col">
                {recalledMemories.map((m) => (
                  <MemoryRow key={m.id} mem={m} />
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-label font-medium tracking-[0.02em] text-faint uppercase">
                Sources cited
              </h3>
              <p className="text-small text-faint">
                None yet — sources appear here when the mentor grounds an answer on your documents.
              </p>
            </section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
