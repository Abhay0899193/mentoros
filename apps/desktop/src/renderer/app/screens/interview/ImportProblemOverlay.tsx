import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useInterview } from "../../../lib/interviewStore";
import type {
  DraftValidation,
  ImportedTestDraft,
  InterviewLanguage,
  InterviewProblemDraft,
} from "../../../lib/coreClient";
import { cn } from "../../../lib/cn";
import { Overlay, Button, Spinner } from "../../../ui";
import { useIsMobile } from "../../../lib/useBreakpoint";

const PASTE_PLACEHOLDER = `Paste a problem statement — LeetCode-style or any format. e.g.:

Given an array of integers nums and an integer target, return
indices of the two numbers that add up to target.

Example:
Input: nums = [2,7,11,15], target = 9
Output: [0,1]

Constraints:
2 <= nums.length <= 10^4
-10^9 <= nums[i], target <= 10^9`;

type Step = "paste" | "review";
type Normalize = "none" | "sortInner" | "sortOuter";

interface EditTest {
  id: number;
  name: string;
  argsText: string;
  expectedText: string;
  normalize: Normalize;
  argsError?: string;
  expectedError?: string;
}

/* Controls in this overlay use outline-based focus/error rings — the global
   box-shadow :focus-visible ring collides visually with the test-table row
   hairlines, same tradeoff already called out in ProblemPicker.tsx. */
const FIELD =
  "h-9 w-full rounded-[10px] bg-surface-2 hairline px-3 text-small text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--iris)]";
const FIELD_MONO = cn(FIELD, "font-mono text-[12px]");
const TEXTAREA_MONO = cn(
  FIELD_MONO,
  "h-auto min-h-24 w-full resize-y rounded-[10px] py-2 leading-relaxed",
);
const CELL_INPUT =
  "h-8 w-full rounded-[8px] bg-surface-2 px-2 text-[12px] text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--iris)]";
const ERROR_RING = "outline outline-2 outline-offset-0 outline-danger/70";

let testIdSeq = 0;
function nextTestId() {
  return ++testIdSeq;
}

function toEditTest(t: ImportedTestDraft): EditTest {
  return {
    id: nextTestId(),
    name: t.name,
    argsText: JSON.stringify(t.args ?? []),
    expectedText: JSON.stringify(t.expected ?? null),
    normalize: t.normalize ?? "none",
  };
}

function parseJsonField(text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: "Invalid JSON" };
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
        {label}
        {hint && <span className="ml-1 normal-case text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function DifficultySegmented({
  value,
  onChange,
}: {
  value: InterviewProblemDraft["difficulty"];
  onChange: (v: InterviewProblemDraft["difficulty"]) => void;
}) {
  const opts: InterviewProblemDraft["difficulty"][] = [
    "easy",
    "medium",
    "hard",
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Difficulty"
      className="inline-flex rounded-full bg-surface-2 p-0.5 hairline"
    >
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "tap-target rounded-full px-3 py-1 text-small font-medium capitalize outline-none",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris)]",
            value === o ? "bg-ink text-canvas" : "text-muted hover:text-body",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/**
 * Problem importer (paste statement → LLM draft → editable review → save).
 * Two steps in one glass overlay: `paste` (generate) and `review` (edit +
 * validate + save). Draft-editing state is local — only overlay-open state,
 * generation status, and list refresh live in the store (interviewStore.ts).
 */
export function ImportProblemOverlay() {
  const importOpen = useInterview((s) => s.importOpen);
  const closeImport = useInterview((s) => s.closeImport);
  const importGenerating = useInterview((s) => s.importGenerating);
  const importGenerateError = useInterview((s) => s.importGenerateError);
  const clearImportGenerateError = useInterview(
    (s) => s.clearImportGenerateError,
  );
  const generateDraft = useInterview((s) => s.generateDraft);
  const validateDraft = useInterview((s) => s.validateDraft);
  const saveDraft = useInterview((s) => s.saveDraft);
  const importValidating = useInterview((s) => s.importValidating);
  const importSaving = useInterview((s) => s.importSaving);
  const problems = useInterview((s) => s.problems);
  const importPrefill = useInterview((s) => s.importPrefill);
  const importIntent = useInterview((s) => s.importIntent);

  const [step, setStep] = useState<Step>("paste");
  const [sourceText, setSourceText] = useState("");
  // LeetCode titleSlug carried through the Solve flow so the saved custom
  // problem resolves by slug next time (and gets an "Open on LeetCode" link).
  const [slug, setSlug] = useState<string | undefined>(undefined);
  const [cancelled, setCancelled] = useState(false);
  const genIdRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // review-step form state
  const [title, setTitle] = useState("");
  const [lcNumber, setLcNumber] = useState<number | undefined>(undefined);
  const [difficulty, setDifficulty] =
    useState<InterviewProblemDraft["difficulty"]>("medium");
  const [pattern, setPattern] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [promptMd, setPromptMd] = useState("");
  const [hint1, setHint1] = useState("");
  const [hint2, setHint2] = useState("");
  const [hint3, setHint3] = useState("");
  const [starterLang, setStarterLang] = useState<InterviewLanguage>("python");
  const [starterCode, setStarterCode] = useState<
    Record<InterviewLanguage, string>
  >({ python: "", javascript: "" });
  const [tests, setTests] = useState<EditTest[]>([]);
  const [referenceSolution, setReferenceSolution] = useState("");
  const [refSolutionOpen, setRefSolutionOpen] = useState(false);
  const [validation, setValidation] = useState<DraftValidation | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const existingPatterns = useMemo(
    () => Array.from(new Set(problems.map((p) => p.pattern))).sort(),
    [problems],
  );

  // Reset everything each time the overlay opens. A Solve-flow prefill
  // (fetched LC statement) skips straight into generation; an empty prefill
  // (fetch failed) still carries the slug and waits for a paste.
  useEffect(() => {
    if (!importOpen) return;
    setStep("paste");
    setSourceText(importPrefill?.sourceText ?? "");
    setSlug(importPrefill?.slug || undefined);
    setCancelled(false);
    setConfirmDiscard(false);
    clearImportGenerateError();
    if (importPrefill?.sourceText) {
      void handleGenerate(importPrefill.sourceText);
      return;
    }
    const t = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importOpen]);

  function loadDraftIntoForm(draft: InterviewProblemDraft) {
    setTitle(draft.title);
    setLcNumber(draft.lcNumber);
    setDifficulty(draft.difficulty);
    setPattern(draft.pattern);
    setTagsText(draft.tags.join(", "));
    setFunctionName(draft.functionName);
    setPromptMd(draft.promptMd);
    setHint1(draft.hints[0] ?? "");
    setHint2(draft.hints[1] ?? "");
    setHint3(draft.hints[2] ?? "");
    setStarterLang("python");
    setStarterCode({
      python: draft.starterCode.python ?? "",
      javascript: draft.starterCode.javascript ?? "",
    });
    setTests(draft.tests.map(toEditTest));
    setReferenceSolution(draft.referenceSolution);
    setRefSolutionOpen(false);
  }

  // Any user edit invalidates the last validation — Save requires a fresh ok.
  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setValidation(null);
    };
  }

  function updateTest(id: number, patch: Partial<EditTest>) {
    setValidation(null);
    setTests((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function blurTestArgs(id: number) {
    setTests((ts) =>
      ts.map((t) => {
        if (t.id !== id) return t;
        const { error } = parseJsonField(t.argsText);
        return { ...t, argsError: error };
      }),
    );
  }

  function blurTestExpected(id: number) {
    setTests((ts) =>
      ts.map((t) => {
        if (t.id !== id) return t;
        const { error } = parseJsonField(t.expectedText);
        return { ...t, expectedError: error };
      }),
    );
  }

  function addTest() {
    setValidation(null);
    setTests((ts) => [
      ...ts,
      {
        id: nextTestId(),
        name: `case_${ts.length + 1}`,
        argsText: "[]",
        expectedText: "null",
        normalize: "none",
      },
    ]);
  }

  function removeTest(id: number) {
    setValidation(null);
    setTests((ts) => ts.filter((t) => t.id !== id));
  }

  const hasJsonErrors = tests.some((t) => t.argsError || t.expectedError);

  function buildDraft(): InterviewProblemDraft | null {
    if (hasJsonErrors) return null;
    const parsedTests: ImportedTestDraft[] = [];
    for (const t of tests) {
      const args = parseJsonField(t.argsText);
      const expected = parseJsonField(t.expectedText);
      if (args.error || expected.error) return null;
      parsedTests.push({
        name: t.name,
        args: (args.value as unknown[]) ?? [],
        expected: expected.value,
        normalize: t.normalize === "none" ? null : t.normalize,
      });
    }
    return {
      title,
      lcNumber,
      difficulty,
      pattern,
      tags: tagsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      functionName,
      promptMd,
      starterCode,
      hints: [hint1, hint2, hint3],
      tests: parsedTests,
      referenceSolution,
      ...(slug ? { slug } : {}),
    };
  }

  async function handleGenerate(prefillText?: string) {
    const text = (prefillText ?? sourceText).trim();
    if (!text || importGenerating) return;
    setCancelled(false);
    const myGenId = ++genIdRef.current;
    const result = await generateDraft(text);
    if (genIdRef.current !== myGenId) return; // cancelled meanwhile
    if (!result) return; // importGenerateError already set
    loadDraftIntoForm(result.draft);
    setValidation(result.validation);
    setStep("review");
  }

  async function handleRevalidate() {
    const draft = buildDraft();
    if (!draft) return;
    const result = await validateDraft(draft);
    if (result) setValidation(result);
  }

  async function handleSave() {
    const draft = buildDraft();
    if (!draft) return;
    await saveDraft(draft);
  }

  function requestClose() {
    if (importGenerating && !cancelled) {
      // Soft-cancel: the in-flight request still completes server-side (no
      // abort signal on the contract), but its result is discarded and the
      // paste step is restored immediately.
      genIdRef.current++;
      setCancelled(true);
      return;
    }
    if (step === "review" && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    closeImport();
  }

  const saveDisabled =
    !validation?.ok || hasJsonErrors || importSaving || !title.trim();
  const showWorking = importGenerating && !cancelled;
  const isMobile = useIsMobile();

  return (
    <Overlay
      open={importOpen}
      onClose={requestClose}
      width={step === "review" ? 960 : 640}
      align="center"
      className={cn("flex w-full flex-col", !isMobile && "max-h-[85dvh]")}
    >
      {confirmDiscard && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-5 py-3">
          <p className="text-small text-ink">
            Discard this draft? Your edits will be lost.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDiscard(false)}
            >
              Keep editing
            </Button>
            <Button size="sm" variant="danger" onClick={closeImport}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {step === "paste" ? (
        <>
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-h3 text-ink">
              {importIntent === "practice" ? "Set up practice" : "Import a problem"}
            </h2>
            <p className="mt-0.5 text-small text-muted">
              {importIntent === "practice"
                ? "This problem isn't in your bank yet. The mentor drafts starters, hidden tests, and hints from the statement — review, save, and practice starts."
                : "Paste a statement — the mentor drafts starters, hidden tests, hints, and a reference solution, then checks it against the tests before you review it."}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {importGenerateError && !showWorking ? (
              <div className="flex flex-col items-center gap-3 rounded-[10px] bg-surface-2 p-8 text-center">
                <AlertCircle
                  size={20}
                  strokeWidth={1.5}
                  className="text-danger"
                />
                <p className="max-w-md text-small text-ink">
                  {importGenerateError}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    icon={<RefreshCw size={14} strokeWidth={1.5} />}
                    onClick={() => void handleGenerate()}
                  >
                    Retry
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearImportGenerateError}
                  >
                    Edit paste
                  </Button>
                </div>
              </div>
            ) : showWorking ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-[10px] bg-surface-2 p-12 text-center">
                <Spinner />
                <p className="text-small text-muted">
                  Drafting problem, running reference tests…
                </p>
                <p className="text-[11px] text-faint">
                  This can take up to a minute. Press Esc to cancel.
                </p>
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleGenerate();
                  }
                }}
                placeholder={PASTE_PLACEHOLDER}
                spellCheck={false}
                className="h-full min-h-72 w-full resize-none rounded-[10px] bg-surface-2 hairline p-4 font-mono text-[12px] leading-relaxed text-ink outline-none placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--iris)]"
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3 sm:justify-between">
            <span className="hidden items-center gap-1.5 text-[11px] text-faint fine:flex">
              <kbd className="rounded-[6px] border border-line border-b-2 border-b-line-strong bg-surface-2 px-1 font-mono text-[11px] text-muted">
                ⌘
              </kbd>
              <kbd className="rounded-[6px] border border-line border-b-2 border-b-line-strong bg-surface-2 px-1 font-mono text-[11px] text-muted">
                ⏎
              </kbd>
              generate
            </span>
            <Button
              variant="primary"
              loading={showWorking}
              loadingLabel="Drafting…"
              disabled={sourceText.trim() === "" || showWorking}
              onClick={() => void handleGenerate()}
            >
              Generate
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-h3 text-ink">Review draft</h2>
            <p className="mt-0.5 text-small text-muted">
              Edit anything before saving — tests run against the reference
              solution below.
              {slug &&
                " Heads up: these hidden tests are generated approximations, not LeetCode's official ones."}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-visible p-4 md:overflow-y-auto md:p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Title">
                  <input
                    value={title}
                    onChange={(e) => edit(setTitle)(e.target.value)}
                    placeholder="Two Sum"
                    className={FIELD}
                  />
                </Field>
                <Field label="Difficulty">
                  <DifficultySegmented
                    value={difficulty}
                    onChange={edit(setDifficulty)}
                  />
                </Field>
                <Field label="Pattern">
                  <input
                    list="import-pattern-options"
                    value={pattern}
                    onChange={(e) => edit(setPattern)(e.target.value)}
                    placeholder="sliding-window"
                    className={FIELD_MONO}
                  />
                  <datalist id="import-pattern-options">
                    {existingPatterns.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Tags" hint="(comma-separated)">
                  <input
                    value={tagsText}
                    onChange={(e) => edit(setTagsText)(e.target.value)}
                    placeholder="arrays, hash-map"
                    className={FIELD}
                  />
                </Field>
              </div>

              <Field label="Function name">
                <input
                  value={functionName}
                  onChange={(e) => edit(setFunctionName)(e.target.value)}
                  placeholder="twoSum"
                  className={FIELD_MONO}
                />
              </Field>

              <Field label="Prompt (markdown)">
                <textarea
                  value={promptMd}
                  onChange={(e) => edit(setPromptMd)(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  className={TEXTAREA_MONO}
                />
              </Field>

              <div className="flex flex-col gap-2.5">
                <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
                  Hints (progressive ladder)
                </span>
                <Field label="Recognition signal">
                  <input
                    value={hint1}
                    onChange={(e) => edit(setHint1)(e.target.value)}
                    className={FIELD}
                  />
                </Field>
                <Field label="Approach shape">
                  <input
                    value={hint2}
                    onChange={(e) => edit(setHint2)(e.target.value)}
                    className={FIELD}
                  />
                </Field>
                <Field label="Key insight">
                  <input
                    value={hint3}
                    onChange={(e) => edit(setHint3)(e.target.value)}
                    className={FIELD}
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
                    Starter code
                  </span>
                  <div
                    role="tablist"
                    aria-label="Starter code language"
                    className="inline-flex rounded-full bg-surface-2 p-0.5 hairline"
                  >
                    {(["python", "javascript"] as InterviewLanguage[]).map(
                      (l) => (
                        <button
                          key={l}
                          type="button"
                          role="tab"
                          aria-selected={starterLang === l}
                          onClick={() => setStarterLang(l)}
                          className={cn(
                            "tap-target rounded-full px-3 py-1 text-small font-medium capitalize outline-none",
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris)]",
                            starterLang === l
                              ? "bg-ink text-canvas"
                              : "text-muted hover:text-body",
                          )}
                        >
                          {l}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <textarea
                  value={starterCode[starterLang]}
                  onChange={(e) =>
                    edit((v: string) =>
                      setStarterCode((c) => ({ ...c, [starterLang]: v })),
                    )(e.target.value)
                  }
                  rows={8}
                  spellCheck={false}
                  className={TEXTAREA_MONO}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-label font-medium tracking-[0.02em] text-faint uppercase">
                    Tests
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={13} strokeWidth={1.5} />}
                    onClick={addTest}
                  >
                    Add test
                  </Button>
                </div>
                <div className="overflow-x-auto overflow-y-hidden rounded-[10px] hairline">
                  <table className="w-full min-w-[560px] table-fixed border-collapse text-small">
                    <thead>
                      <tr className="bg-surface-2 text-left text-label uppercase tracking-[0.02em] text-faint">
                        <th className="w-[18%] px-2 py-1.5 font-medium">
                          Name
                        </th>
                        <th className="w-[27%] px-2 py-1.5 font-medium">
                          Args (JSON)
                        </th>
                        <th className="w-[27%] px-2 py-1.5 font-medium">
                          Expected (JSON)
                        </th>
                        <th className="w-[20%] px-2 py-1.5 font-medium">
                          Normalize
                        </th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {tests.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 py-4 text-center text-small text-muted"
                          >
                            No tests yet — add at least one before saving.
                          </td>
                        </tr>
                      )}
                      {tests.map((t) => (
                        <tr key={t.id} className="border-t border-line">
                          <td className="px-2 py-1.5 align-top">
                            <input
                              value={t.name}
                              onChange={(e) =>
                                updateTest(t.id, { name: e.target.value })
                              }
                              className={cn(CELL_INPUT, "font-mono")}
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input
                              value={t.argsText}
                              onChange={(e) =>
                                updateTest(t.id, { argsText: e.target.value })
                              }
                              onBlur={() => blurTestArgs(t.id)}
                              className={cn(
                                CELL_INPUT,
                                "font-mono",
                                t.argsError && ERROR_RING,
                              )}
                            />
                            {t.argsError && (
                              <p className="mt-0.5 text-[10px] text-danger">
                                {t.argsError}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input
                              value={t.expectedText}
                              onChange={(e) =>
                                updateTest(t.id, {
                                  expectedText: e.target.value,
                                })
                              }
                              onBlur={() => blurTestExpected(t.id)}
                              className={cn(
                                CELL_INPUT,
                                "font-mono",
                                t.expectedError && ERROR_RING,
                              )}
                            />
                            {t.expectedError && (
                              <p className="mt-0.5 text-[10px] text-danger">
                                {t.expectedError}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <select
                              value={t.normalize}
                              onChange={(e) =>
                                updateTest(t.id, {
                                  normalize: e.target.value as Normalize,
                                })
                              }
                              className={CELL_INPUT}
                            >
                              <option value="none">none</option>
                              <option value="sortInner">sortInner</option>
                              <option value="sortOuter">sortOuter</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <button
                              type="button"
                              aria-label={`Remove ${t.name || "test"}`}
                              onClick={() => removeTest(t.id)}
                              className="tap-target rounded-[6px] p-1.5 text-faint hover:bg-surface-3 hover:text-danger"
                            >
                              <Trash2 size={13} strokeWidth={1.5} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-[10px] hairline">
                <button
                  type="button"
                  onClick={() => setRefSolutionOpen((o) => !o)}
                  className="tap-target flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-2"
                >
                  {refSolutionOpen ? (
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
                  <span className="text-small font-medium text-ink">
                    Reference solution
                  </span>
                  <span className="text-[11px] text-faint">
                    used only to check tests
                  </span>
                </button>
                {refSolutionOpen && (
                  <div className="border-t border-line p-3">
                    <textarea
                      value={referenceSolution}
                      onChange={(e) =>
                        edit(setReferenceSolution)(e.target.value)
                      }
                      rows={10}
                      spellCheck={false}
                      className={TEXTAREA_MONO}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-visible border-t border-line p-4 md:w-[300px] md:overflow-y-auto md:border-t-0 md:border-l">
              <div className="flex items-center justify-between">
                <h3 className="text-label font-medium uppercase tracking-[0.02em] text-muted">
                  Validation
                </h3>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={importValidating}
                  loadingLabel="Checking…"
                  disabled={hasJsonErrors}
                  onClick={() => void handleRevalidate()}
                >
                  Re-validate
                </Button>
              </div>

              {hasJsonErrors && (
                <p className="text-small text-danger">
                  Fix invalid JSON in the tests before validating.
                </p>
              )}

              {!validation ? (
                <p className="text-small text-muted">
                  Not yet validated — edits clear the last check.
                </p>
              ) : (
                <>
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-[10px] px-3 py-2",
                      validation.ok ? "bg-success/10" : "bg-danger/10",
                    )}
                  >
                    {validation.ok ? (
                      <CheckCircle2
                        size={16}
                        strokeWidth={1.5}
                        className="shrink-0 text-success"
                      />
                    ) : (
                      <XCircle
                        size={16}
                        strokeWidth={1.5}
                        className="shrink-0 text-danger"
                      />
                    )}
                    <span
                      className={cn(
                        "text-small font-medium",
                        validation.ok ? "text-success" : "text-danger",
                      )}
                    >
                      {validation.ok
                        ? "Ready to save"
                        : "Needs fixes before saving"}
                    </span>
                  </div>

                  {validation.errors.length > 0 && (
                    <ul className="flex flex-col gap-1.5">
                      {validation.errors.map((e, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-1.5 text-small text-danger"
                        >
                          <AlertCircle
                            size={12}
                            strokeWidth={1.5}
                            className="mt-0.5 shrink-0"
                          />
                          <span className="font-mono text-[11px]">{e}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex flex-col gap-0.5">
                    {validation.tests.map((t, i) => (
                      <div
                        key={`${t.name}-${i}`}
                        className="flex items-start gap-2 rounded-[8px] px-1.5 py-1"
                      >
                        {t.passed ? (
                          <CheckCircle2
                            size={13}
                            strokeWidth={1.5}
                            className="mt-0.5 shrink-0 text-success"
                          />
                        ) : (
                          <XCircle
                            size={13}
                            strokeWidth={1.5}
                            className="mt-0.5 shrink-0 text-danger"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[11px] text-body">
                            {t.name}
                          </p>
                          {t.detail && (
                            <p className="font-mono text-[10px] text-faint">
                              {t.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 flex items-center justify-between border-t border-line bg-surface-1/95 px-5 py-3 md:static md:bg-transparent">
            <p className="text-[11px] text-faint">
              {tests.length} {tests.length === 1 ? "test" : "tests"}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={importSaving}
                loadingLabel="Saving…"
                disabled={saveDisabled}
                onClick={() => void handleSave()}
              >
                {importIntent === "practice" ? "Save & practice" : "Save problem"}
              </Button>
            </div>
          </div>
        </>
      )}
    </Overlay>
  );
}
