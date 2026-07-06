import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  CheckCircle2,
  Triangle,
  XCircle,
  AlertTriangle,
  Lightbulb,
  Sparkles,
  CalendarClock,
} from "lucide-react";
import {
  spring,
  dur,
  reduced,
  riseIn,
  staggerChildren,
} from "../../../motion/springs";
import { cn } from "../../../lib/cn";
import { useInterview } from "../../../lib/interviewStore";
import type { ScorecardDimension } from "../../../lib/coreClient";
import { Button, Chip, Card } from "../../../ui";
import { TYPE_COLOR, TYPE_ICON, typeLabel } from "../memory/memoryMeta";

const VERDICT_ICON = {
  pass: CheckCircle2,
  warn: Triangle,
  fail: XCircle,
} as const;
const VERDICT_TONE = {
  pass: "text-success",
  warn: "text-warning",
  fail: "text-danger",
} as const;

function DimensionRow({ dim }: { dim: ScorecardDimension }) {
  const Icon = VERDICT_ICON[dim.verdict];
  return (
    <div className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Icon
        size={15}
        strokeWidth={1.5}
        className={cn("mt-0.5 shrink-0", VERDICT_TONE[dim.verdict])}
      />
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium text-ink">{dim.name}</p>
        <p className="mt-0.5 text-small text-muted">{dim.note}</p>
      </div>
    </div>
  );
}

function ConfidenceDots({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "size-1.5 rounded-full",
            i <= n ? "bg-iris" : "bg-surface-3",
          )}
        />
      ))}
    </span>
  );
}

/** Scorecard overlay (plan.md §4.5) — terminal state of an interview; the visible "Profile updated" moment. */
export function Scorecard() {
  const { scorecard, scorecardDismissed, dismissScorecard, backToLauncher } =
    useInterview();
  const reduce = useReducedMotion();
  const open = !!scorecard && !scorecardDismissed;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && dismissScorecard();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissScorecard]);

  return (
    <AnimatePresence>
      {open && scorecard && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-[6vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.micro }}
          onMouseDown={(e) =>
            e.target === e.currentTarget && dismissScorecard()
          }
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Interview scorecard"
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }
            }
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={reduce ? { duration: dur.micro } : spring.smooth}
            className="glass overlay-shadow w-[760px] max-w-[calc(100vw-48px)] rounded-[20px] bg-surface-1/95"
          >
            <motion.div
              variants={reduced(reduce, staggerChildren)}
              initial="hidden"
              animate="visible"
              className="flex flex-col gap-6 p-8"
            >
              <motion.header
                variants={reduced(reduce, riseIn)}
                className="flex items-start justify-between gap-4"
              >
                <div>
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-display text-ink tabular">
                      {scorecard.score}
                    </span>
                    <span className="text-h3 text-faint">/10</span>
                    <Chip tone="iris">Calibrated: {scorecard.bar}</Chip>
                  </div>
                  <p className="mt-2 max-w-lg text-body text-body">
                    {scorecard.summary}
                  </p>
                </div>
              </motion.header>

              <motion.div
                variants={reduced(reduce, riseIn)}
                className="grid grid-cols-2 gap-3"
              >
                <Card padding="compact" className="border-danger/20">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      size={14}
                      strokeWidth={1.5}
                      className="text-danger"
                    />
                    <h3 className="text-small font-medium text-ink">
                      Biggest mistake
                    </h3>
                  </div>
                  <p className="mt-1.5 text-small text-muted">
                    {scorecard.biggestMistake}
                  </p>
                </Card>
                <Card padding="compact" className="border-success/20">
                  <div className="flex items-center gap-2">
                    <Lightbulb
                      size={14}
                      strokeWidth={1.5}
                      className="text-success"
                    />
                    <h3 className="text-small font-medium text-ink">
                      Biggest takeaway
                    </h3>
                  </div>
                  <p className="mt-1.5 text-small text-muted">
                    {scorecard.biggestTakeaway}
                  </p>
                </Card>
              </motion.div>

              <motion.section variants={reduced(reduce, riseIn)}>
                <h2 className="mb-2 text-label font-medium tracking-[0.02em] text-muted uppercase">
                  Dimensions
                </h2>
                <Card padding="none">
                  {scorecard.dimensions.map((d) => (
                    <DimensionRow key={d.name} dim={d} />
                  ))}
                </Card>
              </motion.section>

              <motion.div
                variants={reduced(reduce, riseIn)}
                className="grid grid-cols-2 gap-3"
              >
                <Card padding="compact" className="flex flex-col gap-2">
                  <h3 className="text-label font-medium tracking-[0.02em] text-muted uppercase">
                    Pattern
                  </h3>
                  <div className="flex items-center justify-between">
                    <span className="text-small text-ink">
                      {scorecard.pattern}
                    </span>
                    <ConfidenceDots n={scorecard.patternConfidence} />
                  </div>
                  <p className="font-mono text-[11px] text-faint tabular">
                    Hints {scorecard.hintsUsed}/3 · Tests{" "}
                    {scorecard.testsPassed}/{scorecard.testsTotal} ·{" "}
                    {Math.round(scorecard.durationSec / 60)}m
                  </p>
                </Card>
                <Card padding="compact" className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-1.5 text-label font-medium tracking-[0.02em] text-muted uppercase">
                    <CalendarClock size={12} strokeWidth={1.5} /> Spaced review
                  </h3>
                  <p className="text-small text-ink">
                    Recall grade {scorecard.recallGrade}/5
                  </p>
                  <p className="font-mono text-[11px] text-faint tabular">
                    Next review{" "}
                    {new Date(scorecard.nextReviewDate).toLocaleDateString(
                      undefined,
                      {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      },
                    )}
                  </p>
                </Card>
              </motion.div>

              <motion.section variants={reduced(reduce, riseIn)}>
                <h2 className="mb-2 text-label font-medium tracking-[0.02em] text-muted uppercase">
                  Next 3 problems
                </h2>
                <div className="flex flex-col gap-2">
                  {scorecard.nextProblems.map((p) => (
                    <Card
                      key={p.title}
                      padding="compact"
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-small font-medium text-ink">
                        {p.title}
                      </span>
                      <span className="text-right text-[12px] text-muted">
                        {p.reason}
                      </span>
                    </Card>
                  ))}
                </div>
              </motion.section>

              <motion.section variants={reduced(reduce, riseIn)}>
                <h2 className="mb-2 flex items-center gap-1.5 text-label font-medium tracking-[0.02em] text-muted uppercase">
                  <Sparkles size={12} strokeWidth={1.5} className="text-iris" />{" "}
                  Profile updated
                </h2>
                <div className="flex flex-wrap gap-2">
                  {scorecard.memoryWrites.map((w) => {
                    const Icon = TYPE_ICON[w.type];
                    return (
                      <span
                        key={w.id}
                        className="flex items-center gap-1.5 rounded-full bg-surface-2 hairline py-1 pr-2.5 pl-1.5 text-[12px] text-body"
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: TYPE_COLOR[w.type] }}
                        />
                        <Icon
                          size={12}
                          strokeWidth={1.5}
                          className="text-muted"
                        />
                        <span className="text-ink">{w.title}</span>
                        <span className="text-faint">
                          {typeLabel(w.type)} · {w.action}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </motion.section>

              <motion.footer
                variants={reduced(reduce, riseIn)}
                className="flex justify-end gap-2 pt-2"
              >
                <Button variant="secondary" onClick={backToLauncher}>
                  Back to interviews
                </Button>
                <Button variant="primary" onClick={dismissScorecard}>
                  Review code
                </Button>
              </motion.footer>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
