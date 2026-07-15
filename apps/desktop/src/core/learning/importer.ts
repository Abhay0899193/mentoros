import { access, readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
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
 * List/delete the KB sources tagged `3mc` so the importer can prune sources
 * whose backing file has vanished (e.g. the old week-1 monolith after a split).
 * Injected by the server; the importer stays decoupled from the KB engine.
 */
export type ListDocSources = () => Promise<{ id: string; path: string | null }[]>;
export type DeleteDocSource = (id: string) => Promise<void>;

export interface SkillDocMeta {
  title: string | null;
  weeks: number[];
  /** Topic slugs like "dsa/two-pointers" from `topics: [...]`. */
  topics: string[];
  /** Part number from `part: N`; null when absent. */
  part: number | null;
}

/**
 * Parse the study-doc frontmatter we care about: `title: "Docker"`,
 * `weeks: [1, 2]`, `topics: ["dsa/two-pointers"]` and `part: 3`. Tolerant of
 * quotes/spacing; returns null when the file has no frontmatter block (doc
 * still ingests, just unlinked/untagged). Missing fields default to
 * empty/`null`.
 */
export function parseSkillDocMeta(body: string): SkillDocMeta | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!fm) return null;
  const block = fm[1];
  const titleMatch = /^title:\s*["']?(.+?)["']?\s*$/m.exec(block);
  const weeksMatch = /^weeks:\s*\[([^\]]*)\]\s*$/m.exec(block);
  const topicsMatch = /^topics:\s*\[([^\]]*)\]\s*$/m.exec(block);
  const partMatch = /^part:\s*(\d+)\s*$/m.exec(block);
  const weeks = (weeksMatch?.[1] ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  const topics = (topicsMatch?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").trim())
    .filter((s) => s.length > 0);
  return {
    title: titleMatch?.[1]?.trim() ?? null,
    weeks,
    topics,
    part: partMatch ? Number.parseInt(partMatch[1], 10) : null,
  };
}

/** Leading digits of a filename (`00-overview…` → 0); null when none. */
function partFromFilename(name: string): number | null {
  const m = /^(\d+)/.exec(name);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Build the KB tags for one study doc based on its origin dir + frontmatter.
 * Exported so the in-app guide generator ingests with EXACTLY the tags a later
 * full re-import would derive — the upsert-by-path must not flap tag sets.
 */
export function buildDocTags(
  origin: "quick-review" | "study-guide",
  name: string,
  meta: SkillDocMeta | null,
  /** True for files under STUDY-GUIDES/custom/ — in-app generated supplements. */
  generated = false,
): string[] {
  const weekTags = (meta?.weeks ?? []).map((w) => `week:${w}`);
  if (origin === "quick-review") return ["3mc", "quick-review", ...weekTags];
  const topicTags = (meta?.topics ?? []).map((t) => `topic:${t}`);
  const part = meta?.part ?? partFromFilename(name);
  const partTags = part !== null ? [`part:${part}`] : [];
  const generatedTag = generated ? ["generated"] : [];
  return ["3mc", "study-guide", ...weekTags, ...topicTags, ...partTags, ...generatedTag];
}

/** Recursively collect `*.md` under a dir (relative, sorted). RULES.md skipped. */
async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  const rec = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return; /* dir absent */
    }
    for (const e of entries) {
      const childRel = rel ? join(rel, e.name) : e.name;
      if (e.isDirectory()) await rec(childRel);
      else if (e.isFile() && e.name.endsWith(".md") && e.name !== "RULES.md") {
        out.push(childRel);
      }
    }
  };
  await rec("");
  return out.sort();
}

/** True when `p` resolves to a location strictly inside `root`. */
function isUnderRoot(root: string, p: string): boolean {
  const rel = relative(resolve(root), resolve(p));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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
  listDocSources?: ListDocSources;
  deleteDocSource?: DeleteDocSource;
}): Promise<ImportResult> {
  const { path, store, onProgress, ingestSkillDoc, listDocSources, deleteDocSource } = opts;
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
  // 3mc quick-review skill sheets (flat); STUDY-GUIDES carries the deep
  // week/topic study guides (nested subfolders like week-01/, custom/).
  // Best-effort: a missing dir or a failed ingest never fails the plan import.
  if (ingestSkillDoc) {
    type DocEntry = {
      abs: string;
      name: string;
      origin: "quick-review" | "study-guide";
      /** True for STUDY-GUIDES/custom/** — in-app "New guide" output (Phase G). */
      generated: boolean;
    };
    const entries: DocEntry[] = [];

    // SKILLS-TRACK stays flat.
    try {
      const files = (await readdir(join(path, "SKILLS-TRACK")))
        .filter((f) => f.endsWith(".md"))
        .sort();
      for (const f of files) {
        entries.push({
          abs: join(path, "SKILLS-TRACK", f),
          name: f,
          origin: "quick-review",
          generated: false,
        });
      }
    } catch {
      /* dir absent in this source tree */
    }

    // STUDY-GUIDES recurses into subfolders (RULES.md excluded by walkMarkdown).
    // custom/ holds in-app generated supplements — tagged `generated` below so a
    // later full re-import preserves that tag (idempotent, mirrors every other tag).
    for (const rel of await walkMarkdown(join(path, "STUDY-GUIDES"))) {
      entries.push({
        abs: join(path, "STUDY-GUIDES", rel),
        name: basename(rel),
        origin: "study-guide",
        generated: rel === "custom" || rel.startsWith("custom/"),
      });
    }

    const weekDocs: WeekDocRow[] = [];
    let ingested = 0;
    for (const entry of entries) {
      try {
        const body = await readFile(entry.abs, "utf8");
        const meta = parseSkillDocMeta(body);
        const title = meta?.title ?? entry.name.replace(/\.md$/, "");
        onProgress({ step: `skill doc: ${title}`, created, merged, done: false });
        const tags = buildDocTags(entry.origin, entry.name, meta, entry.generated);
        const sourceId = await ingestSkillDoc(entry.abs, title, tags);
        ingested += 1;
        for (const week of meta?.weeks ?? []) {
          weekDocs.push({ week, sourceId, title });
        }
      } catch (err) {
        onProgress({
          step: `skill doc failed: ${entry.name}`,
          created,
          merged,
          done: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (ingested > 0) store.replaceWeekDocs(weekDocs);
    onProgress({ step: `skill docs: ${ingested}`, created, merged, done: false });

    // Prune: drop 3mc-tagged KB sources whose backing file vanished (removes the
    // old week-1 monolith after the split). Only prune sources whose stored path
    // is non-null, is under the import root, and fails an access() check.
    // Per-doc prune failures never fail the import (best-effort, like ingest).
    if (listDocSources && deleteDocSource) {
      let pruned = 0;
      let sources: { id: string; path: string | null }[] = [];
      try {
        sources = await listDocSources();
      } catch {
        sources = [];
      }
      for (const src of sources) {
        if (!src.path || !isUnderRoot(path, src.path)) continue;
        try {
          await access(src.path);
          continue; /* still on disk — keep */
        } catch {
          /* backing file gone — prune below */
        }
        try {
          await deleteDocSource(src.id);
          pruned += 1;
        } catch {
          /* best-effort: a failed delete never fails the import */
        }
      }
      onProgress({ step: `pruned: ${pruned}`, created, merged, done: false });
    }
  }

  onProgress({ step: "done", created, merged, done: true });
  return { created, merged };
}
