import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parsePlan, type ParsedPlan } from "./plan.js";
import type { LearningStore, WeekDocRow } from "./store.js";

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
export const CANDIDATES = [
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

/**
 * Ingest one skill-reference doc into the knowledge base; returns the KB
 * sourceId. Injected by the server so the learning importer stays decoupled
 * from the KB engine.
 */
export type SkillDocIngest = (
  absPath: string,
  title: string,
  tags: string[],
) => Promise<string>;

/**
 * Parse the SKILLS-TRACK frontmatter we care about: `title: "Docker"` and
 * `weeks: [1, 2]`. Tolerant of quotes/spacing; returns null when the file has
 * no frontmatter block or no weeks list (doc still ingests, just unlinked).
 */
export function parseSkillDocMeta(
  body: string,
): { title: string | null; weeks: number[] } | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!fm) return null;
  const block = fm[1];
  const titleMatch = /^title:\s*["']?(.+?)["']?\s*$/m.exec(block);
  const weeksMatch = /^weeks:\s*\[([^\]]*)\]\s*$/m.exec(block);
  const weeks = (weeksMatch?.[1] ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  return { title: titleMatch?.[1]?.trim() ?? null, weeks };
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
  ingestSkillDoc?: SkillDocIngest;
}): Promise<ImportResult> {
  const { path, store, onProgress, ingestSkillDoc } = opts;
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

  // Full study notes: the day markdown bodies the JSON exports don't carry.
  // Best-effort — a missing file just leaves that day without notes.
  let notes = 0;
  for (const day of plan.days) {
    const rel = join(
      `PHASE-${day.phase}`,
      `week-${String(day.week).padStart(2, "0")}`,
      `day-${String(day.day).padStart(2, "0")}.md`,
    );
    try {
      const body = await readFile(join(path, rel), "utf8");
      if (body.trim()) {
        store.setDayNotes(day.id, body);
        notes += 1;
      }
    } catch {
      /* no markdown for this day */
    }
  }
  onProgress({ step: `day notes: ${notes}`, created, merged, done: false });

  // Reference docs → knowledge base + week links. SKILLS-TRACK carries the
  // 3mc quick-review skill sheets; STUDY-GUIDES carries the deep week/topic
  // study guides. Best-effort: a missing dir or a failed ingest never fails
  // the plan import.
  if (ingestSkillDoc) {
    const docDirs: { dir: string; tag: string }[] = [
      { dir: "SKILLS-TRACK", tag: "quick-review" },
      { dir: "STUDY-GUIDES", tag: "study-guide" },
    ];
    const weekDocs: WeekDocRow[] = [];
    let ingested = 0;
    for (const { dir, tag } of docDirs) {
      let files: string[] = [];
      try {
        files = (await readdir(join(path, dir)))
          .filter((f) => f.endsWith(".md"))
          .sort();
      } catch {
        continue; /* dir absent in this source tree */
      }
      for (const file of files) {
        const abs = join(path, dir, file);
        try {
          const body = await readFile(abs, "utf8");
          const meta = parseSkillDocMeta(body);
          const title = meta?.title ?? file.replace(/\.md$/, "");
          onProgress({
            step: `skill doc: ${title}`,
            created,
            merged,
            done: false,
          });
          const sourceId = await ingestSkillDoc(abs, title, ["3mc", tag]);
          ingested += 1;
          for (const week of meta?.weeks ?? []) {
            weekDocs.push({ week, sourceId, title });
          }
        } catch (err) {
          onProgress({
            step: `skill doc failed: ${file}`,
            created,
            merged,
            done: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    if (ingested > 0) store.replaceWeekDocs(weekDocs);
    onProgress({ step: `skill docs: ${ingested}`, created, merged, done: false });
  }

  onProgress({ step: "done", created, merged, done: true });
  return { created, merged };
}
