import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ChevronDown,
  History,
  SquarePen,
  Trash2,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { spring, dur, riseIn, staggerChildren, reduced } from '../../../motion/springs';
import { cn } from '../../../lib/cn';
import { useChat } from '../../../lib/chatStore';
import type { ChatMessage } from '../../../lib/coreClient';
import { Button, Chip, Card } from '../../../ui';
import { AssistantMessage } from './AssistantMessage';
import { Composer, type ComposerHandle } from './Composer';
import { ModelBanner } from './ModelBanner';
import { PERSONAS, personaMeta } from './personas';

/* Suggested prompts (§4.2): tied to Abhay's profile — never a blank box. */
const SUGGESTED = [
  'Explain DynamoDB GSIs like a mentor',
  'Drill me on graph traversal — my weak spot',
  'Review my URL-shortener scaling approach',
  'How do DynamoDB Streams pair with Lambda?',
];

function PersonaPicker() {
  const { persona, setPersona, streamingMessageId } = useChat();
  const [open, setOpen] = useState(false);
  const meta = personaMeta(persona);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={streamingMessageId !== null}
        aria-label="Switch persona"
        className="flex items-center gap-1.5 rounded-full py-0.5 pr-1 hover:opacity-80 disabled:opacity-50"
      >
        <Chip tone={meta.tone}>{meta.label}</Chip>
        <ChevronDown size={14} strokeWidth={1.5} className="text-faint" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.ul
              initial={{ opacity: 0, y: 4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: dur.micro } }}
              transition={spring.smooth}
              className="glass overlay-shadow absolute top-9 left-0 z-40 w-72 rounded-[14px] bg-surface-1/90 p-1.5"
            >
              {PERSONAS.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setPersona(p.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-[10px] px-3 py-2 text-left hover:bg-surface-2',
                      p.id === persona && 'bg-surface-2',
                    )}
                  >
                    <span className="text-small font-medium text-ink">{p.label}</span>
                    <span className="text-[12px] text-muted">{p.tagline}</span>
                  </button>
                </li>
              ))}
            </motion.ul>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThreadsMenu() {
  const { threads, activeThreadId, selectThread, deleteThread } = useChat();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button size="sm" variant="ghost" icon={<History size={14} strokeWidth={1.5} />} onClick={() => setOpen((o) => !o)}>
        History
      </Button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: dur.micro } }}
              transition={spring.smooth}
              className="glass overlay-shadow absolute top-9 right-0 z-40 w-80 rounded-[14px] bg-surface-1/90 p-1.5"
            >
              {threads.length === 0 ? (
                <p className="px-3 py-4 text-center text-small text-faint">
                  No conversations yet — your first one starts below.
                </p>
              ) : (
                <ul className="max-h-72 overflow-y-auto">
                  {threads.map((t) => (
                    <li key={t.id} className="group flex items-center">
                      <button
                        onClick={() => {
                          void selectThread(t.id);
                          setOpen(false);
                        }}
                        className={cn(
                          'min-w-0 flex-1 rounded-[10px] px-3 py-2 text-left hover:bg-surface-2',
                          t.id === activeThreadId && 'bg-surface-2',
                        )}
                      >
                        <span className="block truncate text-small text-ink">{t.title || 'Untitled'}</span>
                        <span className="font-mono text-[11px] text-faint tabular">
                          {t.messageCount} messages
                        </span>
                      </button>
                      <button
                        aria-label={`Delete thread ${t.title}`}
                        onClick={() => void deleteThread(t.id)}
                        className="mr-1 rounded-[6px] p-1.5 text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-danger"
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusPill({ phase }: { phase: string }) {
  const label = phase === 'thinking' ? 'Thinking' : 'Drafting';
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={spring.snappy}
      className="flex items-center gap-2 self-start rounded-full bg-surface-2 hairline px-3 py-1"
    >
      <Sparkles size={12} strokeWidth={1.5} className="caret-pulse text-iris" />
      <span className="text-[12px] text-muted">
        {label}
        <span className="caret-pulse">…</span>
      </span>
    </motion.div>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      variants={reduced(reduce, staggerChildren)}
      initial="hidden"
      animate="visible"
      className="flex flex-1 flex-col items-center justify-center gap-6 px-6"
    >
      <motion.div variants={reduced(reduce, riseIn)} className="text-center">
        <h1 className="text-h1 text-ink">What are we working on, Abhay?</h1>
        <p className="mt-1 text-body text-muted">
          Hints come before answers here — that’s how you get to Staff.
        </p>
      </motion.div>
      <motion.div variants={reduced(reduce, riseIn)} className="flex max-w-lg flex-wrap justify-center gap-2">
        {SUGGESTED.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full bg-surface-1 hairline px-4 py-2 text-small text-body hover:bg-surface-2 hover:text-ink hover:border-line-strong"
          >
            {s}
          </button>
        ))}
      </motion.div>
    </motion.div>
  );
}

function MessageRow({
  message,
  streaming,
  onExplainLine,
}: {
  message: ChatMessage;
  streaming: boolean;
  onExplainLine: (line: string) => void;
}) {
  const reduce = useReducedMotion();
  if (message.role === 'user') {
    return (
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduce ? { duration: dur.micro } : spring.gentle}
        className="max-w-[85%] self-end rounded-[14px] rounded-br-[6px] bg-surface-2 hairline px-4 py-2.5 text-body text-ink select-text"
      >
        {message.segments[0]?.content}
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: dur.micro } : spring.gentle}
      className="w-full self-start"
    >
      <AssistantMessage message={message} streaming={streaming} onExplainLine={onExplainLine} />
    </motion.div>
  );
}

export function ChatScreen() {
  const {
    init,
    messages,
    activeThreadId,
    selectThread,
    send,
    stop,
    phase,
    streamingMessageId,
    generationError,
    modelStatus,
  } = useChat();
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => init(), [init]);

  // Follow the stream (§4.2) — pin to bottom while tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, phase]);

  const generating = streamingMessageId !== null;
  const modelUnavailable = modelStatus !== null && modelStatus.state !== 'ready';
  const explainLine = (line: string) =>
    composerRef.current?.setDraft(`Explain this line: \`${line.trim()}\``);

  return (
    <div className="mx-auto flex h-full max-w-[760px] flex-col px-6">
      <header className="flex h-14 shrink-0 items-center justify-between">
        <PersonaPicker />
        <div className="flex items-center gap-1">
          <ThreadsMenu />
          <Button
            size="sm"
            variant="ghost"
            icon={<SquarePen size={14} strokeWidth={1.5} />}
            onClick={() => void selectThread(null)}
          >
            New chat
          </Button>
        </div>
      </header>

      {modelUnavailable && (
        <div className="pb-3">
          <ModelBanner />
        </div>
      )}

      {messages.length === 0 && !activeThreadId ? (
        <EmptyState onPick={(prompt) => void send(prompt)} />
      ) : (
        <div ref={scrollRef} className="flex flex-1 flex-col gap-5 overflow-y-auto py-4">
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              streaming={m.id === streamingMessageId}
              onExplainLine={explainLine}
            />
          ))}
          <AnimatePresence>
            {generating && (phase === 'thinking' || phase === 'drafting') && (
              <StatusPill key="status" phase={phase} />
            )}
          </AnimatePresence>
          {generationError && (
            <Card padding="compact" className="flex items-center gap-3 self-start border-danger/20">
              <AlertCircle size={16} strokeWidth={1.5} className="shrink-0 text-danger" />
              <p className="text-small text-body">{generationError}</p>
            </Card>
          )}
        </div>
      )}

      <div className="shrink-0 pt-2 pb-5">
        <Composer
          ref={composerRef}
          disabled={modelUnavailable}
          generating={generating}
          onSend={(c) => void send(c)}
          onStop={() => void stop()}
        />
        <p className="mt-2 text-center text-[11px] text-faint">
          Running locally on {modelStatus?.model ?? 'llama3.1:8b'} — your data never leaves this Mac.
        </p>
      </div>
    </div>
  );
}
