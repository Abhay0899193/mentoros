import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Workflow,
  Database,
  MessagesSquare,
  ArrowRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { riseIn, staggerChildren, reduced } from "../../../motion/springs";
import { cn } from "../../../lib/cn";
import { useInterview } from "../../../lib/interviewStore";
import type {
  InterviewSessionSummary,
  InterviewType,
} from "../../../lib/coreClient";
import { Button, Card, Chip } from "../../../ui";
import { ProblemPicker } from "./ProblemPicker";
import { timeAgo } from "./interviewMeta";

interface LauncherCardMeta {
  type: InterviewType;
  label: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
}

const CARDS: LauncherCardMeta[] = [
  {
    type: "coding",
    label: "Coding",
    description:
      "Problem statement + Monaco editor, hint ladder, live eval, ending scorecard.",
    icon: Code2,
    enabled: true,
  },
  {
    type: "system-design",
    label: "System Design",
    description:
      "Infinite whiteboard + interviewer — capture tradeoffs and scaling decisions.",
    icon: Workflow,
    enabled: false,
  },
  {
    type: "sql",
    label: "SQL",
    description: "Schema panel, query editor, execution-plan and result view.",
    icon: Database,
    enabled: false,
  },
  {
    type: "behavioral",
    label: "Behavioral",
    description: "Conversational voice with STAR-format hints.",
    icon: MessagesSquare,
    enabled: false,
  },
];

function LauncherCard({ meta }: { meta: LauncherCardMeta }) {
  const openPicker = useInterview((s) => s.openPicker);
  const Icon = meta.icon;

  const activate = () => {
    if (meta.enabled) openPicker(meta.type);
  };

  return (
    <Card
      interactive={meta.enabled}
      padding="feature"
      role="button"
      tabIndex={meta.enabled ? 0 : -1}
      aria-disabled={!meta.enabled}
      onClick={activate}
      onKeyDown={(e) => {
        if (meta.enabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          activate();
        }
      }}
      className={cn(
        "flex flex-col gap-4",
        meta.enabled ? "cursor-pointer" : "cursor-default",
      )}
    >
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-[14px]",
          meta.enabled
            ? "aurora-bg aurora-glow text-white"
            : "bg-surface-2 text-faint hairline",
        )}
      >
        <Icon size={26} strokeWidth={1.5} />
      </span>
      <div>
        <h3 className="text-h3 text-ink">{meta.label}</h3>
        <p className="mt-1 text-small text-muted">{meta.description}</p>
      </div>
      {meta.enabled ? (
        <span className="mt-auto flex items-center gap-1 text-small font-medium text-ink">
          Start a session <ArrowRight size={14} strokeWidth={1.5} />
        </span>
      ) : (
        <Chip className="mt-auto self-start">Next check-in</Chip>
      )}
    </Card>
  );
}

function SessionRow({ session }: { session: InterviewSessionSummary }) {
  const resume = useInterview((s) => s.resume);
  const inFlight =
    session.phase !== "scorecard" && session.phase !== "abandoned";
  return (
    <button
      onClick={() => void resume(session.id)}
      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-small font-medium text-ink">
          {session.problemTitle}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Chip>{session.pattern}</Chip>
          {inFlight && (
            <Chip tone="info">
              {session.phase === "framing"
                ? "Framing"
                : session.phase === "coding"
                  ? "Coding"
                  : "Interrogation"}
            </Chip>
          )}
        </div>
      </div>
      {typeof session.score === "number" && (
        <span className="font-mono text-h3 text-ink tabular">
          {session.score}/10
        </span>
      )}
      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-faint tabular">
        {timeAgo(session.startedAt)}
      </span>
    </button>
  );
}

function RecentSessions() {
  const {
    sessions,
    sessionsLoading,
    sessionsLoaded,
    sessionsError,
    loadSessions,
    openPicker,
  } = useInterview();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label font-medium tracking-[0.02em] text-muted uppercase">
        Recent sessions
      </h2>
      <Card padding="none" className="overflow-hidden">
        {sessionsLoading && !sessionsLoaded ? (
          <div className="flex flex-col gap-1 p-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-[10px] px-3 py-2.5"
              >
                <div className="h-8 flex-1 animate-pulse rounded-[8px] bg-surface-2" />
              </div>
            ))}
          </div>
        ) : sessionsError ? (
          <div className="flex items-center gap-3 p-4">
            <AlertCircle
              size={16}
              strokeWidth={1.5}
              className="shrink-0 text-danger"
            />
            <p className="flex-1 text-small text-muted">{sessionsError}</p>
            <Button
              size="sm"
              icon={<RefreshCw size={14} strokeWidth={1.5} />}
              onClick={() => void loadSessions()}
            >
              Retry
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <p className="text-small text-ink">No interviews yet.</p>
            <p className="max-w-xs text-small text-muted">
              Run your first coding session — it ends with a scorecard that
              updates your Memory profile.
            </p>
            <Button
              size="sm"
              className="mt-1"
              onClick={() => openPicker("coding")}
            >
              Start a coding interview
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-2">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

/** Interview Platform launcher (plan.md §4.5). */
export function InterviewLauncher() {
  const reduce = useReducedMotion();
  const init = useInterview((s) => s.init);

  useEffect(() => init(), [init]);

  return (
    <>
      <motion.div
        variants={reduced(reduce, staggerChildren)}
        initial="hidden"
        animate="visible"
        className="mx-auto flex h-full max-w-[900px] flex-col gap-8 overflow-y-auto px-4 py-8 md:px-6"
      >
        <motion.header variants={reduced(reduce, riseIn)}>
          <h1 className="text-h1 text-ink">Interview Platform</h1>
          <p className="mt-1 text-body text-muted">
            Staff-bar mock interviews, graded honestly. Every session ends with
            a scorecard that writes back to your Memory profile.
          </p>
        </motion.header>

        <motion.div
          variants={reduced(reduce, riseIn)}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {CARDS.map((c) => (
            <LauncherCard key={c.type} meta={c} />
          ))}
        </motion.div>

        <motion.div variants={reduced(reduce, riseIn)}>
          <RecentSessions />
        </motion.div>
      </motion.div>

      <ProblemPicker />
    </>
  );
}
