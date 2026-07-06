import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUp, AlertCircle } from "lucide-react";
import { spring, dur } from "../../../motion/springs";
import { cn } from "../../../lib/cn";
import { useInterview } from "../../../lib/interviewStore";
import { useChat } from "../../../lib/chatStore";
import type { InterviewPhase, InterviewTurn } from "../../../lib/coreClient";
import { Chip } from "../../../ui";
import { FallbackOrb } from "../../../orb/FallbackOrb";
import type { OrbState } from "../../../orb/orbState";
import { ModelBanner } from "../chat/ModelBanner";

const PHASE_LABEL: Record<InterviewPhase, string> = {
  framing: "Framing",
  coding: "Coding",
  interrogation: "Interrogation",
  scorecard: "Scorecard",
  abandoned: "Abandoned",
};

function TurnBubble({
  turn,
  streaming,
}: {
  turn: InterviewTurn;
  streaming: boolean;
}) {
  const reduce = useReducedMotion();

  if (turn.kind === "phase") {
    return (
      <p className="my-1 text-center text-[11px] tracking-[0.02em] text-faint uppercase">
        {turn.content}
      </p>
    );
  }

  if (turn.role === "candidate") {
    return (
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduce ? { duration: dur.micro } : spring.gentle}
        className="max-w-[85%] self-end rounded-[12px] rounded-br-[4px] bg-surface-2 px-3 py-2 text-small text-muted select-text"
      >
        {turn.content}
      </motion.div>
    );
  }

  if (turn.kind === "hint") {
    return (
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduce ? { duration: dur.micro } : spring.gentle}
        className="max-w-[92%] self-start rounded-[12px] border border-iris/20 bg-iris/5 px-3 py-2"
      >
        <Chip tone="iris" className="mb-1">
          Hint {turn.hintLevel ?? 1}/3
        </Chip>
        <p className="text-small text-ink select-text">
          {turn.content ||
            (streaming && <span className="caret-pulse">…</span>)}
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: dur.micro } : spring.gentle}
      className="max-w-[92%] self-start rounded-[12px] rounded-bl-[4px] bg-surface-2/60 px-3 py-2 text-small text-ink select-text"
    >
      {turn.content}
      {streaming && <span className="caret-pulse">▍</span>}
    </motion.div>
  );
}

/** Interviewer transcript dock (plan.md §4.5): mini Orb, phase chip, turns, composer. */
export function Transcript() {
  const { session, turns, streamingTurnId, turnPhase, turnError, send } =
    useInterview();
  const modelStatus = useChat((s) => s.modelStatus);
  const refreshModelStatus = useChat((s) => s.refreshModelStatus);
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => void refreshModelStatus(), [refreshModelStatus]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, streamingTurnId]);

  // Before the very first token arrives there's no turnId yet to key off of —
  // treat "empty transcript + thinking/drafting" as the opening framing turn.
  const opening =
    turns.length === 0 &&
    (turnPhase === "thinking" || turnPhase === "drafting");
  const busy = !!streamingTurnId || opening;
  const orbState: OrbState = !busy
    ? "idle"
    : turnPhase === "drafting"
      ? "speaking"
      : "thinking";

  const locked =
    session?.phase === "interrogation" ||
    session?.phase === "scorecard" ||
    session?.phase === "abandoned";
  const canSend =
    !locked &&
    draft.trim() !== "" &&
    !streamingTurnId &&
    modelStatus?.state === "ready";

  const submit = () => {
    const content = draft.trim();
    if (!content || streamingTurnId) return;
    setDraft("");
    void send(content);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line">
      <header className="flex shrink-0 items-center gap-2.5 px-4 py-2.5">
        <FallbackOrb state={orbState} size={26} frozen={!!reduce} />
        <span className="text-small font-medium text-ink">Interviewer</span>
        {session && <Chip tone="info">{PHASE_LABEL[session.phase]}</Chip>}
      </header>

      {modelStatus && modelStatus.state !== "ready" && (
        <div className="px-4 pb-2">
          <ModelBanner />
          <p className="mt-1.5 text-[11px] text-faint">
            Run tests and hints still work while the interviewer is offline.
          </p>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-2"
      >
        {turns.length === 0 && !streamingTurnId && (
          <p className="py-6 text-center text-small text-faint">
            The interviewer will open with a framing question in a moment…
          </p>
        )}
        {turns.map((t) => (
          <TurnBubble
            key={t.id}
            turn={t}
            streaming={t.id === streamingTurnId}
          />
        ))}
      </div>

      {turnError && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-[10px] bg-danger/10 px-3 py-2">
          <AlertCircle
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-danger"
          />
          <p className="text-[12px] text-body">{turnError}</p>
        </div>
      )}

      <div className="shrink-0 border-t border-line p-3">
        <div
          className={cn(
            "flex items-end gap-2 rounded-[12px] bg-surface-2 hairline px-3 py-1.5",
            "focus-within:border-line-strong",
            locked && "opacity-50",
          )}
        >
          <textarea
            rows={1}
            value={draft}
            disabled={locked}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              locked ? "Session is read-only now." : "Reply to the interviewer…"
            }
            aria-label="Reply to interviewer"
            className="max-h-28 flex-1 resize-none bg-transparent py-1 text-small text-ink outline-none placeholder:text-faint"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            className={cn(
              "mb-0.5 rounded-[8px] p-1.5",
              canSend
                ? "bg-ink text-canvas hover:opacity-90"
                : "bg-surface-3 text-faint",
            )}
          >
            <ArrowUp size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
