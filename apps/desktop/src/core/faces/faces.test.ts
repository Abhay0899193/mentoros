import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { computeCrop, ellipseFor } from "./crop.js";
import {
  evaluateGenerateToolchain,
  evaluateToolchain,
  type GenerateToolchainProbe,
  type ToolchainProbe,
} from "./toolchain.js";
import { FaceValidationError, validateCreateInput, type ImageProbe } from "./validate.js";
import {
  FaceForbiddenError,
  FaceStore,
  serializePreset,
  slugifyFace,
  type FaceRepo,
  type JobRow,
  type PresetRow,
} from "./store.js";
import {
  parseConfig,
  synthesizeLegacyConfig,
  validateAddExpressionInput,
  validateConfigUpdate,
  validateGenerateInput,
  validateManualInput,
} from "./config.js";
import { FaceAbortError, parseDetect, type FaceOps } from "./ops.js";
import { runFaceJob } from "./runner.js";
import { resolveGenerateExpressions, runGeneratePresetJob } from "./generateRunner.js";
import { buildGeneratedConfig, serializeCatalog } from "./catalog.js";
import { FaceService, type ActiveFaceSettings } from "./service.js";
import { registerFaceRoutes } from "./routes.js";
import { presetDir, workDir } from "./paths.js";
import { SettingsStore, type SettingsKv } from "../settings/store.js";
import type {
  AppSettings,
  CoreEvents,
  CreateFacePresetInput,
  FaceRegion,
  GenerateFacePresetInput,
} from "../types.js";

const READY_GEN_PROBE: GenerateToolchainProbe = {
  hasZTurboBin: () => true,
  hasZTurboWeights: () => true,
  hasCwebp: () => true,
  hasUv: () => true,
};

/* ------------------------------ test doubles ------------------------------ */

function memRepo(seedJobs: JobRow[] = []): FaceRepo {
  const presets: PresetRow[] = [];
  const jobs: JobRow[] = [...seedJobs];
  return {
    listPresets: () => presets.map((p) => ({ ...p })),
    getPreset: (id) => {
      const p = presets.find((r) => r.id === id);
      return p ? { ...p } : null;
    },
    insertPreset: (row) => {
      const i = presets.findIndex((r) => r.id === row.id);
      if (i >= 0) presets[i] = { ...row };
      else presets.push({ ...row });
    },
    deletePreset: (id) => {
      const i = presets.findIndex((r) => r.id === id);
      if (i >= 0) {
        presets.splice(i, 1);
        return true;
      }
      return false;
    },
    insertJob: (row) => jobs.push({ ...row }),
    updateJob: (id, patch) => {
      const j = jobs.find((r) => r.id === id);
      if (j) Object.assign(j, patch);
    },
    getJob: (id) => {
      const j = jobs.find((r) => r.id === id);
      return j ? { ...j } : null;
    },
    latestJob: () => (jobs.length ? { ...jobs[jobs.length - 1]! } : null),
    sweepLiveJobs: (error) => {
      const swept: string[] = [];
      for (const j of jobs) {
        if (["queued", "generating", "compositing"].includes(j.state)) {
          j.state = "error";
          j.error = error;
          swept.push(j.id);
        }
      }
      return swept;
    },
  };
}

function memKv(): SettingsKv {
  const map = new Map<string, string>();
  return {
    readAll: () => [...map].map(([key, value]) => ({ key, value })),
    writeMany: (entries) => {
      for (const [key, value] of entries) map.set(key, value);
    },
  };
}

/** Fake ops: write placeholder files at each output, record calls, honor abort. */
function recordingOps(calls: string[], opts: { failOn?: string; hangEdits?: boolean } = {}): FaceOps {
  const hang = (signal: AbortSignal): Promise<void> =>
    new Promise<void>((_res, rej) => {
      signal.addEventListener("abort", () => rej(new FaceAbortError()), { once: true });
    });
  return {
    async prepBase(_p, _c, out) {
      calls.push("prep");
      writeFileSync(out, "png");
      return { accent: "#3366aa" };
    },
    async kontextEdit(_in, out, _prompt, _seed, signal) {
      const key = /(?:kontext|gen|edit)-([a-z0-9-]+?)(?:-\d+)?\.png$/.exec(out)?.[1] ?? "?";
      if (signal.aborted) throw new FaceAbortError();
      if (opts.failOn === key) throw new Error(`boom ${key}`);
      if (opts.hangEdits) await hang(signal);
      calls.push(`edit:${key}`);
      writeFileSync(out, "png");
    },
    async zTurboGenerate(out, _prompt, _seed, _w, _h, signal) {
      const key = /gen-([a-z0-9-]+)-\d+\.png$/.exec(out)?.[1] ?? "?";
      if (signal.aborted) throw new FaceAbortError();
      if (opts.failOn === key) throw new Error(`boom ${key}`);
      if (opts.hangEdits) await hang(signal);
      calls.push(`gen:${key}`);
      writeFileSync(out, "png");
    },
    async normalizeBase(_src, out) {
      calls.push("normbase");
      writeFileSync(out, "png");
    },
    async composite(_b, _e, _ell, out) {
      calls.push("composite");
      writeFileSync(out, "png");
    },
    async detectRegion(_b, _e, _zone, fallback) {
      calls.push("detect");
      return { region: fallback, source: "default" };
    },
    async accent(_img, _region) {
      calls.push("accent");
      return "#3366aa";
    },
    async fullBody(_f, out) {
      calls.push("full");
      writeFileSync(out, "png");
    },
    async encodeWebp(_in, out) {
      calls.push("webp");
      writeFileSync(out, "webp");
    },
  };
}

const READY_PROBE: ToolchainProbe = {
  hasKontextBin: () => true,
  hasKontextModel: () => true,
  hasCwebp: () => true,
  hasUv: () => true,
};

const okImageProbe: ImageProbe = () => ({ width: 1200, height: 1600 });

const REGIONS = {
  mouth: { x: 460, y: 900, width: 280, height: 150 } as FaceRegion,
  eyes: { x: 360, y: 560, width: 480, height: 180 } as FaceRegion,
};

function validInput(name = "Maya"): CreateFacePresetInput {
  return { name, portraitPath: "/tmp/portrait.jpg", ...REGIONS };
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "faces-test-"));
}

/* -------------------------------- crop maths ------------------------------ */

test("computeCrop centres a square on the eyes∪mouth union and maps regions", () => {
  const { crop, scale, mouth, eyes } = computeCrop(1200, 1600, REGIONS.mouth, REGIONS.eyes);
  // union: x 360..840, y 560..1050 → w 480, h 490. side = max(490*2.2, 480*1.1)=1078.
  assert.equal(crop.size, 1078);
  const cx = (360 + 840) / 2; // 600
  assert.equal(crop.x, Math.round(cx - 1078 / 2)); // 61
  assert.ok(crop.x >= 0 && crop.x + crop.size <= 1200);
  assert.ok(crop.y >= 0 && crop.y + crop.size <= 1600);
  assert.equal(scale, 1024 / 1078);
  // mouth maps to (r.x-cropX)*scale etc.
  assert.equal(mouth.x, (460 - crop.x) * scale);
  assert.equal(mouth.width, 280 * scale);
  assert.ok(eyes.y < mouth.y);
});

test("computeCrop clamps the square inside the image at an edge", () => {
  // Regions hard against the right/bottom edge of a small image.
  const mouth: FaceRegion = { x: 700, y: 900, width: 80, height: 60 };
  const eyes: FaceRegion = { x: 680, y: 800, width: 100, height: 50 };
  const { crop } = computeCrop(800, 1000, mouth, eyes);
  assert.ok(crop.x >= 0, "x within bounds");
  assert.ok(crop.y >= 0, "y within bounds");
  assert.ok(crop.x + crop.size <= 800, "right edge within bounds");
  assert.ok(crop.y + crop.size <= 1000, "bottom edge within bounds");
  assert.ok(crop.size <= 800, "square never exceeds the short side");
});

test("ellipseFor is rect centre + half-extents", () => {
  const e = ellipseFor({ x: 100, y: 200, width: 80, height: 40 });
  assert.deepEqual(e, { cx: 140, cy: 220, rx: 40, ry: 20 });
});

/* ------------------------------- toolchain -------------------------------- */

test("evaluateToolchain ready only when all present, else names each gap", () => {
  assert.deepEqual(evaluateToolchain(READY_PROBE), { state: "ready" });

  const noBin = evaluateToolchain({ ...READY_PROBE, hasKontextBin: () => false });
  assert.equal(noBin.state, "missing");
  assert.match(noBin.detail!, /mflux/);

  const noModel = evaluateToolchain({ ...READY_PROBE, hasKontextModel: () => false });
  assert.match(noModel.detail!, /Kontext/);

  const noCwebp = evaluateToolchain({ ...READY_PROBE, hasCwebp: () => false });
  assert.match(noCwebp.detail!, /cwebp/);

  const noUv = evaluateToolchain({ ...READY_PROBE, hasUv: () => false });
  assert.match(noUv.detail!, /uv/);

  const none = evaluateToolchain({
    hasKontextBin: () => false,
    hasKontextModel: () => false,
    hasCwebp: () => false,
    hasUv: () => false,
  });
  assert.equal(none.detail!.split(";").length, 4);
});

/* ------------------------------ validation -------------------------------- */

test("validateCreateInput accepts a good payload and echoes probed dims", () => {
  const { input, portraitDims } = validateCreateInput(validInput(), okImageProbe);
  assert.equal(input.name, "Maya");
  assert.deepEqual(portraitDims, { width: 1200, height: 1600 });
});

test("validateCreateInput rejects the whole 422 matrix", () => {
  const bad = (payload: unknown, probe: ImageProbe = okImageProbe) =>
    assert.throws(() => validateCreateInput(payload, probe), FaceValidationError);

  bad({ ...validInput(), name: "" });
  bad({ ...validInput(), name: "x".repeat(61) });
  bad(validInput(), () => null); // unreadable portrait
  bad(validInput(), () => ({ width: 700, height: 900 })); // short side < 768
  bad({ ...validInput(), mouth: { x: 460, y: 900, width: -10, height: 150 } }); // negative
  bad({ ...validInput(), eyes: { x: 360, y: 560, width: 900, height: 180 } }); // out of bounds (x+w>1200)
  // mouth above eyes (swapped)
  bad({ ...validInput(), mouth: REGIONS.eyes, eyes: REGIONS.mouth });
  // bad full path
  bad({ ...validInput(), fullPath: "/tmp/x.png" }, (p) =>
    p === "/tmp/x.png" ? null : { width: 1200, height: 1600 },
  );
});

/* ---------------------------------- slug ---------------------------------- */

test("slugifyFace + uniqueId dedupe against persisted presets", () => {
  assert.equal(slugifyFace("Maya Q!"), "maya-q");
  assert.equal(slugifyFace("   "), "mentor");
  const store = new FaceStore(memRepo());
  assert.equal(store.uniqueId("Maya"), "face-maya");
  store.insertPreset({ id: "face-maya", name: "Maya", accent: "#fff", hasFull: false, createdAt: "t", configJson: null });
  assert.equal(store.uniqueId("Maya"), "face-maya-2");
  // built-in collision is avoided too.
  assert.equal(store.uniqueId("Aura").startsWith("face-aura"), true);
});

/* --------------------------- runner skip-if-exists ------------------------ */

test("runFaceJob skips steps whose output already exists (resume)", async () => {
  const dir = tmpDir();
  try {
    const art = presetDir(dir, "face-maya");
    const work = workDir(dir, "face-maya");
    const crop = computeCrop(1200, 1600, REGIONS.mouth, REGIONS.eyes);
    // Pre-stage base + m2 edit as if a prior run got that far.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "base.png"), "png");
    writeFileSync(join(work, "meta.json"), JSON.stringify({ accent: "#abcdef" }));
    writeFileSync(join(work, "kontext-m2.png"), "png");

    const calls: string[] = [];
    const res = await runFaceJob({
      ops: recordingOps(calls),
      crop,
      input: validInput(),
      artDir: art,
      workDir: work,
      seed: 5,
      signal: new AbortController().signal,
      report: () => {},
    });

    assert.equal(res.accent, "#abcdef", "accent read from cached meta, prep skipped");
    assert.ok(!calls.includes("prep"), "prep skipped (base + meta present)");
    assert.ok(!calls.includes("edit:m2"), "m2 skipped (already generated)");
    assert.ok(calls.includes("edit:m1") && calls.includes("edit:m3") && calls.includes("edit:blink"));
    for (const f of ["portrait-base", "portrait-m1", "portrait-m2", "portrait-m3", "portrait-blink"]) {
      assert.ok(existsSync(join(art, `${f}.webp`)), `${f}.webp written`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runFaceJob emits full frame when a full-body photo is provided", async () => {
  const dir = tmpDir();
  try {
    const calls: string[] = [];
    const res = await runFaceJob({
      ops: recordingOps(calls),
      crop: computeCrop(1200, 1600, REGIONS.mouth, REGIONS.eyes),
      input: { ...validInput(), fullPath: "/tmp/full.jpg" },
      artDir: presetDir(dir, "face-maya"),
      workDir: workDir(dir, "face-maya"),
      seed: 1,
      signal: new AbortController().signal,
      report: () => {},
    });
    assert.equal(res.hasFull, true);
    assert.ok(calls.includes("full"));
    assert.ok(existsSync(join(presetDir(dir, "face-maya"), "full.webp")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------ job lifecycle ----------------------------- */

interface Harness {
  service: FaceService;
  events: Array<{ event: keyof CoreEvents; payload: unknown }>;
  terminal: Promise<CoreEvents["face.job"]>;
  dir: string;
}

function harness(opts: {
  repo?: FaceRepo;
  ops?: FaceOps;
  probe?: ToolchainProbe;
  settings?: ActiveFaceSettings;
} = {}): Harness {
  const dir = tmpDir();
  const events: Array<{ event: keyof CoreEvents; payload: unknown }> = [];
  let resolveTerminal!: (s: CoreEvents["face.job"]) => void;
  const terminal = new Promise<CoreEvents["face.job"]>((r) => (resolveTerminal = r));
  const broadcast = (<E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => {
    events.push({ event, payload });
    if (event === "face.job") {
      const s = payload as CoreEvents["face.job"];
      if (["done", "error", "cancelled"].includes(s.state)) resolveTerminal(s);
    }
  }) as <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;
  const service = new FaceService({
    dataDir: dir,
    store: new FaceStore(opts.repo ?? memRepo()),
    ops: opts.ops ?? recordingOps([]),
    broadcast,
    toolchainProbe: opts.probe ?? READY_PROBE,
    ...(opts.settings ? { settings: opts.settings } : {}),
  });
  return { service, events, terminal, dir };
}

test("FaceService runs a job to done: ordered events, preset persisted, faces.changed", async () => {
  const repo = memRepo();
  const h = harness({ repo });
  try {
    const status = h.service.start(validInput(), { width: 1200, height: 1600 });
    assert.equal(status.state, "queued");
    assert.ok(h.service.isBusy());

    const final = await h.terminal;
    assert.equal(final.state, "done");
    assert.equal(final.completedFrames, 4);
    assert.ok(!h.service.isBusy(), "not busy after completion");

    const jobStates = h.events
      .filter((e) => e.event === "face.job")
      .map((e) => (e.payload as CoreEvents["face.job"]).state);
    assert.equal(jobStates[0], "queued");
    assert.ok(jobStates.includes("generating"));
    assert.ok(jobStates.indexOf("compositing") > jobStates.indexOf("generating"));
    assert.equal(jobStates[jobStates.length - 1], "done");

    assert.equal(repo.listPresets().length, 1);
    assert.equal(repo.listPresets()[0]!.accent, "#3366aa");
    assert.ok(h.events.some((e) => e.event === "faces.changed"));
    assert.equal(h.service.listCustom().length, 1);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("FaceService cancel kills the run and keeps the work dir", async () => {
  const h = harness({ ops: recordingOps([], { hangEdits: true }) });
  try {
    const status = h.service.start(validInput(), { width: 1200, height: 1600 });
    // Let prep + first edit begin, then cancel.
    await new Promise((r) => setTimeout(r, 10));
    h.service.cancel(status.jobId);
    const final = await h.terminal;
    assert.equal(final.state, "cancelled");
    assert.ok(!h.service.isBusy());
    // Partial work survives for skip-if-exists retry.
    assert.ok(existsSync(join(workDir(h.dir, status.presetId), "base.png")));
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("FaceService marks a job that failed mid-generation as error", async () => {
  const h = harness({ ops: recordingOps([], { failOn: "m1" }) });
  try {
    h.service.start(validInput(), { width: 1200, height: 1600 });
    const final = await h.terminal;
    assert.equal(final.state, "error");
    assert.match(final.error!, /boom m1/);
    assert.equal(h.service.listCustom().length, 0, "no preset persisted on failure");
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("FaceService boot marks an interrupted (live) job as error", () => {
  const seeded: JobRow = {
    id: "job-1",
    presetId: "face-maya",
    name: "Maya",
    kind: "photo",
    state: "generating",
    step: "Mouth frame 2 of 3",
    completedFrames: 1,
    totalFrames: 4,
    error: null,
    startedAt: "t",
  };
  const h = harness({ repo: memRepo([seeded]) });
  try {
    const active = h.service.activeJob();
    assert.equal(active!.state, "error");
    assert.match(active!.error!, /interrupted by restart/);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

/* --------------------------------- routes --------------------------------- */

function fakeSettings(mentorFace = "aura"): ActiveFaceSettings & { current: () => string } {
  let face = mentorFace;
  return {
    get: () => ({ mentorFace: face }),
    patch: (input) => {
      face = input.mentorFace;
      return { mentorFace: face };
    },
    current: () => face,
  };
}

async function routeApp(over: {
  probe?: ToolchainProbe;
  generateProbe?: GenerateToolchainProbe;
  imageProbe?: ImageProbe;
  ops?: FaceOps;
  settings?: ActiveFaceSettings;
  repo?: FaceRepo;
  isImageGenBusy?: () => boolean;
  resolveHistoryImage?: (id: string) => string | null;
  dir?: string;
}) {
  const dir = over.dir ?? tmpDir();
  const events: Array<{ event: keyof CoreEvents; payload: unknown }> = [];
  const broadcast = (<E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => {
    events.push({ event, payload });
  }) as <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;
  const service = new FaceService({
    dataDir: dir,
    store: new FaceStore(over.repo ?? memRepo()),
    ops: over.ops ?? recordingOps([], { hangEdits: true }),
    broadcast,
    toolchainProbe: over.probe ?? READY_PROBE,
    generateProbe: over.generateProbe ?? READY_GEN_PROBE,
    ...(over.resolveHistoryImage ? { resolveHistoryImage: over.resolveHistoryImage } : {}),
    ...(over.settings ? { settings: over.settings } : {}),
  });
  const app = Fastify();
  registerFaceRoutes(app, {
    service,
    broadcast,
    probe: over.imageProbe ?? okImageProbe,
    getSettings: () => ({ mentorFace: over.settings?.get().mentorFace ?? "aura" }) as AppSettings,
    ...(over.isImageGenBusy ? { isImageGenBusy: over.isImageGenBusy } : {}),
    dataDir: dir,
  });
  await app.ready();
  return { app, service, events, dir };
}

test("POST /faces/custom 503 when the toolchain is missing", async () => {
  const { app, dir } = await routeApp({ probe: { ...READY_PROBE, hasCwebp: () => false } });
  const res = await app.inject({ method: "POST", url: "/faces/custom", payload: validInput() });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().detail, /cwebp/);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("POST /faces/custom 422 on invalid regions", async () => {
  const { app, dir } = await routeApp({});
  const res = await app.inject({
    method: "POST",
    url: "/faces/custom",
    payload: { ...validInput(), mouth: { x: 0, y: 0, width: 0, height: 0 } },
  });
  assert.equal(res.statusCode, 422);
  assert.ok(res.json().error);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("POST /faces/custom 409 while a job is already running", async () => {
  const { app, service, dir } = await routeApp({});
  const first = await app.inject({ method: "POST", url: "/faces/custom", payload: validInput() });
  assert.equal(first.statusCode, 200);
  assert.ok(service.isBusy());
  const second = await app.inject({ method: "POST", url: "/faces/custom", payload: validInput("Nova") });
  assert.equal(second.statusCode, 409);
  // Clean up the hanging job.
  service.cancel(first.json().job.jobId);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("DELETE /faces/custom 403 for built-ins, 404 for unknown", async () => {
  const { app, dir } = await routeApp({});
  const builtin = await app.inject({ method: "DELETE", url: "/faces/custom/aura" });
  assert.equal(builtin.statusCode, 403);
  const unknown = await app.inject({ method: "DELETE", url: "/faces/custom/face-nope" });
  assert.equal(unknown.statusCode, 404);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("DELETE /faces/custom resets active mentorFace and fires both events", async () => {
  const repo = memRepo();
  repo.insertPreset({ id: "face-maya", name: "Maya", accent: "#fff", hasFull: false, createdAt: "t", configJson: null });
  const settings = fakeSettings("face-maya");
  const { app, events, dir } = await routeApp({ repo, settings });
  const res = await app.inject({ method: "DELETE", url: "/faces/custom/face-maya" });
  assert.equal(res.statusCode, 204);
  assert.equal(settings.current(), "aura", "active mentorFace reset");
  assert.ok(events.some((e) => e.event === "settings.changed"));
  assert.ok(events.some((e) => e.event === "faces.changed"));
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("GET /faces/art serves webp and guards traversal", async () => {
  const dir = tmpDir();
  const { app } = await routeApp({ dir });
  const { mkdirSync } = await import("node:fs");
  mkdirSync(presetDir(dir, "face-maya"), { recursive: true });
  writeFileSync(join(presetDir(dir, "face-maya"), "portrait-base.webp"), "WEBPDATA");
  const ok = await app.inject({ method: "GET", url: "/faces/art/face-maya/portrait-base.webp" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["content-type"], "image/webp");
  // revalidation, never max-age: preset ids reuse freed slugs, so time-based
  // caching would serve a deleted preset's frames at the recreated URLs
  assert.equal(ok.headers["cache-control"], "no-cache");
  const etag = ok.headers.etag as string;
  assert.ok(etag && etag.startsWith('"'));
  const revalidated = await app.inject({
    method: "GET",
    url: "/faces/art/face-maya/portrait-base.webp",
    headers: { "if-none-match": etag },
  });
  assert.equal(revalidated.statusCode, 304);
  // overwriting the file must change the ETag so stale caches miss
  writeFileSync(join(presetDir(dir, "face-maya"), "portrait-base.webp"), "WEBPDATA-v2");
  const changed = await app.inject({
    method: "GET",
    url: "/faces/art/face-maya/portrait-base.webp",
    headers: { "if-none-match": etag },
  });
  assert.equal(changed.statusCode, 200);
  assert.notEqual(changed.headers.etag, etag);
  const traversal = await app.inject({ method: "GET", url: "/faces/art/face-maya/..%2f..%2fsecret" });
  assert.equal(traversal.statusCode, 404);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/* --------------------- generic avatar config (v1) ------------------------- */

const LEGACY_ROW: PresetRow = {
  id: "face-maya",
  name: "Maya",
  accent: "#3366aa",
  hasFull: true,
  createdAt: "t0",
  configJson: null,
};

test("synthesizeLegacyConfig builds the fixed blink/talk clips + randomInterval trigger", () => {
  const cfg = synthesizeLegacyConfig(LEGACY_ROW);
  assert.equal(cfg.schemaVersion, 1);
  assert.equal(cfg.baseFrame, "portrait-base.webp");
  assert.equal(cfg.fullBase, "full.webp");
  assert.equal(cfg.createdAt, "t0");
  assert.equal(cfg.updatedAt, "t0");

  const blink = cfg.animations.find((c) => c.id === "blink")!;
  assert.equal(blink.track, "eyes");
  assert.equal(blink.driver, "time");
  assert.equal(blink.durationMs, 130);
  assert.equal(blink.loopMode, "once");
  assert.deepEqual(blink.frames, ["portrait-blink.webp"]);

  const talk = cfg.animations.find((c) => c.id === "talk")!;
  assert.equal(talk.track, "mouth");
  assert.equal(talk.driver, "envelope");
  assert.equal(talk.loopMode, "loop");
  assert.deepEqual(talk.frames, ["portrait-m1.webp", "portrait-m2.webp", "portrait-m3.webp"]);

  assert.equal(cfg.triggers.length, 1);
  const trig = cfg.triggers[0]!;
  assert.equal(trig.kind, "randomInterval");
  assert.equal(trig.id, "blink-auto");
  assert.equal(trig.animationId, "blink");
  assert.equal(trig.enabled, true);
  if (trig.kind === "randomInterval") {
    assert.equal(trig.minMs, 2400);
    assert.equal(trig.maxMs, 5200);
  }
});

test("serializePreset maps config art references to /faces/art/<id>/…", () => {
  const preset = serializePreset(LEGACY_ROW);
  assert.equal(preset.config.baseFrame, "/faces/art/face-maya/portrait-base.webp");
  assert.equal(preset.config.fullBase, "/faces/art/face-maya/full.webp");
  const talk = preset.config.animations.find((c) => c.id === "talk")!;
  assert.deepEqual(talk.frames, [
    "/faces/art/face-maya/portrait-m1.webp",
    "/faces/art/face-maya/portrait-m2.webp",
    "/faces/art/face-maya/portrait-m3.webp",
  ]);
  assert.equal(preset.portrait.base, "/faces/art/face-maya/portrait-base.webp");
});

/** Minimal webp data URI: only the RIFF/WEBP magic is checked. */
function tinyWebp(magic = true): string {
  const buf = Buffer.alloc(16);
  buf.write(magic ? "RIFF" : "NOPE", 0, "ascii");
  buf.write(magic ? "WEBP" : "XXXX", 8, "ascii");
  return `data:image/webp;base64,${buf.toString("base64")}`;
}

test("validateManualInput accepts a minimal valid input and rejects non-webp frames", () => {
  const clip = {
    id: "wave",
    name: "Wave",
    category: "gesture",
    appliesTo: "portrait",
    renderKind: "sprite",
    track: "main",
    driver: "time",
    loopMode: "once",
    priority: 5,
    frames: [tinyWebp()],
  };
  const good = { name: "Maya", accent: "#3366aa", baseFrame: tinyWebp(), animations: [clip], triggers: [] };
  const ok = validateManualInput(good);
  assert.equal(ok.name, "Maya");
  assert.equal(ok.animations.length, 1);

  // Wrong mime prefix on the base frame.
  assert.throws(
    () => validateManualInput({ ...good, baseFrame: "data:image/png;base64,AAAA" }),
    FaceValidationError,
  );
  // Right prefix but bad RIFF/WEBP magic on a clip frame.
  assert.throws(
    () => validateManualInput({ ...good, animations: [{ ...clip, frames: [tinyWebp(false)] }] }),
    FaceValidationError,
  );
});

test("updateConfig on a built-in id throws FaceForbiddenError", () => {
  const dir = tmpDir();
  try {
    const service = new FaceService({
      dataDir: dir,
      store: new FaceStore(memRepo()),
      ops: recordingOps([]),
      broadcast: () => {},
      toolchainProbe: READY_PROBE,
    });
    assert.throws(
      () => service.updateConfig("aura", { animations: [], triggers: [] }),
      FaceForbiddenError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* --------------------- settings accepts custom face ids ------------------- */

test("SettingsStore accepts a custom mentorFace once the face lookup is wired", () => {
  const store = new FaceStore(memRepo());
  const settings = new SettingsStore(memKv());
  settings.setFaceLookup(store);

  // Unknown custom id rejected before the preset exists.
  assert.throws(() => settings.patch({ mentorFace: "face-maya" }));

  store.insertPreset({ id: "face-maya", name: "Maya", accent: "#fff", hasFull: false, createdAt: "t", configJson: null });
  const merged = settings.patch({ mentorFace: "face-maya" });
  assert.equal(merged.mentorFace, "face-maya");
  assert.equal(settings.get().mentorFace, "face-maya", "custom id survives a re-read");
});

/* ===================== Preset Generator (t2i) ============================= */

const READY_GEN_INPUT = (over: Partial<GenerateFacePresetInput> = {}): GenerateFacePresetInput => ({
  name: "Zara",
  characterPrompt: "Studio portrait photograph of Zara",
  expressions: [{ key: "smile" }],
  baseDataUri: "data:image/png;base64,AAAA",
  ...over,
});

interface GenHarness {
  service: FaceService;
  store: FaceStore;
  events: Array<{ event: keyof CoreEvents; payload: unknown }>;
  waitFor: (jobId: string) => Promise<CoreEvents["face.job"]>;
  dir: string;
}

function genHarness(opts: { ops?: FaceOps; repo?: FaceRepo } = {}): GenHarness {
  const dir = tmpDir();
  const events: Array<{ event: keyof CoreEvents; payload: unknown }> = [];
  const terminals = new Map<string, (s: CoreEvents["face.job"]) => void>();
  const broadcast = (<E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => {
    events.push({ event, payload });
    if (event === "face.job") {
      const s = payload as CoreEvents["face.job"];
      if (["done", "error", "cancelled"].includes(s.state)) terminals.get(s.jobId)?.(s);
    }
  }) as <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;
  const store = new FaceStore(opts.repo ?? memRepo());
  const service = new FaceService({
    dataDir: dir,
    store,
    ops: opts.ops ?? recordingOps([]),
    broadcast,
    toolchainProbe: READY_PROBE,
    generateProbe: READY_GEN_PROBE,
  });
  const waitFor = (jobId: string): Promise<CoreEvents["face.job"]> =>
    new Promise((resolve) => terminals.set(jobId, resolve));
  return { service, store, events, waitFor, dir };
}

/* ------------------------------- toolchain -------------------------------- */

test("evaluateGenerateToolchain ready only when all present, else names each gap", () => {
  assert.deepEqual(evaluateGenerateToolchain(READY_GEN_PROBE), { state: "ready" });
  const noBin = evaluateGenerateToolchain({ ...READY_GEN_PROBE, hasZTurboBin: () => false });
  assert.match(noBin.detail!, /mflux/);
  const noW = evaluateGenerateToolchain({ ...READY_GEN_PROBE, hasZTurboWeights: () => false });
  assert.match(noW.detail!, /weights/);
});

/* --------------------------------- catalog -------------------------------- */

test("serializeCatalog exposes 10 entries with the core four required", () => {
  const cat = serializeCatalog();
  assert.equal(cat.length, 10);
  const required = cat.filter((e) => e.required).map((e) => e.key).sort();
  assert.deepEqual(required, ["blink", "m1", "m2", "m3"]);
  for (const e of cat) assert.ok(e.prompt.length > 0, `${e.key} has a prefill prompt`);
});

test("buildGeneratedConfig assembles blink+talk plus chosen emotions/customs", () => {
  const config = buildGeneratedConfig({
    presetId: "face-zara",
    name: "Zara",
    accent: "#334455",
    now: "t0",
    emotions: ["smile", "think"],
    customs: [{ clipId: "wink", name: "Wink" }],
    generation: {
      method: "z-turbo-t2i",
      characterPrompt: "c",
      baseSeed: 7,
      regions: {
        mouth: { x: 1, y: 1, width: 1, height: 1 },
        eyes: { x: 1, y: 1, width: 1, height: 1 },
        face: { x: 1, y: 1, width: 1, height: 1 },
      },
      regionSource: "default",
      expressions: [],
    },
  });
  const ids = config.animations.map((c) => c.id).sort();
  assert.deepEqual(ids, ["blink", "smile", "talk", "think", "wink"].sort());
  assert.ok(config.generation, "generation meta embedded");
  // The custom clip gets a synthesized manual trigger.
  assert.ok(config.triggers.some((t) => t.animationId === "wink" && t.kind === "manual"));
});

/* -------------------------------- validators ------------------------------ */

test("validateGenerateInput accepts a good payload and rejects the 422 matrix", () => {
  const ok = validateGenerateInput(READY_GEN_INPUT());
  assert.equal(ok.name, "Zara");
  assert.equal(ok.expressions.length, 1);

  const bad = (payload: unknown) =>
    assert.throws(() => validateGenerateInput(payload), FaceValidationError);
  bad({ ...READY_GEN_INPUT(), name: "" });
  bad({ ...READY_GEN_INPUT(), characterPrompt: "" });
  bad({ ...READY_GEN_INPUT(), expressions: [{ key: "nope" }] }); // unknown catalog key
  bad({ ...READY_GEN_INPUT(), expressions: [{ id: "cst", name: "C", prompt: "p", group: "custom" }] }); // custom needs region
  // both base sources / neither base source
  bad({ ...READY_GEN_INPUT(), baseHistoryId: "h1" }); // dataUri + history both present
  bad({ name: "Z", characterPrompt: "c", expressions: [] }); // no base at all
  // region outside the 1024 canvas
  bad({ ...READY_GEN_INPUT(), regions: { mouth: { x: 900, y: 0, width: 200, height: 50 } } });
});

test("validateAddExpressionInput handles catalog keys, customs, replace + trigger", () => {
  assert.equal(validateAddExpressionInput({ key: "smile" }).key, "smile");
  const custom = validateAddExpressionInput({
    id: "wink",
    name: "Wink",
    prompt: "a quick wink",
    group: "custom",
    region: { x: 400, y: 300, width: 120, height: 90 },
  });
  assert.equal(custom.id, "wink");
  const replace = validateAddExpressionInput({ key: "smile", replaceClipId: "smile" });
  assert.equal(replace.replaceClipId, "smile");
  const withTrigger = validateAddExpressionInput({
    key: "think",
    trigger: { id: "think-evt", animationId: "ignored", kind: "manual", enabled: true },
  });
  assert.equal(withTrigger.trigger!.animationId, "think", "trigger retargeted to the clip");

  assert.throws(() => validateAddExpressionInput({}), FaceValidationError); // no key/id
  assert.throws(
    () => validateAddExpressionInput({ id: "c", name: "C", prompt: "p", group: "custom" }),
    FaceValidationError,
  ); // custom without region
});

/* --------------------------- detect JSON parsing -------------------------- */

test("parseDetect reads an auto region, falls back on junk or bad shapes", () => {
  const fb: FaceRegion = { x: 10, y: 20, width: 30, height: 40 };
  const auto = parseDetect('drift corrected: dx=1 dy=0\n{"x":100,"y":110,"width":80,"height":60,"source":"auto"}', fb);
  assert.deepEqual(auto, { region: { x: 100, y: 110, width: 80, height: 60 }, source: "auto" });
  const fell = parseDetect('{"x":5,"y":5,"width":10,"height":10,"source":"default"}', fb);
  assert.equal(fell.source, "default");
  assert.deepEqual(parseDetect("nothing here", fb), { region: fb, source: "default" });
  assert.deepEqual(parseDetect('{"x":1,"y":1,"width":0,"height":5}', fb), { region: fb, source: "default" });
});

/* ------------------------- resolve + runner (resume) ---------------------- */

test("resolveGenerateExpressions always includes the core 4 then chosen extras", () => {
  const list = resolveGenerateExpressions(READY_GEN_INPUT({ expressions: [{ key: "smile" }, { id: "wink", name: "Wink", prompt: "p", group: "custom", region: { x: 1, y: 1, width: 1, height: 1 } }] }), 42);
  const keys = list.map((e) => e.key);
  for (const core of ["m1", "m2", "m3", "blink"]) assert.ok(keys.includes(core));
  assert.ok(keys.includes("smile"));
  assert.ok(keys.includes("wink"));
  assert.equal(list.length, 6);
  assert.ok(list.every((e) => e.seed === 42), "every frame reuses the base seed");
});

test("runGeneratePresetJob skips staged frames (resume) and writes all art", async () => {
  const dir = tmpDir();
  try {
    const art = presetDir(dir, "face-zara");
    const work = workDir(dir, "face-zara");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "base.png"), "png");
    writeFileSync(join(work, "accent.json"), JSON.stringify({ accent: "#123456" }));
    writeFileSync(join(work, "gen-m2-42.png"), "png");
    const calls: string[] = [];
    const expressions = resolveGenerateExpressions(READY_GEN_INPUT(), 42);
    const res = await runGeneratePresetJob({
      ops: recordingOps(calls),
      presetId: "face-zara",
      name: "Zara",
      characterPrompt: "c",
      baseSeed: 42,
      baseImagePath: join(work, "base-src"),
      expressions,
      artDir: art,
      workDir: work,
      now: "t0",
      signal: new AbortController().signal,
      report: () => {},
    });
    assert.equal(res.accent, "#123456", "accent read from cache, base prep skipped");
    assert.ok(!calls.includes("normbase"), "base prep skipped (base.png present)");
    assert.ok(!calls.includes("accent"), "accent skipped (accent.json present)");
    assert.ok(!calls.includes("gen:m2"), "m2 skipped (already generated)");
    assert.ok(calls.includes("gen:blink") && calls.includes("gen:smile"));
    assert.equal(res.config.generation!.method, "z-turbo-t2i");
    assert.equal(res.config.generation!.expressions.length, expressions.length);
    for (const f of ["portrait-base.webp", "portrait-m1.webp", "portrait-blink.webp", "anim-smile-0.webp"]) {
      assert.ok(existsSync(join(art, f)), `${f} written`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------ job lifecycle ----------------------------- */

test("startGenerate runs to done: preset persisted with generation meta", async () => {
  const h = genHarness();
  try {
    const status = h.service.startGenerate(READY_GEN_INPUT());
    assert.equal(status.kind, "generate");
    assert.equal(status.totalFrames, 5, "core 4 + smile");
    const final = await h.waitFor(status.jobId);
    assert.equal(final.state, "done");
    assert.ok(!h.service.isBusy());
    const presets = h.service.listCustom();
    assert.equal(presets.length, 1);
    const cfg = presets[0]!.config;
    assert.ok(cfg.generation, "generation meta persisted");
    assert.equal(cfg.generation!.method, "z-turbo-t2i");
    assert.ok(cfg.animations.some((c) => c.id === "smile"));
    // Done-GC: heavy intermediates dropped, base + provenance kept for resume checks.
    const work = workDir(h.dir, status.presetId);
    assert.ok(existsSync(join(work, "base.png")), "base survives GC");
    assert.ok(existsSync(join(work, "source.json")), "signature survives GC");
    assert.ok(
      !readdirSync(work).some((f) => f.startsWith("gen-") || f.startsWith("comp-")),
      "gen/comp intermediates GC'd after done",
    );
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("startGenerate cancel keeps the work dir for resume", async () => {
  const h = genHarness({ ops: recordingOps([], { hangEdits: true }) });
  try {
    const status = h.service.startGenerate(READY_GEN_INPUT());
    await new Promise((r) => setTimeout(r, 10));
    h.service.cancel(status.jobId);
    const final = await h.waitFor(status.jobId);
    assert.equal(final.state, "cancelled");
    assert.ok(!h.service.isBusy());
    assert.ok(existsSync(join(workDir(h.dir, status.presetId), "base.png")), "partial work survives");
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("startAddExpression appends a t2i clip and updateConfig preserves the meta", async () => {
  const h = genHarness();
  try {
    const gen = h.service.startGenerate(READY_GEN_INPUT());
    const done = await h.waitFor(gen.jobId);
    const id = done.presetId;

    const add = h.service.startAddExpression(id, { key: "think" });
    assert.equal(add.kind, "expression");
    const addDone = await h.waitFor(add.jobId);
    assert.equal(addDone.state, "done");

    const afterAdd = parseConfig(h.store.get(id)!);
    assert.ok(afterAdd.animations.some((c) => c.id === "think"), "think clip appended");
    assert.ok(afterAdd.generation!.expressions.some((e) => e.clipId === "think"), "meta entry appended");

    // Editor save (frames-only) must carry the generation meta forward.
    const saved = h.service.updateConfig(id, {
      animations: afterAdd.animations,
      triggers: afterAdd.triggers,
    });
    assert.ok(saved.config.generation, "generation meta survives the editor save");
    assert.equal(parseConfig(h.store.get(id)!).generation!.method, "z-turbo-t2i");
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("startAddExpression with replaceClipId regenerates a clip in place", async () => {
  const h = genHarness();
  try {
    const gen = h.service.startGenerate(READY_GEN_INPUT());
    const done = await h.waitFor(gen.jobId);
    const id = done.presetId;
    const before = parseConfig(h.store.get(id)!);
    const smileBefore = before.generation!.expressions.find((e) => e.clipId === "smile")!;

    const rip = h.service.startAddExpression(id, { key: "smile", replaceClipId: "smile" });
    await h.waitFor(rip.jobId);

    const after = parseConfig(h.store.get(id)!);
    assert.equal(
      after.animations.filter((c) => c.id === "smile").length,
      1,
      "no duplicate clip added on regenerate",
    );
    const smileAfter = after.generation!.expressions.find((e) => e.clipId === "smile")!;
    assert.notEqual(smileAfter.seed, smileBefore.seed, "regenerated with a fresh seed");
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

/* --------------------------------- routes --------------------------------- */

test("GET /faces/catalog returns the 10 proven expressions", async () => {
  const { app, dir } = await routeApp({});
  const res = await app.inject({ method: "GET", url: "/faces/catalog" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().length, 10);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("POST /faces/custom/generate 503 when the z-turbo toolchain is missing", async () => {
  const { app, dir } = await routeApp({ generateProbe: { ...READY_GEN_PROBE, hasZTurboWeights: () => false } });
  const res = await app.inject({ method: "POST", url: "/faces/custom/generate", payload: READY_GEN_INPUT() });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().detail, /weights/);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("POST /faces/custom/generate 422 on invalid input", async () => {
  const { app, dir } = await routeApp({});
  const res = await app.inject({
    method: "POST",
    url: "/faces/custom/generate",
    payload: { ...READY_GEN_INPUT(), expressions: [{ key: "nope" }] },
  });
  assert.equal(res.statusCode, 422);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("POST /faces/custom/generate 409 while an Image Lab job holds the GPU (cross-busy)", async () => {
  const { app, dir } = await routeApp({ isImageGenBusy: () => true });
  const res = await app.inject({ method: "POST", url: "/faces/custom/generate", payload: READY_GEN_INPUT() });
  assert.equal(res.statusCode, 409);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("POST /faces/custom/:id/expressions 404 for an unknown preset", async () => {
  const { app, dir } = await routeApp({});
  const res = await app.inject({
    method: "POST",
    url: "/faces/custom/face-nope/expressions",
    payload: { key: "smile" },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/* ------------- config-update frame caps (video→clip import sizes) ------------- */

function spriteClip(id: string, frameCount: number) {
  return {
    id,
    name: id,
    category: "gesture",
    appliesTo: "portrait",
    renderKind: "sprite",
    track: "main",
    driver: "time",
    loopMode: "once",
    priority: 30,
    durationMs: 5000,
    frames: Array.from({ length: frameCount }, (_, i) => `anim-${id}-${i}.webp`),
  };
}

test("validateConfigUpdate accepts a 121-frame clip (whole LTX video)", () => {
  const input = validateConfigUpdate({ animations: [spriteClip("wave", 121)], triggers: [] });
  assert.equal(input.animations[0]!.frames!.length, 121);
  assert.equal(input.animations[0]!.durationMs, 5000);
});

test("validateConfigUpdate rejects a clip past the 121-frame cap", () => {
  assert.throws(
    () => validateConfigUpdate({ animations: [spriteClip("wave", 122)], triggers: [] }),
    /1-121/,
  );
});

test("validateConfigUpdate rejects a preset past the 512-frame total", () => {
  const clips = ["a", "b", "c", "d", "e"].map((id) => spriteClip(id, 121)); // 605 total
  assert.throws(() => validateConfigUpdate({ animations: clips, triggers: [] }), /max 512/);
  const four = ["a", "b", "c", "d"].map((id) => spriteClip(id, 121)); // 484 total
  assert.equal(validateConfigUpdate({ animations: four, triggers: [] }).animations.length, 4);
});
