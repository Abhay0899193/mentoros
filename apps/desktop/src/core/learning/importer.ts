import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePlan, type ParsedPlan } from "./plan.js";
import type { LearningStore } from "./store.js";

/**
 * Importer for the 3-month-challenge study plan. Read-only against the source
 * tree; upserts days/tasks by their stable ids so a re-import MERGES and never
 * resets completion (idempotency). Mirrors the interview-prep importer's
 * progress-reporting shape.
 */

// Candidate files in preference order. `parsed-plan.json` is the documented
// primary; `study-plan.json` is the fuller export (it carries all 147 days plus
// LeetCode difficulty needed for XP). We parse every candidate that exists and
// use the richest (most tasks), so difficulty-driven XP works while still
// honouring the fallback semantics.
const CANDIDATES = [
  "study-ui/data/parsed-plan.json",
  "study-ui/public/study-plan.json",
];

export interface ImportProgress {
  step: string;
  created: number;
  merged: number;
  done: boolean;
  error?: string;
}

export interface ImportResult {
  created: number;
  merged: number;
}

async function loadRichestPlan(
  root: string,
  onProgress: (p: ImportProgress) => void,
): Promise<{ plan: ParsedPlan; file: string } | null> {
  let best: { plan: ParsedPlan; file: string } | null = null;
  for (const rel of CANDIDATES) {
    let text: string;
    try {
      text = await readFile(join(root, rel), "utf8");
    } catch {
      onProgress({ step: `skipped ${rel} (missing)`, created: 0, merged: 0, done: false });
      continue;
    }
    try {
      const plan = parsePlan(JSON.parse(text));
      if (!best || plan.tasks.length > best.plan.tasks.length) {
        best = { plan, file: rel };
      }
    } catch (err) {
      onProgress({
        step: `error parsing ${rel}`,
        created: 0,
        merged: 0,
        done: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return best;
}

export async function import3mc(opts: {
  path: string;
  store: LearningStore;
  onProgress: (p: ImportProgress) => void;
}): Promise<ImportResult> {
  const { path, store, onProgress } = opts;
  const picked = await loadRichestPlan(path, onProgress);
  if (!picked) {
    onProgress({
      step: "no study plan found (parsed-plan.json / study-plan.json)",
      created: 0,
      merged: 0,
      done: true,
      error: "no plan file",
    });
    return { created: 0, merged: 0 };
  }

  const { plan, file } = picked;
  let created = 0;
  let merged = 0;

  for (const day of plan.days) {
    if (store.upsertDay(day) === "created") created += 1;
    else merged += 1;
  }
  onProgress({
    step: `${file}: ${plan.days.length} days`,
    created,
    merged,
    done: false,
  });

  for (const task of plan.tasks) {
    if (store.upsertTask(task) === "created") created += 1;
    else merged += 1;
  }
  onProgress({
    step: `${file}: ${plan.tasks.length} tasks`,
    created,
    merged,
    done: false,
  });

  onProgress({ step: "done", created, merged, done: true });
  return { created, merged };
}
