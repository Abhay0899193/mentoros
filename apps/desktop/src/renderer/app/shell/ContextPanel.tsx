import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { spring, dur } from '../../motion/springs';
import { useShell } from '../../lib/store';
import { useChat } from '../../lib/chatStore';
import { useMemories } from '../../lib/memoryStore';
import { Chip } from '../../ui';
import type { MessageCitation } from '../../lib/coreClient';
import { TYPE_COLOR, TYPE_ICON, typeLabel } from '../screens/memory/memoryMeta';
import { personaMeta } from '../screens/chat/personas';

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
  const { contextPanelOpen, setActive } = useShell();
  const persona = useChat((s) => s.persona);
  const liveCitations = useChat(selectLiveCitations);
  const liveContext = useMemories((s) => s.liveContext);
  const select = useMemories((s) => s.select);
  const reduce = useReducedMotion();
  const meta = personaMeta(persona);

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
              <Chip tone={meta.tone}>{meta.label}</Chip>
            </section>

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
                            onClick={() => {
                              setActive('memory');
                              select(m.id);
                            }}
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
                          onClick={() => setActive('knowledge')}
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
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
