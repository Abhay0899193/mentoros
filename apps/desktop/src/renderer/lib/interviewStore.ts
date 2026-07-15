import { create } from "zustand";
import {
  coreClient,
  type ChatPhase,
  type DraftValidation,
  type EvalResult,
  type InterviewLanguage,
  type InterviewProblem,
  type InterviewProblemDraft,
  type InterviewProblemMeta,
  type InterviewScorecard,
  type InterviewSession,
  type InterviewSessionSummary,
  type InterviewTurn,
  type InterviewType,
} from "./coreClient";
import { toast } from "../ui";
import { slugFromLeetCodeUrl } from "./leetcode";
import { useShell } from "./store";
import { useLearning } from "./learningStore";
import type { LearningTask } from "./coreClient";

type View = "launcher" | "session";

/**
 * The learning task a practice session was launched from ("Solve" on a
 * LeetCode task row, plan §F). Lets the session offer "Mark task done (+XP)"
 * once the hidden tests pass. Renderer-only linkage — lost on resume from the
 * launcher history (acceptable: the task row itself still toggles).
 */
export interface PracticeTaskLink {
  taskId: string;
  taskTitle: string;
  xpWorth: number;
  done: boolean;
}

/** Prefill for the import overlay when it opens as part of the Solve flow. */
export interface ImportPrefill {
  sourceText: string;
  slug: string;
}

interface InterviewState {
  view: View;

  pickerOpen: boolean;
  pickerLanguage: InterviewLanguage;

  problems: InterviewProblemMeta[];
  problemsLoading: boolean;
  problemsError: string | null;

  /* problem importer (paste → draft → review → save), plan.md problem bank */
  importOpen: boolean;
  importGenerating: boolean;
  importGenerateError: string | null;
  importValidating: boolean;
  importSaving: boolean;
  /** Set right after a successful save so the picker can select the new row. */
  lastImportedProblemId: string | null;
  /** Pre-filled statement (LC fetch or paste-fallback) for the Solve flow. */
  importPrefill: ImportPrefill | null;
  /** 'practice' = saving the draft immediately starts a practice session. */
  importIntent: "bank" | "practice";

  /* practice mode (plan §F): solve LeetCode in-app, no interviewer/LLM */
  /** Learning task the current practice session was launched from, if any. */
  practiceLink: PracticeTaskLink | null;
  /** True while the Solve flow resolves slug → problem / LC fetch. */
  solvePreparing: boolean;

  sessions: InterviewSessionSummary[];
  sessionsLoading: boolean;
  sessionsLoaded: boolean;
  sessionsError: string | null;

  sessionId: string | null;
  session: InterviewSession | null;
  problem: InterviewProblem | null;
  turns: InterviewTurn[];
  code: string;
  evalResult: EvalResult | null;
  evalLoading: boolean;
  scorecard: InterviewScorecard | null;
  scorecardLoading: boolean;
  scorecardDismissed: boolean;
  sessionLoading: boolean;
  sessionError: string | null;

  streamingTurnId: string | null;
  turnPhase: ChatPhase | null;
  turnError: string | null;

  init: () => void;
  openLauncher: () => void;
  openPicker: (type?: InterviewType) => void;
  closePicker: () => void;
  setPickerLanguage: (l: InterviewLanguage) => void;
  loadProblems: (type: InterviewType) => Promise<void>;
  loadSessions: () => Promise<void>;

  openImport: (prefill?: ImportPrefill, intent?: "bank" | "practice") => void;
  closeImport: () => void;
  clearImportGenerateError: () => void;
  generateDraft: (
    sourceText: string,
  ) => Promise<{
    draft: InterviewProblemDraft;
    validation: DraftValidation;
  } | null>;
  validateDraft: (
    draft: InterviewProblemDraft,
  ) => Promise<DraftValidation | null>;
  saveDraft: (draft: InterviewProblemDraft) => Promise<boolean>;
  deleteProblem: (id: string) => Promise<void>;
  clearLastImportedProblemId: () => void;
  start: (
    type: InterviewType,
    problemId: string | undefined,
    language: InterviewLanguage,
  ) => Promise<void>;
  /** LLM-free practice session (plan §F): starts directly in coding. */
  startPractice: (problemId: string, language: InterviewLanguage) => Promise<void>;
  /**
   * "Solve" on a LeetCode learning task: resolve the URL's titleSlug against
   * the bank/custom problems → practice session; unknown slug → LC GraphQL
   * fetch → import overlay prefilled (paste fallback on fetch failure).
   */
  solveTask: (task: LearningTask) => Promise<void>;
  /** Mark the linked learning task done after passing tests (+XP juice). */
  markLinkedTaskDone: () => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
  send: (content: string) => Promise<void>;
  requestHint: () => Promise<void>;
  setCode: (code: string) => void;
  runTests: () => Promise<void>;
  finish: () => Promise<void>;
  endInterview: () => Promise<void>;
  dismissScorecard: () => void;
  reopenScorecard: () => void;
  abandon: () => Promise<void>;
  backToLauncher: () => void;
}

let initialized = false;
const SERVICE_ERROR = "The interview service did not respond.";

/**
 * Turn ids whose terminal interview.status (done/error/stopped) already
 * arrived over the WS. The status event can beat the HTTP response of the
 * action that created the turn — without this guard the action would then
 * overwrite the terminal state with "thinking" and strand the UI (hint button
 * stayed disabled forever when Ollama was down).
 */
const terminalTurns = new Set<string>();

function upsertTurn(
  turns: InterviewTurn[],
  id: string,
  patch: Partial<InterviewTurn> & { content?: string },
  append: boolean,
): InterviewTurn[] {
  const idx = turns.findIndex((t) => t.id === id);
  if (idx === -1) {
    return [
      ...turns,
      {
        id,
        sessionId: patch.sessionId ?? "",
        role: "interviewer",
        kind: "chat",
        content: patch.content ?? "",
        createdAt: new Date().toISOString(),
        ...patch,
      } as InterviewTurn,
    ];
  }
  const next = [...turns];
  const prev = next[idx];
  next[idx] = {
    ...prev,
    ...patch,
    content: append
      ? prev.content + (patch.content ?? "")
      : (patch.content ?? prev.content),
  };
  return next;
}

export const useInterview = create<InterviewState>((set, get) => ({
  view: "launcher",

  pickerOpen: false,
  pickerLanguage: "python",

  problems: [],
  problemsLoading: false,
  problemsError: null,

  importOpen: false,
  importGenerating: false,
  importGenerateError: null,
  importValidating: false,
  importSaving: false,
  lastImportedProblemId: null,
  importPrefill: null,
  importIntent: "bank",

  practiceLink: null,
  solvePreparing: false,

  sessions: [],
  sessionsLoading: false,
  sessionsLoaded: false,
  sessionsError: null,

  sessionId: null,
  session: null,
  problem: null,
  turns: [],
  code: "",
  evalResult: null,
  evalLoading: false,
  scorecard: null,
  scorecardLoading: false,
  scorecardDismissed: false,
  sessionLoading: false,
  sessionError: null,

  streamingTurnId: null,
  turnPhase: null,
  turnError: null,

  init: () => {
    if (initialized) return;
    initialized = true;

    coreClient.on("interview.token", ({ sessionId, turnId, token }) => {
      const s = get();
      if (s.sessionId !== sessionId) return;
      set({
        turns: upsertTurn(s.turns, turnId, { sessionId, content: token }, true),
      });
    });

    coreClient.on("interview.status", ({ sessionId, turnId, phase, error }) => {
      const s = get();
      if (s.sessionId !== sessionId) return;
      const finished =
        phase === "done" || phase === "error" || phase === "stopped";
      if (finished) terminalTurns.add(turnId);
      set({
        turnPhase: phase,
        streamingTurnId: finished ? null : turnId,
        turnError:
          phase === "error"
            ? (error ?? "The interviewer lost connection.")
            : null,
      });
    });

    coreClient.on("interview.phase", ({ sessionId, phase }) => {
      const s = get();
      if (s.sessionId !== sessionId || !s.session) return;
      set({ session: { ...s.session, phase } });
    });

    coreClient.on("interview.scorecard", ({ sessionId, scorecard }) => {
      const s = get();
      if (s.sessionId !== sessionId) return;
      set({
        scorecard,
        scorecardLoading: false,
        scorecardDismissed: false,
        session: s.session ? { ...s.session, phase: "scorecard" } : s.session,
      });
    });

    void get().loadSessions();
  },

  openLauncher: () => set({ view: "launcher", pickerOpen: false }),

  openPicker: () => {
    set({ pickerOpen: true });
    void get().loadProblems("coding");
  },
  closePicker: () => set({ pickerOpen: false }),
  setPickerLanguage: (l) => set({ pickerLanguage: l }),

  loadProblems: async (type) => {
    set({ problemsLoading: true, problemsError: null });
    try {
      const problems = await coreClient.listInterviewProblems(type);
      set({ problems, problemsLoading: false });
    } catch {
      set({
        problems: [],
        problemsLoading: false,
        problemsError: SERVICE_ERROR,
      });
    }
  },

  loadSessions: async () => {
    set({ sessionsLoading: !get().sessionsLoaded, sessionsError: null });
    try {
      const sessions = await coreClient.listInterviewSessions();
      set({ sessions, sessionsLoading: false, sessionsLoaded: true });
    } catch {
      set({
        sessionsLoading: false,
        sessionsLoaded: true,
        sessionsError: SERVICE_ERROR,
      });
    }
  },

  openImport: (prefill, intent) =>
    set({
      importOpen: true,
      importGenerateError: null,
      importPrefill: prefill ?? null,
      importIntent: intent ?? "bank",
    }),
  closeImport: () =>
    set({ importOpen: false, importPrefill: null, importIntent: "bank" }),
  clearImportGenerateError: () => set({ importGenerateError: null }),

  generateDraft: async (sourceText) => {
    set({ importGenerating: true, importGenerateError: null });
    try {
      const result = await coreClient.generateInterviewDraft(sourceText);
      set({ importGenerating: false });
      return result;
    } catch (err) {
      set({
        importGenerating: false,
        importGenerateError: err instanceof Error ? err.message : SERVICE_ERROR,
      });
      return null;
    }
  },

  validateDraft: async (draft) => {
    set({ importValidating: true });
    try {
      const validation = await coreClient.validateInterviewDraft(draft);
      set({ importValidating: false });
      return validation;
    } catch {
      set({ importValidating: false });
      toast({
        tone: "danger",
        title: "Could not re-validate this draft",
        description: SERVICE_ERROR,
        action: {
          label: "Retry",
          onClick: () => void get().validateDraft(draft),
        },
      });
      return null;
    }
  },

  saveDraft: async (draft) => {
    set({ importSaving: true });
    const intent = get().importIntent;
    try {
      const meta = await coreClient.saveInterviewProblem(draft);
      set({
        importSaving: false,
        importOpen: false,
        lastImportedProblemId: meta.id,
        importPrefill: null,
        importIntent: "bank",
      });
      toast({
        tone: "success",
        title: "Problem added to the bank",
        description: meta.title,
      });
      void get().loadProblems("coding");
      // Solve flow: the import was only a means to practice — go straight in.
      if (intent === "practice") {
        void get().startPractice(meta.id, get().pickerLanguage);
      }
      return true;
    } catch {
      set({ importSaving: false });
      toast({
        tone: "danger",
        title: "Could not save this problem",
        description: SERVICE_ERROR,
        action: { label: "Retry", onClick: () => void get().saveDraft(draft) },
      });
      return false;
    }
  },

  deleteProblem: async (id) => {
    const prevProblems = get().problems;
    set({ problems: prevProblems.filter((p) => p.id !== id) });
    try {
      await coreClient.deleteInterviewProblem(id);
    } catch {
      set({ problems: prevProblems });
      toast({
        tone: "danger",
        title: "Could not delete this problem",
        description: SERVICE_ERROR,
        action: { label: "Retry", onClick: () => void get().deleteProblem(id) },
      });
    }
  },

  clearLastImportedProblemId: () => set({ lastImportedProblemId: null }),

  start: async (type, problemId, language) => {
    set({
      sessionLoading: true,
      sessionError: null,
      pickerOpen: false,
      turns: [],
      evalResult: null,
      scorecard: null,
      scorecardDismissed: false,
      turnError: null,
    });
    try {
      const { session, problem } = await coreClient.startInterview({
        type,
        problemId,
        language,
      });
      set({
        view: "session",
        sessionId: session.id,
        session,
        problem,
        code: problem.starterCode[language] ?? "",
        sessionLoading: false,
        turnPhase: "thinking",
      });
    } catch {
      set({ sessionLoading: false, sessionError: SERVICE_ERROR });
    }
  },

  startPractice: async (problemId, language) => {
    set({
      sessionLoading: true,
      sessionError: null,
      pickerOpen: false,
      view: "session",
      turns: [],
      evalResult: null,
      scorecard: null,
      scorecardDismissed: false,
      turnError: null,
      solvePreparing: false,
    });
    try {
      const { session, problem } = await coreClient.startInterview({
        type: "coding",
        problemId,
        language,
        mode: "practice",
      });
      set({
        sessionId: session.id,
        session,
        problem,
        code: problem.starterCode[language] ?? "",
        sessionLoading: false,
        turnPhase: null, // nothing streams — there is no interviewer
      });
    } catch {
      set({ sessionLoading: false, sessionError: SERVICE_ERROR });
    }
  },

  solveTask: async (task) => {
    const slug = slugFromLeetCodeUrl(task.url);
    if (!slug) return; // Solve is only rendered for parseable LC urls
    const language = get().pickerLanguage;
    set({
      practiceLink: {
        taskId: task.id,
        taskTitle: task.title,
        xpWorth: task.xpWorth,
        done: task.done,
      },
      solvePreparing: true,
      sessionError: null,
      // The import overlay is mounted under the launcher — make sure a stale
      // 'session' view can't hide it if the slug needs the import path.
      view: "launcher",
    });
    useShell.getState().setActive("interview");
    try {
      const problem = await coreClient.interviewProblemBySlug(slug);
      if (problem) {
        await get().startPractice(problem.id, language);
        return;
      }
      // Unknown slug: fetch the statement from LeetCode and hand it to the
      // importer (LLM drafts starters/tests — flagged in the overlay copy).
      let prefill: ImportPrefill = { sourceText: "", slug };
      try {
        const lc = await coreClient.fetchLeetCodeProblem(slug);
        prefill = {
          slug,
          sourceText: [
            `# ${lc.title} (LeetCode, ${lc.difficulty})`,
            "",
            lc.statementMarkdown,
            lc.exampleTestcases.trim()
              ? `\nExample test cases (raw):\n${lc.exampleTestcases.trim()}`
              : "",
            lc.pythonStarter ? `\nPython starter:\n${lc.pythonStarter}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      } catch {
        toast({
          tone: "warning",
          title: "Couldn't fetch from LeetCode",
          description: "Paste the problem statement instead — same flow.",
        });
      }
      set({ solvePreparing: false });
      get().openImport(prefill, "practice");
    } catch {
      set({ solvePreparing: false });
      toast({
        tone: "danger",
        title: "Couldn't start the practice session",
        description: SERVICE_ERROR,
      });
    }
  },

  markLinkedTaskDone: async () => {
    const link = get().practiceLink;
    if (!link || link.done) return;
    set({ practiceLink: { ...link, done: true } });
    try {
      // learningStore owns the XP juice (server-derived delta toast / level-up).
      await useLearning.getState().completeTask(link.taskId, true);
    } catch {
      set({ practiceLink: { ...link, done: false } });
      toast({
        tone: "danger",
        title: "Couldn't mark the task done",
        description: SERVICE_ERROR,
        action: { label: "Retry", onClick: () => void get().markLinkedTaskDone() },
      });
    }
  },

  resume: async (sessionId) => {
    set({
      view: "session",
      sessionId,
      sessionLoading: true,
      sessionError: null,
      turns: [],
      evalResult: null,
      scorecard: null,
      scorecardDismissed: false,
      turnError: null,
    });
    try {
      const data = await coreClient.getInterviewSession(sessionId);
      const lastAttempt = data.attempts[data.attempts.length - 1] ?? null;
      set({
        session: data.session,
        problem: data.problem,
        turns: data.turns,
        code:
          data.session.code ??
          data.problem.starterCode[data.session.language] ??
          "",
        evalResult: lastAttempt,
        scorecard: data.scorecard ?? null,
        sessionLoading: false,
      });
    } catch {
      set({ sessionLoading: false, sessionError: SERVICE_ERROR });
    }
  },

  send: async (content) => {
    const { sessionId } = get();
    if (!sessionId) return;
    set({ turnError: null });
    try {
      const { turnId, replyTurnId } = await coreClient.interviewSend(
        sessionId,
        content,
      );
      const now = new Date().toISOString();
      // Functional set + missing-id checks: token/status events for the reply
      // may already have landed before this response resolved.
      set((s) => {
        const turns = [...s.turns];
        if (!turns.some((t) => t.id === turnId)) {
          const replyIdx = turns.findIndex((t) => t.id === replyTurnId);
          turns.splice(replyIdx === -1 ? turns.length : replyIdx, 0, {
            id: turnId,
            sessionId,
            role: "candidate",
            kind: "chat",
            content,
            createdAt: now,
          });
        }
        if (!turns.some((t) => t.id === replyTurnId)) {
          turns.push({
            id: replyTurnId,
            sessionId,
            role: "interviewer",
            kind: "chat",
            content: "",
            createdAt: now,
          });
        }
        return {
          turns,
          ...(terminalTurns.has(replyTurnId)
            ? {}
            : { streamingTurnId: replyTurnId, turnPhase: "thinking" as const }),
        };
      });
    } catch {
      set({ turnError: SERVICE_ERROR });
    }
  },

  requestHint: async () => {
    const { sessionId, session } = get();
    if (!sessionId || !session || session.hintsUsed >= 3) return;
    set({ turnError: null });
    try {
      const { level, replyTurnId } = await coreClient.requestHint(sessionId);
      const now = new Date().toISOString();
      set((s) => ({
        turns: s.turns.some((t) => t.id === replyTurnId)
          ? s.turns
          : [
              ...s.turns,
              {
                id: replyTurnId,
                sessionId,
                role: "interviewer",
                kind: "hint",
                hintLevel: level,
                content: "",
                createdAt: now,
              },
            ],
        session: s.session
          ? { ...s.session, hintsUsed: s.session.hintsUsed + 1 }
          : s.session,
        ...(terminalTurns.has(replyTurnId)
          ? {}
          : { streamingTurnId: replyTurnId, turnPhase: "thinking" as const }),
      }));
    } catch {
      set({ turnError: SERVICE_ERROR });
    }
  },

  setCode: (code) => set({ code }),

  runTests: async () => {
    const { sessionId, code } = get();
    if (!sessionId) return;
    set({ evalLoading: true });
    try {
      const evalResult = await coreClient.runInterviewTests(sessionId, code);
      set({ evalResult, evalLoading: false });
    } catch {
      set({
        evalLoading: false,
        evalResult: {
          attemptId: "error",
          passed: 0,
          total: 0,
          results: [],
          compileError: SERVICE_ERROR,
          durationMs: 0,
          ranAt: new Date().toISOString(),
        },
      });
    }
  },

  finish: async () => {
    const { sessionId, code, session } = get();
    if (!sessionId || !session) return;
    if (session.mode === "practice") {
      // Practice: finish is terminal — no interrogation, no interviewer turn.
      // The deterministic scorecard arrives via the interview.scorecard event.
      set({ scorecardLoading: true, turnError: null });
      try {
        await coreClient.finishCoding(sessionId, code);
        set((s) => ({
          session: s.session ? { ...s.session, phase: "scorecard" } : s.session,
        }));
      } catch {
        set({ scorecardLoading: false, turnError: SERVICE_ERROR });
      }
      return;
    }
    try {
      const { replyTurnId } = await coreClient.finishCoding(sessionId, code);
      const now = new Date().toISOString();
      set((s) => ({
        session: s.session
          ? { ...s.session, phase: "interrogation" }
          : s.session,
        turns: s.turns.some((t) => t.id === replyTurnId)
          ? s.turns
          : [
              ...s.turns,
              {
                id: replyTurnId,
                sessionId,
                role: "interviewer",
                kind: "chat",
                content: "",
                createdAt: now,
              },
            ],
        ...(terminalTurns.has(replyTurnId)
          ? {}
          : { streamingTurnId: replyTurnId, turnPhase: "thinking" as const }),
      }));
    } catch {
      set({ turnError: SERVICE_ERROR });
    }
  },

  endInterview: async () => {
    const { sessionId } = get();
    if (!sessionId) return;
    set({ scorecardLoading: true, turnError: null });
    try {
      await coreClient.endInterview(sessionId);
    } catch {
      set({
        scorecardLoading: false,
        turnError:
          "Could not reach the interview service to grade this session.",
      });
    }
  },

  dismissScorecard: () => set({ scorecardDismissed: true }),
  reopenScorecard: () => set({ scorecardDismissed: false }),

  abandon: async () => {
    const { sessionId, session } = get();
    if (!sessionId || !session) return;
    try {
      await coreClient.abandonInterview(sessionId);
    } catch {
      /* best-effort — still leave locally */
    }
    set({ session: { ...session, phase: "abandoned" } });
    get().backToLauncher();
  },

  backToLauncher: () => {
    set({
      view: "launcher",
      sessionId: null,
      session: null,
      problem: null,
      turns: [],
      code: "",
      evalResult: null,
      scorecard: null,
      scorecardDismissed: false,
      streamingTurnId: null,
      turnPhase: null,
      turnError: null,
      practiceLink: null,
      solvePreparing: false,
    });
    void get().loadSessions();
  },
}));
