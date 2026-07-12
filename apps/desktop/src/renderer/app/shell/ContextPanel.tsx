import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { spring, dur } from '../../motion/springs';
import { useShell } from '../../lib/store';
import { useIsCompact } from '../../lib/useBreakpoint';
import { useChat } from '../../lib/chatStore';
import { useMemories } from '../../lib/memoryStore';
import { useKb } from '../../lib/kbStore';
import { Chip } from '../../ui';
import type { MessageCitation } from '../../lib/coreClient';
import { TYPE_COLOR, TYPE_ICON, typeLabel } from '../screens/memory/memoryMeta';
import { resolvePersonaMeta } from '../screens/chat/personas';
import { usePersonas } from '../../lib/personaStore';

const NO_CITATIONS: MessageCitation[] = [];

/** Citations of the newest grounded assistant message in the open thread. */
function selectLiveCitations(s: { messages: { role: string; citations?: MessageCitation[] }[] }) {
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i];
    if (m.role === 'assistant' && m.citations && m.citations.length > 0) return m.citations;
  }
  return NO_CITATIONS;
}

/**
 * Right context panel (§4.0/§4.2): what the mentor is using RIGHT NOW —
 * recalled memories from the live `chat.context` event. A trust signal,
 * not decoration.
 */
export function ContextPanel() {
  const { contextPanelOpen, setContextPanelOpen, setActive } = useShell();
  const persona = useChat((s) => s.persona);
  const liveCitations = useChat(selectLiveCitations);
  const liveContext = useMemories((s) => s.liveContext);
  const select = useMemories((s) => s.select);
  const reduce = useReducedMotion();
  const personas = usePersonas((s) => s.personas);
  const meta = resolvePersonaMeta(persona, personas);
  const isCompact = useIsCompact();

  // Selecting a memory/source navigates away — on a phone the drawer is
  // covering that destination, so it has to get out of the way.
  const navigate = (go: () => void) => {
    go();
    if (isCompact) setContextPanelOpen(false);
  };

  const body = (
    <>
      <section>
        <h3 className="mb-2 text-label font-medium tracking-[0.02em] text-faint uppercase">
          Active persona
        </h3>
        <Chip tone={meta.tone}>{meta.label}</Chip>
      </section>
      <ContextSections
        liveContext={liveContext}
        liveCitations={liveCitations}
        reduce={!!reduce}
        onMemory={(id) => navigate(() => { setActive('memory'); select(id); })}
        onSource={(sourceId) => navigate(() => { useKb.getState().openReading(sourceId); setActive('knowledge'); })}
      />
    </>
  );

  // Under lg there is no room for a third column: the panel slides over the
  // canvas as a drawer instead of squeezing it.
  if (isCompact) {
    return (
      <AnimatePresence>
        {contextPanelOpen && (
          <motion.div
            className="fixed inset-0 z-40 flex justify-end bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur.micro }}
            onMouseDown={(e) => e.target === e.currentTarget && setContextPanelOpen(false)}
          >
            <motion.aside
              aria-label="Mentor context"
              role="dialog"
              aria-modal="true"
              initial={reduce ? { opacity: 0 } : { x: '100%' }}
              animate={reduce ? { opacity: 1 } : { x: 0 }}
              exit={reduce ? { opacity: 0 } : { x: '100%' }}
              transition={reduce ? { duration: dur.micro } : spring.smooth}
              className="pt-safe pb-safe pr-safe flex h-full w-[min(20rem,85vw)] flex-col border-l border-line bg-surface-1"
            >
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-h3 text-ink">Context</h2>
                <button
                  onClick={() => setContextPanelOpen(false)}
                  aria-label="Close context panel"
                  className="tap-target flex items-center justify-center rounded-[8px] p-1.5 text-faint hover:bg-surface-2 hover:text-body"
                >
                  <X size={18} strokeWidth={1.5} />
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">{body}</div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

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
          <div className="flex h-full w-72 flex-col gap-5 overflow-y-auto p-4">{body}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** The two live lists, shared by the column and the drawer. */
function ContextSections({
  liveContext,
  liveCitations,
  reduce,
  onMemory,
  onSource,
}: {
  liveContext: { id: string; type: keyof typeof TYPE_ICON; title: string; score: number }[];
  liveCitations: MessageCitation[];
  reduce: boolean;
  onMemory: (id: string) => void;
  onSource: (sourceId: string) => void;
}) {
  return (
    <>
            <section>
              <h3 className="mb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">
                Memories in use
              </h3>
              {liveContext.length === 0 ? (
                <p className="text-small text-faint">
                  Nothing recalled yet — when you ask something, the memories the mentor draws on
                  appear here.
                </p>
              ) : (
                <ul className="-mx-2 flex flex-col">
                  <AnimatePresence initial={false}>
                    {liveContext.map((m) => {
                      const Icon = TYPE_ICON[m.type];
                      return (
                        <motion.li
                          key={m.id}
                          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={reduce ? { duration: dur.micro } : spring.gentle}
                        >
                          <button
                            onClick={() => onMemory(m.id)}
                            className="w-full rounded-[10px] p-2 text-left hover:bg-surface-2"
                          >
                            <span className="flex items-center gap-2">
                              <Icon
                                size={14}
                                strokeWidth={1.5}
                                className="shrink-0"
                                style={{ color: TYPE_COLOR[m.type] }}
                              />
                              <span className="truncate text-small font-medium text-ink">{m.title}</span>
                            </span>
                            <span className="mt-0.5 block pl-6 text-[11px] text-faint">
                              {typeLabel(m.type)} · relevance{' '}
                              <span className="font-mono tabular">{Math.round(m.score * 100)}%</span>
                            </span>
                            <span className="mt-1.5 ml-6 block h-0.5 overflow-hidden rounded-full bg-surface-3">
                              <span
                                className="block h-full rounded-full bg-iris/60"
                                style={{ width: `${m.score * 100}%` }}
                              />
                            </span>
                          </button>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">
                Sources cited
              </h3>
              {liveCitations.length === 0 ? (
                <p className="text-small text-faint">
                  None yet — sources appear here when the mentor grounds an answer on your
                  documents.
                </p>
              ) : (
                <ul className="-mx-2 flex flex-col">
                  <AnimatePresence initial={false}>
                    {liveCitations.map((c) => (
                      <motion.li
                        key={`${c.chunkId}-${c.n}`}
                        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={reduce ? { duration: dur.micro } : spring.gentle}
                      >
                        <button
                          onClick={() => onSource(c.sourceId)}
                          className="w-full rounded-[10px] p-2 text-left hover:bg-surface-2"
                        >
                          <span className="flex items-center gap-2">
                            <span className="flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-surface-3 px-1 font-mono text-[10px] leading-none text-muted">
                              {c.n}
                            </span>
                            <span className="truncate text-small font-medium text-ink">
                              {c.title}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block pl-6 text-[11px] leading-snug text-faint">
                            {c.snippet}
                          </span>
                          <span className="mt-1.5 ml-6 block h-0.5 overflow-hidden rounded-full bg-surface-3">
                            <span
                              className="block h-full rounded-full bg-iris/60"
                              style={{ width: `${Math.round(c.score * 100)}%` }}
                            />
                          </span>
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </section>
    </>
  );
}
