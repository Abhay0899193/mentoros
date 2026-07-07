import { motion, useReducedMotion } from 'motion/react';
import { Lightbulb, Route, Eye, BookMarked } from 'lucide-react';
import { spring, dur } from '../../../motion/springs';
import type { ChatMessage, Segment } from '../../../lib/coreClient';
import { useChat } from '../../../lib/chatStore';
import { useShell } from '../../../lib/store';
import { useKb } from '../../../lib/kbStore';
import { usePersonas } from '../../../lib/personaStore';
import { Button, Chip } from '../../../ui';
import { RichText } from './RichText';
import { resolvePersonaMeta } from './personas';

const LADDER: { segment: Segment; level: number; revealLabel: string; icon: typeof Lightbulb }[] = [
  { segment: 'hint1', level: 1, revealLabel: 'Hint 1', icon: Lightbulb },
  { segment: 'hint2', level: 2, revealLabel: 'Hint 2', icon: Lightbulb },
  { segment: 'approach', level: 3, revealLabel: 'Show approach', icon: Route },
  { segment: 'solution', level: 4, revealLabel: 'Reveal solution', icon: Eye },
];

const rungTitle: Record<string, string> = {
  hint1: 'Hint 1',
  hint2: 'Hint 2',
  approach: 'Approach',
  solution: 'Solution',
};

export interface AssistantMessageProps {
  message: ChatMessage;
  streaming: boolean;
  onExplainLine: (line: string) => void;
}

/** Teaching layout (§4.2): hints reveal progressively; solution only on demand. */
export function AssistantMessage({ message, streaming, onExplainLine }: AssistantMessageProps) {
  const reduce = useReducedMotion();
  const revealedLevel = useChat((s) => s.revealed[message.id] ?? 1);
  const reveal = useChat((s) => s.reveal);
  const setActive = useShell((s) => s.setActive);
  const personas = usePersonas((s) => s.personas);
  const persona = resolvePersonaMeta(message.persona ?? 'staff-engineer', personas);

  const citations = message.citations ?? [];
  const citedNs = citations.length > 0 ? new Set(citations.map((c) => c.n)) : undefined;

  const bySegment = new Map(message.segments.map((b) => [b.segment, b.content]));
  const prose = bySegment.get('prose');
  const present = LADDER.filter((r) => (bySegment.get(r.segment) ?? '').trim() !== '');
  const lastSegment = message.segments[message.segments.length - 1]?.segment;
  const nextRung = present.find((r) => r.level > revealedLevel);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">Mentor</span>
        <Chip tone={persona.tone} className="max-w-[220px]">
          <span className="truncate">{persona.label}</span>
        </Chip>
      </div>

      {prose !== undefined && (
        <RichText
          text={prose}
          streaming={streaming}
          showCaret={streaming && lastSegment === 'prose'}
          onExplainLine={onExplainLine}
          citedNs={citedNs}
        />
      )}

      {present
        .filter((r) => r.level <= revealedLevel)
        .map((r) => (
          <motion.div
            key={r.segment}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={reduce ? { duration: dur.micro } : spring.gentle}
            className="rounded-[10px] border-l-2 border-l-line-strong bg-surface-1 py-2 pr-3 pl-4"
          >
            <p className="mb-1 text-label font-medium tracking-[0.02em] text-faint uppercase">
              {rungTitle[r.segment]}
            </p>
            <RichText
              text={bySegment.get(r.segment) ?? ''}
              streaming={streaming}
              showCaret={streaming && lastSegment === r.segment}
              onExplainLine={onExplainLine}
              citedNs={citedNs}
            />
          </motion.div>
        ))}

      {citations.length > 0 && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={reduce ? { duration: dur.micro } : spring.gentle}
          className="mt-1 flex flex-wrap items-center gap-1.5"
          aria-label="Sources cited"
        >
          <BookMarked size={13} strokeWidth={1.5} className="text-faint" aria-hidden />
          {citations.map((c) => (
            <button
              key={c.n}
              type="button"
              title={c.snippet}
              onClick={() => {
                useKb.getState().openReading(c.sourceId);
                setActive('knowledge');
              }}
              className="flex max-w-56 items-center gap-1.5 rounded-full border border-line bg-surface-1 py-0.5 pr-2.5 pl-1 text-left hover:border-line-strong hover:bg-surface-2"
            >
              <span className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-surface-3 px-1 font-mono text-[10px] leading-none text-muted">
                {c.n}
              </span>
              <span className="truncate text-[12px] text-body">{c.title}</span>
            </button>
          ))}
        </motion.div>
      )}

      {nextRung && (
        <div className="mt-1 flex items-center gap-2">
          <Button
            size="sm"
            variant={nextRung.segment === 'solution' ? 'primary' : 'secondary'}
            icon={<nextRung.icon size={14} strokeWidth={1.5} />}
            onClick={() => reveal(message.id, nextRung.level)}
          >
            {nextRung.revealLabel}
          </Button>
          {nextRung.segment !== 'solution' && (
            <span className="text-[12px] text-faint">Try it yourself first — that’s the point.</span>
          )}
        </div>
      )}
    </div>
  );
}
