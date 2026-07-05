import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SaveMemoryInput, SaveMemoryResult } from "../types.js";

/**
 * Importer for the user's real interview-prep notes
 * (~/Documents/abhay/interview-prep). Read-only: parses the prescriptive
 * markdown schemas into typed memory records and routes every one through
 * saveMemory, so a re-import MERGES rather than duplicates (idempotency).
 *
 * Parsers are pure functions of file text (unit-tested); the orchestrator does
 * the I/O, the saving, and the per-file progress reporting. Unknown/missing
 * files are skipped with a step note — never a crash.
 */

const SOURCE = "import:interview-prep";

/* ------------------------------ markdown utils ----------------------------- */

interface MdTable {
  header: string[];
  rows: string[][];
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Extract every GitHub-flavoured markdown table from `text`. */
export function parseTables(text: string): MdTable[] {
  const lines = text.split(/\r?\n/);
  const tables: MdTable[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*\|/.test(lines[i])) {
      i += 1;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }
    if (block.length < 2) continue;
    const header = splitRow(block[0]);
    let start = 1;
    if (isSeparatorRow(splitRow(block[1]))) start = 2;
    const rows = block.slice(start).map(splitRow).filter((r) => !isSeparatorRow(r));
    tables.push({ header, rows });
  }
  return tables;
}

/** `[label](url)` → `label`; otherwise the trimmed text. */
export function stripLink(cell: string): string {
  const m = cell.match(/\[([^\]]+)\]\([^)]*\)/);
  return (m ? m[1] : cell).trim();
}

function stripMd(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

/* ----------------------------- recurring-mistakes -------------------------- */

interface LogEntry {
  category: string;
  rootCause: string;
}

function parseMistakeLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const blocks = text.split(/^## /m).slice(1);
  for (const block of blocks) {
    const cat = block.match(/\*\*Category:\*\*\s*(.+)/);
    const root = block.match(/\*\*Root cause:\*\*\s*(.+)/);
    if (cat) {
      entries.push({
        category: stripMd(cat[1]),
        rootCause: root ? stripMd(root[1]) : "",
      });
    }
  }
  return entries;
}

function bestMistakeBody(category: string, log: LogEntry[], fallback: string): string {
  const target = category.toLowerCase();
  for (const e of log) {
    const c = e.category.toLowerCase();
    const base = c.split(/[/(]/)[0].trim();
    if ((base === target || c.includes(target)) && e.rootCause) {
      return e.rootCause;
    }
  }
  return fallback;
}

export function parseRecurringMistakes(text: string): SaveMemoryInput[] {
  const log = parseMistakeLog(text);
  const out: SaveMemoryInput[] = [];
  for (const table of parseTables(text)) {
    const h = table.header.map((c) => c.toLowerCase());
    if (!(h.includes("category") && h.includes("count"))) continue;
    const catIdx = h.indexOf("category");
    const countIdx = h.indexOf("count");
    for (const row of table.rows) {
      const category = stripMd(row[catIdx] ?? "");
      const count = Number.parseInt(row[countIdx] ?? "", 10);
      if (!category || !Number.isFinite(count) || count <= 0) continue;
      out.push({
        type: "mistake",
        title: category,
        body: bestMistakeBody(category, log, category),
        source: SOURCE,
        tags: ["import", `count:${count}`],
        confidence: 0.9,
      });
    }
  }
  return out;
}

/* ------------------------------- review-queue ------------------------------ */

export function parseReviewQueue(text: string): SaveMemoryInput[] {
  const out: SaveMemoryInput[] = [];
  for (const table of parseTables(text)) {
    const h = table.header.map((c) => c.toLowerCase());
    if (!(h.includes("next review") && h.includes("problem"))) continue;
    const nextIdx = h.indexOf("next review");
    const probIdx = h.indexOf("problem");
    const typeIdx = h.indexOf("type");
    const gradeIdx = h.findIndex((c) => c.includes("grade"));
    const masteryIdx = h.indexOf("mastery");
    for (const row of table.rows) {
      const problem = stripLink(row[probIdx] ?? "");
      if (!problem) continue;
      const nextReview = stripMd(row[nextIdx] ?? "").trim() || "unscheduled";
      const kind = typeIdx >= 0 ? stripMd(row[typeIdx] ?? "") : "";
      const gradeRaw = gradeIdx >= 0 ? stripMd(row[gradeIdx] ?? "") : "";
      const grade = /^\d$/.test(gradeRaw) ? `${gradeRaw}/5` : gradeRaw || "new";
      const mastery =
        masteryIdx >= 0 ? stripMd(row[masteryIdx] ?? "").replace(/[^\w\s-]/g, "").trim() : "";
      const parts = [`grade ${grade}`];
      if (mastery) parts.push(`mastery ${mastery}`);
      parts.push(`next review ${nextReview}`);
      const kindNote = kind ? ` [${kind}]` : "";
      out.push({
        type: "learning",
        title: `Review: ${problem}`,
        body: `Spaced repetition${kindNote} — ${parts.join(", ")}`,
        source: SOURCE,
        tags: ["import", "review-queue"],
      });
    }
  }
  return out;
}

/* ----------------------------- patterns-learned ---------------------------- */

const PLACEHOLDER = /^(_?todo_?|—|-|)$/i;

export function parsePatternsLearned(text: string): SaveMemoryInput[] {
  const out: SaveMemoryInput[] = [];
  for (const table of parseTables(text)) {
    const h = table.header.map((c) => c.toLowerCase());
    const confIdx = h.findIndex((c) => c.includes("confidence"));
    if (confIdx < 0) continue;
    // First column is the pattern/concept name in both table shapes.
    const nameIdx = 0;
    const notesIdx = h.findIndex((c) => c === "notes");
    for (const row of table.rows) {
      const name = stripMd(row[nameIdx] ?? "");
      if (!name) continue;
      const confidence = Number.parseInt(stripMd(row[confIdx] ?? ""), 10);
      if (!Number.isFinite(confidence)) continue;

      // Free-text notes only: reject placeholders and link-only cells (the
      // SysDesign table reuses its "Notes" column for the playbook link).
      const rawNotes = notesIdx >= 0 ? (row[notesIdx] ?? "").trim() : "";
      const notes =
        PLACEHOLDER.test(rawNotes) || /^\[[^\]]*\]\([^)]*\)$/.test(rawNotes)
          ? ""
          : stripMd(rawNotes);

      // Signals that a pattern is genuinely in play (not an aspirational stub).
      const rowText = row.join(" ");
      const hasLink = /\[[^\]]+\]\([^)]+\)/.test(rowText);
      const hasDate = /\d{4}-\d{2}-\d{2}/.test(rowText);
      // Skip un-started placeholders: low confidence, no notes/link/reinforcement.
      if (confidence <= 1 && !notes && !hasLink && !hasDate) continue;

      const bodyNotes = notes ? ` — ${notes}` : "";
      out.push({
        type: "skill",
        title: `${name} pattern`,
        body: `${name}: confidence ${confidence}/5${bodyNotes}`,
        source: SOURCE,
        tags: ["import", "pattern", confidence >= 4 ? "strength" : "weakness"],
        confidence: Math.max(0.1, Math.min(0.99, confidence / 5)),
      });
    }
  }
  return out;
}

/* ----------------------------- progress-tracker ---------------------------- */

export function parseProgressTracker(text: string): SaveMemoryInput[] {
  const solved = text.match(/Total problems solved:\*{0,2}\s*(.+)/i);
  if (!solved) return [];
  const solvedText = stripMd(solved[1]).trim();
  const streak = text.match(/Current streak \(days\):\*{0,2}\s*(\d+)/i);
  const mocks = text.match(/Mock interviews done:\*{0,2}\s*(\d+)/i);
  const parts = [`Solved ${solvedText}`];
  if (streak) parts.push(`current streak ${streak[1]} days`);
  if (mocks) parts.push(`mock interviews done: ${mocks[1]}`);
  return [
    {
      type: "achievement",
      title: "Interview prep progress",
      body: parts.join(". ") + ".",
      source: SOURCE,
      tags: ["import", "progress"],
      confidence: 0.9,
    },
  ];
}

/* -------------------------------- orchestrator ----------------------------- */

interface FileStep {
  file: string;
  parse: (text: string) => SaveMemoryInput[];
}

const STEPS: FileStep[] = [
  { file: "Notes/recurring-mistakes.md", parse: parseRecurringMistakes },
  { file: "Notes/review-queue.md", parse: parseReviewQueue },
  { file: "Notes/patterns-learned.md", parse: parsePatternsLearned },
  { file: "Notes/progress-tracker.md", parse: parseProgressTracker },
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

export async function importInterviewPrep(opts: {
  path: string;
  saveMemory: (input: SaveMemoryInput) => Promise<SaveMemoryResult>;
  onProgress: (p: ImportProgress) => void;
}): Promise<ImportResult> {
  let created = 0;
  let merged = 0;

  for (const step of STEPS) {
    const full = join(opts.path, step.file);
    let text: string;
    try {
      text = await readFile(full, "utf8");
    } catch {
      opts.onProgress({
        step: `skipped ${step.file} (missing/unreadable)`,
        created,
        merged,
        done: false,
      });
      continue;
    }
    let inputs: SaveMemoryInput[] = [];
    try {
      inputs = step.parse(text);
    } catch (err) {
      opts.onProgress({
        step: `error parsing ${step.file}`,
        created,
        merged,
        done: false,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (const input of inputs) {
      const res = await opts.saveMemory(input);
      if (res.action === "created") created += 1;
      else merged += 1;
    }
    opts.onProgress({
      step: `${step.file}: ${inputs.length} records`,
      created,
      merged,
      done: false,
    });
  }

  opts.onProgress({ step: "done", created, merged, done: true });
  return { created, merged };
}
