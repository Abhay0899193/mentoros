import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { spring, dur } from "../../../motion/springs";
import { cn } from "../../../lib/cn";
import type { EvalResult, EvalTestResult } from "../../../lib/coreClient";

function TestRow({ result }: { result: EvalTestResult }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !result.passed || !!result.stdout;

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left",
          hasDetail && "hover:bg-surface-2",
        )}
      >
        {result.passed ? (
          <CheckCircle2
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-success"
          />
        ) : (
          <XCircle
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-danger"
          />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-body">
          {result.name}
        </span>
        <span className="font-mono text-[11px] text-faint tabular">
          {result.timeMs}ms
        </span>
        {hasDetail &&
          (open ? (
            <ChevronDown
              size={13}
              strokeWidth={1.5}
              className="shrink-0 text-faint"
            />
          ) : (
            <ChevronRight
              size={13}
              strokeWidth={1.5}
              className="shrink-0 text-faint"
            />
          ))}
      </button>
      {open && hasDetail && (
        <div className="flex flex-col gap-2 px-3 pb-3 font-mono text-[11px] leading-relaxed">
          <div>
            <p className="text-faint">input</p>
            <p className="text-body">{result.input}</p>
          </div>
          <div>
            <p className="text-faint">expected</p>
            <p className="text-body">{result.expected}</p>
          </div>
          {result.actual !== undefined && (
            <div>
              <p className="text-faint">actual</p>
              <p className={result.passed ? "text-body" : "text-danger"}>
                {result.actual}
              </p>
            </div>
          )}
          {result.error && (
            <div>
              <p className="text-faint">stderr</p>
              <pre className="whitespace-pre-wrap text-danger">
                {result.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Results drawer (plan.md §4.5): collapsed until first run, then summary + per-test rows. */
export function ResultsDrawer({ result }: { result: EvalResult | null }) {
  const [expanded, setExpanded] = useState(true);
  const reduce = useReducedMotion();

  if (!result) return null;

  const allPassed = result.passed === result.total && result.total > 0;

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: dur.micro } : spring.smooth}
      className="shrink-0 border-t border-line bg-surface-1"
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-surface-2"
      >
        {result.compileError ? (
          <AlertTriangle
            size={15}
            strokeWidth={1.5}
            className="shrink-0 text-danger"
          />
        ) : allPassed ? (
          <CheckCircle2
            size={15}
            strokeWidth={1.5}
            className="shrink-0 text-success"
          />
        ) : (
          <XCircle
            size={15}
            strokeWidth={1.5}
            className="shrink-0 text-danger"
          />
        )}
        <span className="flex-1 font-mono text-[12px] text-ink tabular">
          {result.compileError
            ? "Compile error"
            : `${result.passed}/${result.total} passed · ${result.durationMs}ms`}
        </span>
        {expanded ? (
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-faint"
          />
        ) : (
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-faint"
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: dur.micro } : spring.smooth}
            className="max-h-64 overflow-y-auto"
          >
            {result.compileError ? (
              <pre className="overflow-x-auto px-4 pb-4 font-mono text-[11px] whitespace-pre-wrap text-danger">
                {result.compileError}
              </pre>
            ) : (
              result.results.map((r) => <TestRow key={r.name} result={r} />)
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
