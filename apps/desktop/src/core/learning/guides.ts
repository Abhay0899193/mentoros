import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OllamaMessage } from "../ollama.js";
import { buildDocTags, parseSkillDocMeta } from "./importer.js";

/**
 * In-app "New guide" generator (plan.md Phase G). Writes ONE supplementary
 * study-guide part to `<3mc root>/STUDY-GUIDES/custom/<slug>.md` from a
 * free-text prompt, then ingests it into the knowledge base. This NEVER
 * touches `STUDY-GUIDES/week-NN/` — those belong to `/generate-guide`
 * (a Claude Code skill), not this in-app path. Pure/testable: every side
 * effect (model call, filesystem, ingest, broadcast) is injected.
 */

const MAX_PROMPT_LEN = 2000;
const CHARS_THROTTLE_MS = 500;

/** Mirrors `CoreEvents['guide.progress']` (renderer boundary) exactly. */
export type GuideProgress =
  | { step: "generating"; chars: number }
  | { step: "ingesting" }
  | { step: "done"; slug: string; sourceId: string }
  | { step: "error"; error: string };

/** Thrown by {@link createGuideGenerator}`.generate`; `status` is what the route sends. */
export class GuideError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
    this.name = "GuideError";
  }
}

/** Mirrors the importer's `SkillDocIngest` — the server wires the same kb.engine call. */
export type GuideDocIngest = (
  absPath: string,
  title: string,
  tags: string[],
) => Promise<string>;

export interface GuideRouter {
  stream(args: {
    surface: "guide";
    messages: OllamaMessage[];
    signal: AbortSignal;
    onChunk: (delta: string) => void;
  }): Promise<void>;
}

/** Filesystem seam so tests never touch real disk. Defaults to node:fs/promises. */
export interface GuideFs {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, body: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
}

export const nodeGuideFs: GuideFs = {
  readFile: (p) => readFile(p, "utf8"),
  writeFile: (p, body) => writeFile(p, body, "utf8"),
  mkdir: (p) => mkdir(p, { recursive: true }).then(() => undefined),
  exists: (p) =>
    access(p)
      .then(() => true)
      .catch(() => false),
};

export interface GuideGeneratorDeps {
  router: GuideRouter;
  /** Reads the persisted `learning.importMeta` sourcePath; null when no plan imported. */
  resolveRoot: () => string | null;
  ingest: GuideDocIngest;
  broadcast: (event: GuideProgress) => void;
  /** Injectable filesystem; defaults to real disk. */
  fs?: GuideFs;
}

/** `NN-topic-slug` style slug, ASCII, hyphenated, capped so filenames stay sane. */
function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "guide";
}

/**
 * Strips an accidental wrapping ```markdown / ``` fence around the WHOLE
 * output (models sometimes fence an entire markdown document even when asked
 * not to) — leaves inner fenced code blocks (Python/Java/mermaid) untouched.
 */
export function stripWrappingFence(text: string): string {
  const trimmed = text.trim();
  const m = /^```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
  return m ? m[1].trim() : trimmed;
}

/** Frontmatter `title:`, else the first 6 words of the prompt — never empty. */
export function deriveGuideTitle(body: string, prompt: string): string {
  const meta = parseSkillDocMeta(body);
  if (meta?.title) return meta.title;
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return words || "Study guide";
}

function buildSystemPrompt(rules: string): string {
  return [
    "You are authoring ONE supplementary study-guide part for a staff-engineer",
    "interview-prep knowledge base (MentorOS). This part lives in",
    "STUDY-GUIDES/custom/ — it is NOT tied to a specific week of the study plan,",
    "so it augments the curriculum on demand rather than replacing a week's guide.",
    "",
    "Follow the authoring rules below exactly — they are the bar every other",
    "guide in this knowledge base is held to. The ONE difference for a custom",
    "part: frontmatter must NOT include a `weeks` key (custom guides aren't",
    "week-bound). Otherwise follow the same required sections, in the same",
    "order, at the same depth.",
    "",
    "--- STUDY-GUIDES/RULES.md ---",
    rules,
    "--- end RULES.md ---",
    "",
    "Frontmatter for THIS part (required, YAML, no `weeks` key):",
    "---",
    'title: "<short, specific title>"',
    'topics: ["area/slug", ...]   # e.g. dsa/bit-manipulation, system-design/rate-limiting',
    "outcomes:",
    '  - "<one thing the reader can do after this part that they could not before>"',
    "---",
    "",
    "Hard constraints:",
    "- Output PURE markdown — the file body only. Do NOT wrap the whole",
    "  document in a ``` fence; only fence actual code/mermaid blocks.",
    "- ≤ 250 lines total.",
    "- mermaid for structural diagrams (decision trees, architecture, state",
    "  machines); ASCII art only for pointer/array-index traces.",
    "- Every code block is runnable as written and tagged with its language.",
  ].join("\n");
}

/**
 * Creates a single-flight guide generator. `generate` validates the prompt and
 * checks single-flight SYNCHRONOUSLY (a real thrown {@link GuideError}, 400/409)
 * so the route can `try { … } catch` it into an immediate HTTP response, then
 * returns a Promise for the rest of the (slow) generation — fire-and-forget on
 * the route side, progress arrives via `broadcast`.
 */
export function createGuideGenerator(deps: GuideGeneratorDeps): {
  generate: (prompt: string) => Promise<void>;
} {
  const fs = deps.fs ?? nodeGuideFs;
  let running = false;

  function generate(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PROMPT_LEN) {
      throw new GuideError(
        "Prompt must be between 1 and 2000 characters.",
        400,
      );
    }
    if (running) {
      throw new GuideError(
        "A guide is already being generated — wait for it to finish.",
        409,
      );
    }
    running = true;
    return run(trimmed).finally(() => {
      running = false;
    });
  }

  async function run(prompt: string): Promise<void> {
    const root = deps.resolveRoot();
    if (!root) {
      throw fail(new GuideError("Import your learning plan first", 409));
    }
    let rules: string;
    try {
      rules = await fs.readFile(join(root, "STUDY-GUIDES", "RULES.md"));
    } catch {
      throw fail(new GuideError("Import your learning plan first", 409));
    }

    const messages: OllamaMessage[] = [
      { role: "system", content: buildSystemPrompt(rules) },
      { role: "user", content: prompt },
    ];

    let text = "";
    let lastBroadcast = 0;
    const controller = new AbortController();
    try {
      await deps.router.stream({
        surface: "guide",
        messages,
        signal: controller.signal,
        onChunk: (delta) => {
          text += delta;
          const now = Date.now();
          if (now - lastBroadcast >= CHARS_THROTTLE_MS) {
            lastBroadcast = now;
            deps.broadcast({ step: "generating", chars: text.length });
          }
        },
      });
    } catch (err) {
      throw fail(new Error(`Could not generate the guide: ${errMsg(err)}`));
    }
    // Final count always fires, even if the last chunk landed inside the throttle window.
    deps.broadcast({ step: "generating", chars: text.length });

    const body = stripWrappingFence(text);
    if (body.length === 0) {
      throw fail(new Error("The model returned an empty guide — nothing was written."));
    }

    const title = deriveGuideTitle(body, prompt);
    const dir = join(root, "STUDY-GUIDES", "custom");
    let slug: string;
    try {
      await fs.mkdir(dir);
      slug = await uniqueSlug(fs, dir, slugify(title));
    } catch (err) {
      throw fail(new Error(`Could not write the guide file: ${errMsg(err)}`));
    }

    const filePath = join(dir, `${slug}.md`);
    try {
      await fs.writeFile(filePath, body);
    } catch (err) {
      throw fail(new Error(`Could not write the guide file: ${errMsg(err)}`));
    }

    deps.broadcast({ step: "ingesting" });
    try {
      // Same derivation as a full re-import (topic:* from frontmatter + `generated`)
      // so the later upsert-by-path lands an identical tag set.
      const tags = buildDocTags("study-guide", `${slug}.md`, parseSkillDocMeta(body), true);
      const sourceId = await deps.ingest(filePath, title, tags);
      deps.broadcast({ step: "done", slug, sourceId });
    } catch (err) {
      // The file is already on disk — keep it (never delete generated content on
      // an ingest failure). The next "Sync learning plan" re-import picks it up.
      throw fail(
        new Error(
          `Wrote STUDY-GUIDES/custom/${slug}.md but could not add it to Knowledge yet ` +
            `(${errMsg(err)}). Re-run "Sync learning plan" to pick it up.`,
        ),
      );
    }
  }

  function fail<E extends Error>(err: E): E {
    deps.broadcast({ step: "error", error: err.message });
    return err;
  }

  return { generate };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function uniqueSlug(fs: GuideFs, dir: string, base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (await fs.exists(join(dir, `${slug}.md`))) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}
