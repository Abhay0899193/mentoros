import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { import3mc, parseSkillDocMeta, type ImportProgress } from "./importer.js";
import type { LearningStore, WeekDocRow } from "./store.js";

/* --------------------------- parseSkillDocMeta --------------------------- */

test("parseSkillDocMeta reads title and weeks from frontmatter", () => {
  const meta = parseSkillDocMeta(
    `---\ntitle: "Docker"\ndescription: "stuff"\nweeks: [1, 2]\n---\n# Body`,
  );
  assert.deepEqual(meta, { title: "Docker", weeks: [1, 2] });
});

test("parseSkillDocMeta tolerates unquoted title and missing weeks", () => {
  const meta = parseSkillDocMeta(`---\ntitle: Auth & Security\n---\n# Body`);
  assert.deepEqual(meta, { title: "Auth & Security", weeks: [] });
});

test("parseSkillDocMeta returns null without a frontmatter block", () => {
  assert.equal(parseSkillDocMeta(`# Just a doc\nweeks: [3]`), null);
});

/* ------------------------ skill-doc import pass -------------------------- */

const PLAN = JSON.stringify([
  {
    phase: 1,
    weeks: [
      {
        week: 1,
        days: [
          {
            day: 1,
            tasks: [
              { id: "phase-1-week-1-day-1-res-1", title: "Video", type: "video" },
            ],
          },
        ],
      },
    ],
  },
]);

async function make3mcTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "3mc-test-"));
  await mkdir(join(root, "study-ui/data"), { recursive: true });
  await writeFile(join(root, "study-ui/data/parsed-plan.json"), PLAN);
  await mkdir(join(root, "SKILLS-TRACK"), { recursive: true });
  await writeFile(
    join(root, "SKILLS-TRACK/docker.md"),
    `---\ntitle: "Docker"\nweeks: [1, 2]\n---\n# Docker`,
  );
  await writeFile(
    join(root, "SKILLS-TRACK/redis.md"),
    `---\ntitle: "Redis"\nweeks: [5]\n---\n# Redis`,
  );
  await mkdir(join(root, "STUDY-GUIDES"), { recursive: true });
  await writeFile(
    join(root, "STUDY-GUIDES/week-01.md"),
    `---\ntitle: "Week 1 Guide"\nweeks: [1]\n---\n# Guide`,
  );
  return root;
}

// The native sqlite binding can't load under the test runner's Node build, so
// fake the four store methods the importer touches. weekDocs() mirrors the real
// ORDER BY week, title.
function memStore(): LearningStore {
  const days = new Set<string>();
  const tasks = new Set<string>();
  let docs: WeekDocRow[] = [];
  const fake = {
    upsertDay: (d: { id: string }) => {
      const existed = days.has(d.id);
      days.add(d.id);
      return existed ? "merged" : "created";
    },
    upsertTask: (t: { id: string }) => {
      const existed = tasks.has(t.id);
      tasks.add(t.id);
      return existed ? "merged" : "created";
    },
    setDayNotes: () => {},
    replaceWeekDocs: (entries: WeekDocRow[]) => {
      docs = entries;
    },
    weekDocs: () =>
      [...docs].sort((a, b) => a.week - b.week || a.title.localeCompare(b.title)),
  };
  return fake as unknown as LearningStore;
}

test("import3mc ingests skill docs and links them to weeks", async () => {
  const root = await make3mcTree();
  const store = memStore();
  const ingested: string[] = [];
  await import3mc({
    path: root,
    store,
    onProgress: () => {},
    ingestSkillDoc: async (absPath, title, tags) => {
      ingested.push(title);
      assert.equal(tags[0], "3mc");
      assert.equal(tags[1], absPath.includes("STUDY-GUIDES") ? "study-guide" : "quick-review");
      assert.ok(absPath.endsWith(".md"));
      return `src-${title.toLowerCase().replaceAll(" ", "-")}`;
    },
  });
  assert.deepEqual(ingested, ["Docker", "Redis", "Week 1 Guide"]);
  assert.deepEqual(store.weekDocs(), [
    { week: 1, sourceId: "src-docker", title: "Docker" },
    { week: 1, sourceId: "src-week-1-guide", title: "Week 1 Guide" },
    { week: 2, sourceId: "src-docker", title: "Docker" },
    { week: 5, sourceId: "src-redis", title: "Redis" },
  ]);
});

test("a failing skill-doc ingest never fails the plan import", async () => {
  const root = await make3mcTree();
  const store = memStore();
  const steps: ImportProgress[] = [];
  const result = await import3mc({
    path: root,
    store,
    onProgress: (p) => steps.push(p),
    ingestSkillDoc: async (_absPath, title) => {
      if (title === "Docker") throw new Error("ollama down");
      return `src-${title.toLowerCase().replaceAll(" ", "-")}`;
    },
  });
  assert.ok(result.created > 0);
  assert.ok(steps.some((s) => s.step === "skill doc failed: docker.md"));
  assert.equal(steps.at(-1)?.step, "done");
  // Surviving docs still link; the failed one is simply absent.
  assert.deepEqual(store.weekDocs(), [
    { week: 1, sourceId: "src-week-1-guide", title: "Week 1 Guide" },
    { week: 5, sourceId: "src-redis", title: "Redis" },
  ]);
});

test("import3mc without ingestSkillDoc skips the skill-doc pass", async () => {
  const root = await make3mcTree();
  const store = memStore();
  await import3mc({ path: root, store, onProgress: () => {} });
  assert.deepEqual(store.weekDocs(), []);
});
