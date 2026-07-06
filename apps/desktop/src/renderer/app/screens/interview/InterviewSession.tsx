import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Clock,
  Play,
  Check,
  Flag,
  Lightbulb,
  MoreHorizontal,
  LogOut,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import { spring, dur } from "../../../motion/springs";
import { useInterview } from "../../../lib/interviewStore";
import type { InterviewProblem } from "../../../lib/coreClient";
import { Button, Chip, CodeEditor } from "../../../ui";
import { ReadingMarkdown } from "../knowledge/ReadingMarkdown";
import { FallbackOrb } from "../../../orb/FallbackOrb";
import { Transcript } from "./Transcript";
import { ResultsDrawer } from "./ResultsDrawer";
import { Scorecard } from "./Scorecard";
import { DIFFICULTY_TONE, formatElapsed } from "./interviewMeta";

function ProblemHeader({ problem }: { problem: InterviewProblem }) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {problem.lcNumber && (
          <span className="font-mono text-[11px] text-faint tabular">
            LC {problem.lcNumber}
          </span>
        )}
        <h1 className="text-h2 text-ink">{problem.title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={DIFFICULTY_TONE[problem.difficulty]}>
          {problem.difficulty}
        </Chip>
        <Chip>{problem.pattern}</Chip>
        {problem.tags.map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
      </div>
    </div>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-1.5 text-body text-muted">
      <Clock size={14} strokeWidth={1.5} />
      <span className="font-mono text-small tabular">
        {formatElapsed(startedAt)}
      </span>
    </div>
  );
}

function HintButton() {
  const session = useInterview((s) => s.session);
  const streamingTurnId = useInterview((s) => s.streamingTurnId);
  const requestHint = useInterview((s) => s.requestHint);
  if (!session) return null;
  const used = session.hintsUsed;
  const maxed = used >= 3;
  const disabled = maxed || !!streamingTurnId;
  return (
    <button
      onClick={() => !disabled && void requestHint()}
      disabled={disabled}
      title={maxed ? "All 3 hints used" : `Request hint ${used + 1}/3`}
      className={cn(
        "flex h-8 items-center gap-2 rounded-[10px] bg-surface-2 hairline px-3 text-small",
        disabled
          ? "text-faint opacity-60"
          : "text-body hover:bg-surface-3 hover:text-ink",
      )}
    >
      <Lightbulb size={14} strokeWidth={1.5} />
      Hint
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "size-1.5 rounded-full",
              i < used ? "bg-iris" : "bg-surface-3",
            )}
          />
        ))}
      </span>
    </button>
  );
}

function OverflowMenu() {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const abandon = useInterview((s) => s.abandon);
  const phase = useInterview((s) => s.session?.phase);
  if (phase === "abandoned" || phase === "scorecard") return null;

  function close() {
    setOpen(false);
    setConfirming(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        className="rounded-[8px] p-1.5 text-faint hover:bg-surface-2 hover:text-body"
      >
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={close} />
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: dur.micro } }}
              transition={spring.smooth}
              className="glass overlay-shadow absolute top-9 right-0 z-40 w-64 rounded-[14px] bg-surface-1/90 p-1.5"
            >
              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-small text-danger hover:bg-danger/10"
                >
                  <LogOut size={14} strokeWidth={1.5} />
                  Abandon interview
                </button>
              ) : (
                <div className="flex flex-col gap-2 px-3 py-2">
                  <p className="text-small text-ink">
                    Abandon this session? Progress so far stays saved.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={close}
                      className="rounded-[8px] px-2.5 py-1 text-small text-muted hover:bg-surface-2 hover:text-body"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        close();
                        void abandon();
                      }}
                      className="rounded-[8px] bg-danger/10 px-2.5 py-1 text-small text-danger hover:bg-danger/15"
                    >
                      Abandon
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Toolbar({ locked }: { locked: boolean }) {
  const session = useInterview((s) => s.session);
  const evalLoading = useInterview((s) => s.evalLoading);
  const scorecardLoading = useInterview((s) => s.scorecardLoading);
  const scorecard = useInterview((s) => s.scorecard);
  const runTests = useInterview((s) => s.runTests);
  const finish = useInterview((s) => s.finish);
  const endInterview = useInterview((s) => s.endInterview);
  const reopenScorecard = useInterview((s) => s.reopenScorecard);
  const backToLauncher = useInterview((s) => s.backToLauncher);
  if (!session) return null;

  const isInterrogation = session.phase === "interrogation";
  const isOver =
    session.phase === "scorecard" || session.phase === "abandoned";

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
      <ElapsedTimer startedAt={session.startedAt} />
      <div className="flex items-center gap-2">
        {isOver && !!scorecard && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Flag size={14} strokeWidth={1.5} />}
            onClick={reopenScorecard}
          >
            View scorecard
          </Button>
        )}
        {isOver && (
          <Button
            size="sm"
            variant="primary"
            icon={<ArrowLeft size={14} strokeWidth={1.5} />}
            onClick={backToLauncher}
          >
            Back to interviews
          </Button>
        )}
        {!locked && <HintButton />}
        {!locked && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Play size={14} strokeWidth={1.5} />}
            loading={evalLoading}
            loadingLabel="Running…"
            title="⌘⏎"
            onClick={() => void runTests()}
          >
            Run tests
          </Button>
        )}
        {!locked && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Check size={14} strokeWidth={1.5} />}
            onClick={() => void finish()}
          >
            I'm done
          </Button>
        )}
        {isInterrogation && (
          <Button
            size="sm"
            variant="primary"
            icon={<Flag size={14} strokeWidth={1.5} />}
            loading={scorecardLoading}
            loadingLabel="Grading…"
            onClick={() => void endInterview()}
          >
            End interview → scorecard
          </Button>
        )}
        <OverflowMenu />
      </div>
    </div>
  );
}

function GradingOverlay() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: dur.base }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-canvas/85 backdrop-blur-sm"
    >
      <FallbackOrb state="thinking" size={64} frozen={!!reduce} />
      <p className="text-small text-muted">Scoring against the L5 bar…</p>
    </motion.div>
  );
}

function SessionSkeleton() {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <FallbackOrb state="thinking" size={56} frozen={!!reduce} />
      <p className="text-small text-muted">Setting up your interview…</p>
    </div>
  );
}

function SessionErrorState() {
  const { sessionError, backToLauncher } = useInterview();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <AlertCircle size={22} strokeWidth={1.5} className="text-danger" />
      <p className="text-small text-ink">{sessionError}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowLeft size={14} strokeWidth={1.5} />}
          onClick={backToLauncher}
        >
          Back to interviews
        </Button>
        <Button
          size="sm"
          icon={<RefreshCw size={14} strokeWidth={1.5} />}
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
      </div>
    </div>
  );
}

/** Coding interview session (plan.md §4.5): problem | transcript | editor | results. */
export function InterviewSession() {
  const session = useInterview((s) => s.session);
  const problem = useInterview((s) => s.problem);
  const sessionLoading = useInterview((s) => s.sessionLoading);
  const sessionError = useInterview((s) => s.sessionError);
  const code = useInterview((s) => s.code);
  const setCode = useInterview((s) => s.setCode);
  const evalResult = useInterview((s) => s.evalResult);
  const scorecard = useInterview((s) => s.scorecard);
  const scorecardLoading = useInterview((s) => s.scorecardLoading);
  const runTests = useInterview((s) => s.runTests);

  if (sessionLoading && !session) return <SessionSkeleton />;
  if (sessionError && !session) return <SessionErrorState />;
  if (!session || !problem) return null;

  const locked =
    session.phase === "interrogation" ||
    session.phase === "scorecard" ||
    session.phase === "abandoned";

  return (
    <div className="relative flex h-full">
      <div className="flex h-full w-[40%] min-w-[320px] flex-col border-r border-line">
        <div className="flex-[0_0_55%] overflow-y-auto p-6">
          <ProblemHeader problem={problem} />
          <ReadingMarkdown text={problem.promptMd} />
        </div>
        <div className="flex-[0_0_45%] min-h-0">
          <Transcript />
        </div>
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <Toolbar locked={locked} />
        <div className="relative min-h-0 flex-1">
          <CodeEditor
            value={code}
            onChange={setCode}
            language={session.language}
            readOnly={locked}
            onRun={() => void runTests()}
          />
          <AnimatePresence>
            {scorecardLoading && !scorecard && <GradingOverlay />}
          </AnimatePresence>
        </div>
        <ResultsDrawer result={evalResult} />
      </div>

      <Scorecard />
    </div>
  );
}
