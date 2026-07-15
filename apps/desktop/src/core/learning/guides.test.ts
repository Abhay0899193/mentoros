import assert from "node:assert/strict";
import test from "node:test";
import {
  createGuideGenerator,
  deriveGuideTitle,
  GuideError,
  stripWrappingFence,
  type GuideFs,
  type GuideProgress,
  type GuideRouter,
} from "./guides.js";

const ROOT = "/fake/3mc";
const RULES_PATH = `${ROOT}/STUDY-GUIDES/RULES.md`;

interface TestFs extends GuideFs {
  __files: Map<string, string>;
}

function memFs(seed: Record<string, string> = {}): TestFs {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: async (p, body) => {
      files.set(p, body);
    },
    mkdir: async () => {},
    exists: async (p) => files.has(p),
    __files: files,
  };
}

function fakeRouter(output: string, opts: { fail?: string } = {}): GuideRouter {
  return {
    stream: async (args) => {
      if (opts.fail) throw new Error(opts.fail);
      // Emit in a couple of chunks so onChunk accumulation is exercised.
      const mid = Math.floor(output.length / 2);
      args.onChunk(output.slice(0, mid));
      args.onChunk(output.slice(mid));
    },
  };
}

function harness(overrides: {
  fs?: GuideFs;
  router?: GuideRouter;
  ingest?: (absPath: string, title: string, tags: string[]) => Promise<string>;
  resolveRoot?: () => string | null;
} = {}) {
  const events: GuideProgress[] = [];
  const fs = overrides.fs ?? memFs({ [RULES_PATH]: "# Rules\nfollow the bar." });
  const gen = createGuideGenerator({
    fs,
    router: overrides.router ?? fakeRouter("---\ntitle: \"Bit Tricks\"\ntopics: [\"dsa/bit-manipulation\"]\n---\n# Bit Tricks\nbody"),
    resolveRoot: overrides.resolveRoot ?? (() => ROOT),
    ingest: overrides.ingest ?? (async (_p, _t, _tags) => "src-1"),
    broadcast: (e) => events.push(e),
  });
  return { gen, events, fs };
}

/* ------------------------------ pure helpers ----------------------------- */

test("stripWrappingFence removes a whole-document ```markdown fence", () => {
  const wrapped = "```markdown\n# Title\nbody\n```";
  assert.equal(stripWrappingFence(wrapped), "# Title\nbody");
});

test("stripWrappingFence leaves unfenced text and inner fences alone", () => {
  const text = "# Title\n\n```python\nprint(1)\n```\n\nmore text";
  assert.equal(stripWrappingFence(text), text);
});

test("deriveGuideTitle prefers frontmatter title", () => {
  const body = '---\ntitle: "Rate Limiters"\n---\n# Body';
  assert.equal(deriveGuideTitle(body, "explain rate limiters please"), "Rate Limiters");
});

test("deriveGuideTitle falls back to the first 6 words of the prompt", () => {
  const body = "# No frontmatter here";
  assert.equal(
    deriveGuideTitle(body, "explain rate limiters — token bucket vs sliding window in depth"),
    "explain rate limiters — token bucket",
  );
});

/**
 * `generate()`'s validation + single-flight checks throw REAL synchronous
 * errors (see createGuideGenerator's doc-comment) — assert.rejects' function
 * form doesn't reliably intercept a throw that happens before any `await`
 * inside the callback across Node versions, so assert a plain try/catch here.
 */
function expectSyncGuideError(fn: () => unknown, status: 400 | 409): void {
  try {
    fn();
    assert.fail("expected generate() to throw synchronously");
  } catch (err) {
    assert.ok(err instanceof GuideError);
    assert.equal(err.status, status);
  }
}

/* -------------------------------- validation ------------------------------ */

test("generate rejects an empty prompt with a 400 GuideError", () => {
  const { gen } = harness();
  expectSyncGuideError(() => gen.generate("   "), 400);
});

test("generate rejects a >2000-char prompt with a 400 GuideError", () => {
  const { gen } = harness();
  expectSyncGuideError(() => gen.generate("x".repeat(2001)), 400);
});

/* ------------------------------- single-flight ----------------------------- */

test("a second concurrent generate() rejects with a 409 GuideError", async () => {
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const router: GuideRouter = {
    stream: async (args) => {
      await gate;
      args.onChunk("---\ntitle: \"X\"\n---\n# X\nbody");
    },
  };
  const { gen } = harness({ router });

  const first = gen.generate("first prompt");
  expectSyncGuideError(() => gen.generate("second prompt"), 409);
  releaseFirst?.();
  await first;
});

/* ---------------------------------- root/RULES ----------------------------- */

test("no persisted plan root -> 409 'Import your learning plan first', broadcasts error", async () => {
  const { gen, events } = harness({ resolveRoot: () => null });
  await assert.rejects(gen.generate("bit tricks"), (err) => {
    assert.ok(err instanceof GuideError);
    assert.equal(err.status, 409);
    assert.equal(err.message, "Import your learning plan first");
    return true;
  });
  assert.deepEqual(events.at(-1), { step: "error", error: "Import your learning plan first" });
});

test("unreadable RULES.md -> same 409, no ingest/write attempted", async () => {
  let ingestCalled = false;
  const { gen } = harness({
    fs: memFs(), // no RULES.md seeded
    ingest: async () => {
      ingestCalled = true;
      return "src-1";
    },
  });
  await assert.rejects(gen.generate("bit tricks"), (err) => {
    assert.ok(err instanceof GuideError);
    assert.equal(err.status, 409);
    return true;
  });
  assert.equal(ingestCalled, false);
});

/* ---------------------------------- happy path ------------------------------ */

test("happy path: writes custom/<slug>.md, ingests tagged generated, broadcasts done", async () => {
  const ingestArgs: { absPath: string; title: string; tags: string[] }[] = [];
  const { gen, events, fs } = harness({
    ingest: async (absPath, title, tags) => {
      ingestArgs.push({ absPath, title, tags });
      return "src-42";
    },
  });
  await gen.generate("bit manipulation tricks for interviews");

  const written = await (fs as unknown as { readFile: (p: string) => Promise<string> }).readFile(
    `${ROOT}/STUDY-GUIDES/custom/bit-tricks.md`,
  );
  assert.match(written, /# Bit Tricks/);

  assert.equal(ingestArgs.length, 1);
  assert.equal(ingestArgs[0].title, "Bit Tricks");
  // Same derivation as a full re-import: topic:* from frontmatter + `generated`.
  assert.deepEqual(ingestArgs[0].tags, [
    "3mc",
    "study-guide",
    "topic:dsa/bit-manipulation",
    "generated",
  ]);

  assert.deepEqual(events.at(-1), { step: "done", slug: "bit-tricks", sourceId: "src-42" });
  assert.ok(events.some((e) => e.step === "ingesting"));
  assert.ok(events.some((e) => e.step === "generating"));
});

test("slug collision on disk gets a -2 suffix", async () => {
  const { gen, fs } = harness({
    fs: memFs({
      [RULES_PATH]: "# Rules",
      [`${ROOT}/STUDY-GUIDES/custom/bit-tricks.md`]: "# existing",
    }),
  });
  await gen.generate("bit manipulation tricks");
  const files = (fs as unknown as { __files: Map<string, string> }).__files;
  assert.ok(files.has(`${ROOT}/STUDY-GUIDES/custom/bit-tricks-2.md`));
});

test("no frontmatter title -> slug derives from the prompt's first words", async () => {
  const { gen, fs } = harness({
    router: fakeRouter("# Just a body\nno frontmatter title here"),
  });
  await gen.generate("System design rate limiter deep dive today");
  const files = (fs as unknown as { __files: Map<string, string> }).__files;
  assert.ok(
    [...files.keys()].some((k) => k.startsWith(`${ROOT}/STUDY-GUIDES/custom/system-design-rate-limiter-deep-dive`)),
  );
});

test("ingest failure after write keeps the file and broadcasts a re-import hint", async () => {
  const { gen, events, fs } = harness({
    ingest: async () => {
      throw new Error("kb engine unavailable");
    },
  });
  await assert.rejects(gen.generate("bit manipulation tricks"));
  const files = (fs as unknown as { __files: Map<string, string> }).__files;
  assert.ok(files.has(`${ROOT}/STUDY-GUIDES/custom/bit-tricks.md`), "file is kept on disk");
  const last = events.at(-1)!;
  assert.equal(last.step, "error");
  assert.match(last.step === "error" ? last.error : "", /Sync learning plan/);
});

test("generation failure before any write leaves nothing on disk", async () => {
  const { gen, fs } = harness({ router: fakeRouter("", { fail: "ollama down" }) });
  await assert.rejects(gen.generate("bit manipulation tricks"));
  const files = (fs as unknown as { __files: Map<string, string> }).__files;
  assert.equal([...files.keys()].filter((k) => k.includes("/custom/")).length, 0);
});
