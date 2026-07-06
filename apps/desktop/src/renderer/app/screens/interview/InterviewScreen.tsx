import { useInterview } from "../../../lib/interviewStore";
import { InterviewLauncher } from "./InterviewLauncher";
import { InterviewSession } from "./InterviewSession";

/** Interview Platform root (plan.md §4.5) — switches launcher ⇄ session. */
export function InterviewScreen() {
  const view = useInterview((s) => s.view);
  return view === "session" ? <InterviewSession /> : <InterviewLauncher />;
}
