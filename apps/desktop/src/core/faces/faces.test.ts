import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { computeCrop, ellipseFor } from "./crop.js";
import { evaluateToolchain, type ToolchainProbe } from "./toolchain.js";
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
import { synthesizeLegacyConfig, validateManualInput } from "./config.js";
import { FaceAbortError, type FaceOps } from "./ops.js";
import { runFaceJob } from "./runner.js";
import { FaceService, type ActiveFaceSettings } from "./service.js";
import { registerFaceRoutes } from "./routes.js";
import { presetDir, workDir } from "./paths.js";
import { SettingsStore, type SettingsKv } from "../settings/store.js";
import type { AppSettings, CoreEvents, CreateFacePresetInput, FaceRegion } from "../types.js";

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
  return {
    async prepBase(_p, _c, out) {
      calls.push("prep");
      writeFileSync(out, "png");
      return { accent: "#3366aa" };
    },
    async kontextEdit(_in, out, _prompt, _seed, signal) {
      const key = /kontext-(\w+)\.png$/.exec(out)?.[1] ?? "?";
      if (signal.aborted) throw new FaceAbortError();
      if (opts.failOn === key) throw new Error(`boom ${key}`);
      if (opts.hangEdits) {
        await new Promise<void>((_res, rej) => {
          signal.addEventListener("abort", () => rej(new FaceAbortError()), { once: true });
        });
      }
      calls.push(`edit:${key}`);
      writeFileSync(out, "png");
    },
    async composite(_b, _e, _ell, out) {
      calls.push("composite");
      writeFileSync(out, "png");
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
  imageProbe?: ImageProbe;
  ops?: FaceOps;
  settings?: ActiveFaceSettings;
  repo?: FaceRepo;
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
    ...(over.settings ? { settings: over.settings } : {}),
  });
  const app = Fastify();
  registerFaceRoutes(app, {
    service,
    broadcast,
    probe: over.imageProbe ?? okImageProbe,
    getSettings: () => ({ mentorFace: over.settings?.get().mentorFace ?? "aura" }) as AppSettings,
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
