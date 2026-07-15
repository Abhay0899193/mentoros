import { useReducedMotion } from "motion/react";
import { useInterview } from "../../../lib/interviewStore";
import { FallbackOrb } from "../../../orb/FallbackOrb";
import { InterviewLauncher } from "./InterviewLauncher";
import { InterviewSession } from "./InterviewSession";

/** Interview Platform root (plan.md §4.5) — switches launcher ⇄ session. */
export function InterviewScreen() {
  const view = useInterview((s) => s.view);
  const solvePreparing = useInterview((s) => s.solvePreparing);
  const reduce = useReducedMotion();
  // Solve flow (plan §F): resolving the task's slug / fetching from LeetCode
  // can take a few seconds — show intent instead of an inert launcher.
  if (solvePreparing && view !== "session") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <FallbackOrb state="thinking" size={56} frozen={!!reduce} />
        <p className="text-small text-muted">Looking up this problem…</p>
      </div>
    );
  }
  return view === "session" ? <InterviewSession /> : <InterviewLauncher />;
}
