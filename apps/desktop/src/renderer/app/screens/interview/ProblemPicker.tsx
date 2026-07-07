import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  RefreshCw,
  Sparkles,
  Hash,
  Upload,
  Trash2,
} from "lucide-react";
import { useInterview } from "../../../lib/interviewStore";
import type {
  InterviewLanguage,
  InterviewProblemMeta,
} from "../../../lib/coreClient";
import { cn } from "../../../lib/cn";
import { Overlay, Button, Chip } from "../../../ui";
import { DIFFICULTY_TONE } from "./interviewMeta";
import { ImportProblemOverlay } from "./ImportProblemOverlay";

function LanguageToggle({
  value,
  onChange,
}: {
  value: InterviewLanguage;
  onChange: (l: InterviewLanguage) => void;
}) {
  const opts: InterviewLanguage[] = ["python", "javascript"];
  return (
    <div
      className="inline-flex rounded-full bg-surface-2 p-0.5 hairline"
      role="tablist"
      aria-label="Language"
    >
      {opts.map((o) => (
        <button
          key={o}
          role="tab"
          aria-selected={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full px-3 py-1 text-small font-medium capitalize",
            value === o ? "bg-ink text-canvas" : "text-muted hover:text-body",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function ProblemRow({
  problem,
  selected,
  onSelect,
  onStart,
  onDelete,
}: {
  problem: InterviewProblemMeta;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <li>
        <div className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5">
          <p className="min-w-0 flex-1 truncate text-small text-ink">
            Delete custom problem?{" "}
            <span className="text-muted">“{problem.title}”</span>
          </p>
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        onClick={onStart}
        onMouseEnter={onSelect}
        onFocus={onSelect}
        data-selected={selected}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-[10px] px-3 py-2.5 text-left",
          selected ? "bg-surface-2" : "hover:bg-surface-2/60",
          problem.custom && "pr-9",
          // outline (not ring): ring is box-shadow and would shadow the
          // global :focus-visible ring on the row where it matters most.
          problem.recommended &&
            "outline outline-1 -outline-offset-1 outline-iris/30",
        )}
      >
        <div className="flex items-center gap-2">
          {problem.lcNumber && (
            <span className="flex items-center gap-0.5 font-mono text-[11px] text-faint tabular">
              <Hash size={10} strokeWidth={1.5} />
              {problem.lcNumber}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-small font-medium text-ink">
            {problem.title}
          </span>
          {problem.custom && <Chip>custom</Chip>}
          {typeof problem.lastScore === "number" && (
            <span className="font-mono text-[11px] text-faint tabular">
              best {problem.lastScore}/10
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {problem.recommended && (
            <Chip tone="iris" icon={<Sparkles size={11} strokeWidth={1.5} />}>
              Recommended
            </Chip>
          )}
          <Chip tone={DIFFICULTY_TONE[problem.difficulty]}>
            {problem.difficulty}
          </Chip>
          <Chip>{problem.pattern}</Chip>
        </div>
        {problem.recommended && problem.recommendedReason && (
          <p className="pl-0.5 text-[12px] text-muted">
            {problem.recommendedReason}
          </p>
        )}
      </button>
      {problem.custom && (
        <button
          aria-label={`Delete ${problem.title}`}
          onClick={() => setConfirming(true)}
          className="absolute top-2.5 right-2.5 rounded-[6px] p-1 text-faint opacity-0 hover:bg-surface-3 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={13} strokeWidth={1.5} />
        </button>
      )}
    </li>
  );
}

/** Coding problem picker (plan.md §4.5) — overlay sheet, keyboard-navigable. */
export function ProblemPicker() {
  const {
    pickerOpen,
    closePicker,
    problems,
    problemsLoading,
    problemsError,
    loadProblems,
    pickerLanguage,
    setPickerLanguage,
    start,
    sessionLoading,
    openImport,
    deleteProblem,
    lastImportedProblemId,
    clearLastImportedProblemId,
  } = useInterview();

  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Recommended problem pinned first.
  const ordered = [...problems].sort(
    (a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0),
  );

  useEffect(() => {
    if (pickerOpen) setSelected(0);
  }, [pickerOpen, problems.length]);

  // Keyboard-first (§3.0): focus the list on open so ↑↓/⏎ work immediately.
  useEffect(() => {
    if (pickerOpen && !problemsLoading) scrollRef.current?.focus();
  }, [pickerOpen, problemsLoading]);

  // Keep the selected row visible while arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // After an import saves, the picker list refreshes — jump to and select
  // the new row once it shows up in `problems`.
  useEffect(() => {
    if (!lastImportedProblemId) return;
    const idx = ordered.findIndex((p) => p.id === lastImportedProblemId);
    if (idx !== -1) setSelected(idx);
    clearLastImportedProblemId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastImportedProblemId, problems]);

  const startSelected = (id?: string) => {
    const problemId = id ?? ordered[selected]?.id;
    void start("coding", problemId, pickerLanguage);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, ordered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      // A focused row handles Enter natively via its own click — and its
      // onFocus already synced `selected`, so don't double-start.
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      e.preventDefault();
      startSelected();
    }
  };

  return (
    <>
      <Overlay
        open={pickerOpen}
        onClose={closePicker}
        width={640}
        align="center"
        className="flex max-h-[70vh] flex-col"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-h3 text-ink">Start a coding interview</h2>
            <p className="mt-0.5 text-small text-muted">
              Pick a problem — the recommended one targets a live weakness.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Button
              size="sm"
              variant="secondary"
              icon={<Upload size={13} strokeWidth={1.5} />}
              onClick={openImport}
            >
              Import problem
            </Button>
            <LanguageToggle
              value={pickerLanguage}
              onChange={setPickerLanguage}
            />
          </div>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto p-2 focus:outline-none"
          onKeyDown={onKeyDown}
          tabIndex={-1}
        >
          {problemsLoading ? (
            <div className="flex flex-col gap-1.5 p-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-[10px] bg-surface-2"
                />
              ))}
            </div>
          ) : problemsError ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <AlertCircle
                size={20}
                strokeWidth={1.5}
                className="text-danger"
              />
              <p className="text-small text-muted">{problemsError}</p>
              <Button
                size="sm"
                icon={<RefreshCw size={14} strokeWidth={1.5} />}
                onClick={() => void loadProblems("coding")}
              >
                Retry
              </Button>
            </div>
          ) : ordered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <p className="text-small text-ink">
                No problems in the bank yet.
              </p>
              <p className="max-w-xs text-small text-muted">
                The coding problem bank ships with the core engine — check back
                after the next update.
              </p>
            </div>
          ) : (
            <ul ref={listRef} className="flex flex-col gap-0.5">
              {ordered.map((p, i) => (
                <ProblemRow
                  key={p.id}
                  problem={p}
                  selected={i === selected}
                  onSelect={() => setSelected(i)}
                  onStart={() => startSelected(p.id)}
                  onDelete={() => void deleteProblem(p.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <p className="text-[11px] text-faint">↑↓ navigate · ⏎ start</p>
          <Button
            variant="primary"
            loading={sessionLoading}
            loadingLabel="Starting…"
            disabled={ordered.length === 0}
            onClick={() => startSelected()}
          >
            Start
          </Button>
        </div>
      </Overlay>
      <ImportProblemOverlay />
    </>
  );
}
