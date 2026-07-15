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
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import { spring, dur } from "../../../motion/springs";
import { useInterview } from "../../../lib/interviewStore";
import { useIsMobile } from "../../../lib/useBreakpoint";
import type { InterviewProblem } from "../../../lib/coreClient";
import { Button, Chip, CodeEditor } from "../../../ui";
import { ReadingMarkdown } from "../knowledge/ReadingMarkdown";
import { FallbackOrb } from "../../../orb/FallbackOrb";
import { leetCodeUrlForSlug } from "../../../lib/leetcode";
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
        {problem.slug && (
          <a
            href={leetCodeUrlForSlug(problem.slug)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-faint hover:text-ink"
            title="Open on LeetCode"
          >
            <ExternalLink size={11} strokeWidth={1.5} />
            Open on LeetCode
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Practice mode has no transcript, so the (LLM-free, canned) hint ladder
 * surfaces inline under the problem statement instead.
 */
function PracticeHints() {
  const turns = useInterview((s) => s.turns);
  const hints = turns.filter((t) => t.kind === "hint" && t.content);
  if (hints.length === 0) return null;
  return (
    <div className="mt-5 flex flex-col gap-2">
      {hints.map((h) => (
        <motion.div
          key={h.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.smooth}
          className="rounded-[10px] bg-surface-2 hairline p-3"
        >
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <Lightbulb size={12} strokeWidth={1.5} className="text-iris" />
            Hint {h.hintLevel}
          </p>
          <p className="text-small leading-relaxed text-body">{h.content}</p>
        </motion.div>
      ))}
    </div>
  );
}

/**
 * Practice + launched from a Learning task: passing every hidden test offers
 * the "mark task done" (+XP) close-out (plan §F). The XP toast/level-up juice
 * itself is learningStore's.
 */
function MarkTaskDoneBanner() {
  const practiceLink = useInterview((s) => s.practiceLink);
  const evalResult = useInterview((s) => s.evalResult);
  const markLinkedTaskDone = useInterview((s) => s.markLinkedTaskDone);
  const allPassed =
    !!evalResult && evalResult.total > 0 && evalResult.passed === evalResult.total;
  if (!practiceLink || !allPassed) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.smooth}
      className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-1 px-4 py-2.5"
    >
      <p className="min-w-0 truncate text-small text-body">
        {practiceLink.done ? (
          <span className="flex items-center gap-1.5 text-success">
            <Check size={14} strokeWidth={2} />
            Task marked done — nice work.
          </span>
        ) : (
          <>All tests pass — close out “{practiceLink.taskTitle}”?</>
        )}
      </p>
      {!practiceLink.done && (
        <Button
          size="sm"
          variant="primary"
          icon={<Sparkles size={14} strokeWidth={1.5} />}
          onClick={() => void markLinkedTaskDone()}
        >
          Mark task done · +{practiceLink.xpWorth} XP
        </Button>
      )}
    </motion.div>
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
        "tap-target flex h-8 items-center gap-2 rounded-[10px] bg-surface-2 hairline px-3 text-small",
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
  // The toolbar's button row scrolls horizontally on a phone (below), which
  // would clip an `absolute` popover anchored inside it — pin this one to
  // the viewport there instead so it escapes that ancestor's overflow.
  const isMobile = useIsMobile();
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
        className="tap-target rounded-[8px] p-1.5 text-faint hover:bg-surface-2 hover:text-body"
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
              className={cn(
                "glass overlay-shadow z-40 w-64 max-w-[calc(100vw-2rem)] rounded-[14px] bg-surface-1/90 p-1.5",
                isMobile ? "fixed top-16 right-3" : "absolute top-9 right-0",
              )}
            >
              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  className="tap-target flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-small text-danger hover:bg-danger/10"
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
                      className="tap-target rounded-[8px] px-2.5 py-1 text-small text-muted hover:bg-surface-2 hover:text-body"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        close();
                        void abandon();
                      }}
                      className="tap-target rounded-[8px] bg-danger/10 px-2.5 py-1 text-small text-danger hover:bg-danger/15"
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

  const practice = session.mode === "practice";
  const isInterrogation = session.phase === "interrogation";
  const isOver =
    session.phase === "scorecard" || session.phase === "abandoned";

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
      <div className="shrink-0">
        <ElapsedTimer startedAt={session.startedAt} />
      </div>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
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
            variant={practice ? "primary" : "secondary"}
            icon={
              practice ? (
                <Flag size={14} strokeWidth={1.5} />
              ) : (
                <Check size={14} strokeWidth={1.5} />
              )
            }
            loading={practice && scorecardLoading}
            loadingLabel="Checking…"
            onClick={() => void finish()}
          >
            {practice ? "Finish practice" : "I'm done"}
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

function GradingOverlay({ label }: { label?: string }) {
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
      <p className="text-small text-muted">{label ?? "Scoring against the L5 bar…"}</p>
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

type MobileTab = "problem" | "chat" | "code";

const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: "problem", label: "Problem" },
  { id: "chat", label: "Interviewer" },
  { id: "code", label: "Code" },
];

/** Phone-only segmented control — the split panes collapse to one at a time (docs/RESPONSIVE.md rule 3). */
function MobileTabBar({
  tab,
  onChange,
  tabs = MOBILE_TABS,
}: {
  tab: MobileTab;
  onChange: (t: MobileTab) => void;
  tabs?: { id: MobileTab; label: string }[];
}) {
  const reduce = useReducedMotion();
  return (
    <div
      role="tablist"
      aria-label="Interview view"
      className="relative mx-3 my-2 flex shrink-0 gap-1 rounded-full bg-surface-2 p-1 hairline"
    >
      {tabs.map((o) => {
        const active = tab === o.id;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "tap-target relative z-10 flex flex-1 items-center justify-center rounded-full px-2 text-small font-medium",
              active ? "text-ink" : "text-muted hover:text-body",
            )}
          >
            {o.label}
            {active && (
              <motion.span
                layoutId="interview-mobile-tab-pill"
                transition={reduce ? { duration: dur.micro } : spring.smooth}
                className="absolute inset-0 -z-10 rounded-full bg-surface-3 hairline-strong"
              />
            )}
          </button>
        );
      })}
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
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<MobileTab>("problem");

  if (sessionLoading && !session) return <SessionSkeleton />;
  if (sessionError && !session) return <SessionErrorState />;
  if (!session || !problem) return null;

  // Practice mode (plan §F): no interviewer → no transcript pane. The left
  // column is the problem statement full-height (+ inline hints), the right
  // stays Monaco + results; phones get two tabs instead of three.
  const practice = session.mode === "practice";

  const locked =
    session.phase === "interrogation" ||
    session.phase === "scorecard" ||
    session.phase === "abandoned";

  // On a phone the problem | transcript | editor split can't survive
  // side-by-side (docs/RESPONSIVE.md rule 3) — a segmented control swaps
  // between the same three panes instead. All panes stay mounted (just
  // hidden) so Monaco's editor instance and scroll positions survive tab
  // switches. `md:` restores the exact desktop split below unchanged.
  return (
    <div className="relative flex h-full flex-col md:flex-row">
      {isMobile && <Toolbar locked={locked} />}
      {isMobile && (
        <MobileTabBar
          tab={mobileTab}
          onChange={setMobileTab}
          tabs={practice ? MOBILE_TABS.filter((t) => t.id !== "chat") : MOBILE_TABS}
        />
      )}

      <div
        className={cn(
          "flex h-full w-full flex-col border-line md:w-[40%] md:min-w-[320px] md:border-r",
          isMobile && mobileTab === "code" && "hidden",
        )}
      >
        <div
          className={
            isMobile
              ? mobileTab === "problem"
                ? "min-h-0 flex-1 overflow-y-auto p-4"
                : "hidden"
              : practice
                ? "min-h-0 flex-1 overflow-y-auto p-6"
                : "flex-[0_0_55%] overflow-y-auto p-6"
          }
        >
          <ProblemHeader problem={problem} />
          <ReadingMarkdown text={problem.promptMd} />
          {practice && <PracticeHints />}
        </div>
        {!practice && (
          <div
            className={
              isMobile
                ? mobileTab === "chat"
                  ? "flex min-h-0 flex-1 flex-col"
                  : "hidden"
                : "flex-[0_0_45%] min-h-0"
            }
          >
            <Transcript />
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex h-full min-w-0 flex-1 flex-col",
          isMobile && mobileTab !== "code" && "hidden",
        )}
      >
        {!isMobile && <Toolbar locked={locked} />}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <CodeEditor
            value={code}
            onChange={setCode}
            language={session.language}
            readOnly={locked}
            onRun={() => void runTests()}
          />
          <AnimatePresence>
            {scorecardLoading && !scorecard && (
              <GradingOverlay label={practice ? "Checking your solution…" : undefined} />
            )}
          </AnimatePresence>
        </div>
        {practice && <MarkTaskDoneBanner />}
        <ResultsDrawer result={evalResult} />
      </div>

      <Scorecard />
    </div>
  );
}
