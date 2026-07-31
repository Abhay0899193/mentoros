/**
 * Reader export — builds the static content bundle that `apps/desktop/src/reader`
 * ships to Vercel (docs/READER.md).
 *
 * Everything readable lives as markdown in the 3mc tree, so this walks that tree
 * directly and reuses the app's own frontmatter/tag/plan parsers — the Reader
 * must group and label docs EXACTLY like the Knowledge screen does, and the only
 * way to guarantee that is to share the code.
 *
 * Completion state lives in the desktop app's SQLite (whose native module is
 * Electron-ABI-bound and won't load here), so progress comes from the running
 * core's HTTP API instead. The core being down is NOT an error: the bundle just
 * ships without ticks.
 *
 *   node --import tsx tools/reader-export.ts
 */
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
  buildDocTags,
  parseSkillDocMeta,
} from "../apps/desktop/src/core/learning/importer.js";
import { parsePlan, type ParsedDay, type ParsedTask } from "../apps/desktop/src/core/learning/plan.js";

const ROOT = process.env.READER_3MC ?? "/Users/singha7/Documents/abhay/3-month-challenge";
const CORE = process.env.READER_CORE ?? "http://127.0.0.1:4820";
const OUT = new URL("../apps/desktop/src/reader/public/content.json", import.meta.url).pathname;

/** Plan files in the same preference order the desktop importer uses. */
const PLAN_CANDIDATES = ["study-ui/data/parsed-plan.json", "study-ui/public/study-plan.json"];

export interface ReaderDoc {
  /** Stable id = path relative to the 3mc root, minus `.md`. */
  id: string;
  title: string;
  /** KB-compatible tags (`3mc`, `study-guide`, `week:4`, `topic:dsa/graphs`, `part:2`). */
  tags: string[];
  markdown: string;
  /** Reading estimate in minutes, floored at 1. */
  minutes: number;
  /** ISO when marked read in the desktop app; null = unread or app not running. */
  readAt: string | null;
}

export interface ReaderBundle {
  generatedAt: string;
  docs: ReaderDoc[];
  /** Plan skeleton — days and tasks, straight from the 3mc parser. */
  plan: { days: ParsedDay[]; tasks: ParsedTask[] };
  /** Per-day progress from the running app; null when it wasn't reachable. */
  weeks: WeekProgress[] | null;
}

interface WeekProgress {
  phase: number;
  week: number;
  focus?: string;
  days: { id: string; day: number; state: string; taskCount: number; doneCount: number }[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Markdown files under `dir`, one level deep or recursive, sorted for stable output. */
async function markdownFiles(dir: string, recursive: boolean): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) out.push(...(await markdownFiles(abs, true)));
    } else if (e.name.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Drop the YAML frontmatter block. It's already parsed into title/tags, and the
 * desktop app strips it at ingest — shipping it would render as body text and
 * pollute search ("topics" would match every guide).
 */
function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
}

function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

/** First `# heading` in the body — the fallback title when frontmatter has none. */
function firstHeading(markdown: string): string | null {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : null;
}

async function collectDocs(): Promise<ReaderDoc[]> {
  const docs: ReaderDoc[] = [];

  const push = (abs: string, raw: string, title: string, tags: string[]): void => {
    const markdown = stripFrontmatter(raw);
    docs.push({
      id: relative(ROOT, abs).replace(/\.md$/, ""),
      title,
      tags,
      markdown,
      minutes: readingMinutes(markdown),
      readAt: null,
    });
  };

  // Study guides — week-NN/ parts plus in-app generated custom/ supplements.
  for (const abs of await markdownFiles(join(ROOT, "STUDY-GUIDES"), true)) {
    const name = basename(abs);
    if (name === "RULES.md") continue; // authoring rules, not study content
    const markdown = await readFile(abs, "utf8");
    const meta = parseSkillDocMeta(markdown);
    const generated = abs.includes("/STUDY-GUIDES/custom/");
    push(
      abs,
      markdown,
      meta?.title ?? firstHeading(markdown) ?? name.replace(/\.md$/, ""),
      buildDocTags("study-guide", name, meta, generated),
    );
  }

  // Quick-review skill sheets.
  for (const abs of await markdownFiles(join(ROOT, "SKILLS-TRACK"), false)) {
    const markdown = await readFile(abs, "utf8");
    const meta = parseSkillDocMeta(markdown);
    const name = basename(abs);
    push(
      abs,
      markdown,
      meta?.title ?? firstHeading(markdown) ?? name.replace(/\.md$/, ""),
      buildDocTags("quick-review", name, meta),
    );
  }

  // Day study notes: PHASE-p/week-ww/day-dd.md. Tagged with the plan day id so
  // the Reader's plan view can open the right note without a second lookup.
  for (const phase of [1, 2, 3]) {
    for (const abs of await markdownFiles(join(ROOT, `PHASE-${phase}`), true)) {
      const m = /week-(\d+)\/day-(\d+)\.md$/.exec(abs);
      if (!m) continue;
      const week = Number(m[1]);
      const day = Number(m[2]);
      const markdown = await readFile(abs, "utf8");
      push(abs, markdown, firstHeading(markdown) ?? `Week ${week} · Day ${day}`, [
        "3mc",
        "day-note",
        `week:${week}`,
        `day:phase-${phase}-week-${week}-day-${day}`,
      ]);
    }
  }

  return docs;
}

/** Richest candidate wins, exactly as the desktop importer picks it. */
async function loadPlan(): Promise<{ days: ParsedDay[]; tasks: ParsedTask[] }> {
  let best: { days: ParsedDay[]; tasks: ParsedTask[] } = { days: [], tasks: [] };
  for (const rel of PLAN_CANDIDATES) {
    const abs = join(ROOT, rel);
    if (!(await exists(abs))) continue;
    try {
      const plan = parsePlan(JSON.parse(await readFile(abs, "utf8")));
      if (plan.tasks.length > best.tasks.length) best = plan;
    } catch (err) {
      console.warn(`  plan ${rel}: ${(err as Error).message}`);
    }
  }
  return best;
}

/** GET from the running core, or null on any failure (it's optional data). */
async function fromCore<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${CORE}${path}`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!(await exists(ROOT))) {
    throw new Error(`3mc tree not found at ${ROOT} (set READER_3MC)`);
  }
  const docs = await collectDocs();
  const plan = await loadPlan();

  const weeks = await fromCore<WeekProgress[]>("/learning/weeks");
  const sources = await fromCore<{ path: string; readAt: string | null }[]>("/kb/sources");
  if (sources) {
    const readByPath = new Map(sources.map((s) => [s.path, s.readAt]));
    for (const doc of docs) {
      doc.readAt = readByPath.get(join(ROOT, `${doc.id}.md`)) ?? null;
    }
  }

  const bundle: ReaderBundle = {
    generatedAt: new Date().toISOString(),
    docs,
    plan,
    weeks,
  };
  const json = JSON.stringify(bundle);
  await mkdir(new URL(".", `file://${OUT}`).pathname, { recursive: true });
  await writeFile(OUT, json);

  const kinds = (tag: string): number => docs.filter((d) => d.tags.includes(tag)).length;
  console.log(
    `reader bundle → ${OUT}\n` +
      `  ${docs.length} docs (${kinds("study-guide")} guides, ${kinds("quick-review")} sheets, ${kinds("day-note")} day notes)\n` +
      `  ${plan.days.length} days / ${plan.tasks.length} tasks\n` +
      `  progress: ${weeks ? `${weeks.length} weeks from the running app` : "app not running — shipping without ticks"}\n` +
      `  ${(json.length / 1024 / 1024).toFixed(2)} MB uncompressed`,
  );
}

await main();
