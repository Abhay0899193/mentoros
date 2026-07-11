import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import type { CoreEvents, VideoGenRequest } from "../types.js";
import { findModelDef } from "./models.js";
import { validateGenerateInput, VideoGenValidationError } from "./validate.js";
import { parseProgress, createFakeVideoGenOps, VideoGenAbortError, type VideoGenOps } from "./ops.js";
import { buildModelInfos } from "./models.js";
import { VideoGenService } from "./service.js";
import { registerVideoGenRoutes } from "./routes.js";
import { videogenArtDir } from "./paths.js";
import type { VideoGenToolchainProbe } from "./toolchain.js";
import type { VideoGenHistoryRow, VideoGenRepo } from "./store.js";

const LTX = findModelDef("ltx-local")!;

const READY_PROBE: VideoGenToolchainProbe = {
  hasGenerateBin: () => true,
  hasModelWeights: () => true,
  hasEncoderWeights: () => true,
};

/* ------------------------------ test doubles ------------------------------ */

function memRepo(): VideoGenRepo {
  const rows: VideoGenHistoryRow[] = [];
  return {
    insert: (row) => rows.unshift({ ...row }),
    list: () => rows.map((r) => ({ ...r })),
    get: (id) => {
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    delete: (id) => {
      const i = rows.findIndex((x) => x.id === id);
      if (i >= 0) {
        rows.splice(i, 1);
        return true;
      }
      return false;
    },
  };
}

/** An op that never resolves until aborted (for cancel tests). */
function hangingOps(): VideoGenOps {
  return {
    generate: (_inv, _report, signal) =>
      new Promise<void>((_res, rej) => {
        if (signal.aborted) return rej(new VideoGenAbortError());
        signal.addEventListener("abort", () => rej(new VideoGenAbortError()), { once: true });
      }),
  };
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "videogen-test-"));
}

interface Harness {
  service: VideoGenService;
  events: Array<{ event: keyof CoreEvents; payload: unknown }>;
  waitFor: (id: string) => Promise<CoreEvents["videogen.job"]>;
  dir: string;
}

function harness(opts: { repo?: VideoGenRepo; ops?: VideoGenOps } = {}): Harness {
  const dir = tmpDir();
  const events: Array<{ event: keyof CoreEvents; payload: unknown }> = [];
  const terminals = new Map<string, (s: CoreEvents["videogen.job"]) => void>();
  const broadcast = (<E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => {
    events.push({ event, payload });
    if (event === "videogen.job") {
      const s = payload as CoreEvents["videogen.job"];
      if (["done", "error", "cancelled"].includes(s.state)) terminals.get(s.id)?.(s);
    }
  }) as <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;
  const service = new VideoGenService({
    dataDir: dir,
    repo: opts.repo ?? memRepo(),
    broadcast,
    probe: READY_PROBE,
    ops: opts.ops ?? createFakeVideoGenOps(),
  });
  const waitFor = (id: string): Promise<CoreEvents["videogen.job"]> =>
    new Promise((resolve) => terminals.set(id, resolve));
  return { service, events, waitFor, dir };
}

async function routeApp(over: {
  repo?: VideoGenRepo;
  ops?: VideoGenOps;
  probe?: VideoGenToolchainProbe;
  isImageGenBusy?: () => boolean;
  isFacesBusy?: () => boolean;
  dir?: string;
} = {}) {
  const dir = over.dir ?? tmpDir();
  const broadcast = (() => {}) as <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;
  const service = new VideoGenService({
    dataDir: dir,
    repo: over.repo ?? memRepo(),
    broadcast,
    probe: over.probe ?? READY_PROBE,
    ops: over.ops ?? createFakeVideoGenOps(),
  });
  const app = Fastify();
  registerVideoGenRoutes(app, {
    service,
    ...(over.isImageGenBusy ? { isImageGenBusy: over.isImageGenBusy } : {}),
    ...(over.isFacesBusy ? { isFacesBusy: over.isFacesBusy } : {}),
    dataDir: dir,
  });
  await app.ready();
  return { app, service, dir };
}

function goodInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { modelId: "ltx-local", prompt: "a calm ocean at dawn", ...over };
}

/* ------------------------------- validation ------------------------------- */

test("validateGenerateInput fills defaults and echoes a good payload", () => {
  const req = validateGenerateInput(goodInput(), LTX);
  assert.equal(req.prompt, "a calm ocean at dawn");
  assert.equal(req.width, 512);
  assert.equal(req.height, 512);
  assert.equal(req.numFrames, 49);
  assert.equal(req.fps, 24);
  assert.equal(req.randomizeSeed, false);
});

test("validateGenerateInput rejects the 422 matrix", () => {
  const bad = (payload: unknown) =>
    assert.throws(() => validateGenerateInput(payload, LTX), VideoGenValidationError);
  bad(goodInput({ prompt: "   " })); // empty prompt
  bad(goodInput({ prompt: "x".repeat(2001) })); // too long
  bad(goodInput({ width: 100 })); // not a multiple of 64
  bad(goodInput({ height: 300 })); // not a multiple of 64
  bad(goodInput({ numFrames: 10 })); // not 1 + 8k
  bad(goodInput({ seed: -1 })); // not a uint32
  bad(goodInput({ image: "data:image/gif;base64,AAAA" })); // unsupported mime
});

test("validateGenerateInput clamps out-of-range dims/frames and accepts an I2V image", () => {
  const req = validateGenerateInput(
    goodInput({ width: 2048, height: 128, numFrames: 201, fps: 60, image: "data:image/png;base64,AAAA" }),
    LTX,
  );
  assert.equal(req.width, 1024, "clamped to max");
  assert.equal(req.height, 256, "clamped to min");
  assert.equal(req.numFrames, 121, "clamped to max (still 1+8k)");
  assert.equal(req.fps, 30, "clamped to max fps");
  assert.equal(req.image, "data:image/png;base64,AAAA");
});

/* -------------------------------- models ---------------------------------- */

test("buildModelInfos gates ltx-local on the full toolchain and names gaps", () => {
  const ready = buildModelInfos({ probe: READY_PROBE });
  assert.equal(ready.length, 1);
  assert.equal(ready[0]!.id, "ltx-local");
  assert.equal(ready[0]!.available, true);
  assert.equal(ready[0]!.supportsImageInput, true);

  const noBin = buildModelInfos({ probe: { ...READY_PROBE, hasGenerateBin: () => false } });
  assert.equal(noBin[0]!.available, false);
  assert.match(noBin[0]!.detail!, /mlx-video/);
  const noWeights = buildModelInfos({ probe: { ...READY_PROBE, hasModelWeights: () => false } });
  assert.match(noWeights[0]!.detail!, /LTX-2\.3 weights/);
  const noEnc = buildModelInfos({ probe: { ...READY_PROBE, hasEncoderWeights: () => false } });
  assert.match(noEnc[0]!.detail!, /encoder/);
});

/* ------------------------------- progress --------------------------------- */

test("parseProgress maps the two-stage output to a monotonic 0..1 fraction", () => {
  assert.equal(parseProgress(""), null); // blank → null
  const s1 = parseProgress("STAGE:1:STEP:4:8:Denoising")!;
  assert.ok(Math.abs(s1.progress! - 0.35) < 1e-9, "stage 1 halfway → 0.35");
  const s2 = parseProgress("STAGE:2:STEP:3:3:Refining")!;
  assert.equal(s2.progress, 1, "stage 2 complete → 1");
  const plain = parseProgress("Loading model…")!;
  assert.equal(plain.progress, undefined);
  assert.equal(plain.detail, "Loading model…");
});

/* ------------------------------ job lifecycle ----------------------------- */

test("VideoGenService runs a job to done: history row, mp4 on disk, monotonic progress", async () => {
  const repo = memRepo();
  const h = harness({ repo });
  try {
    const queued = h.service.generate(validateGenerateInput(goodInput({ seed: 7 }), LTX));
    assert.equal(queued.state, "queued");
    assert.ok(h.service.isBusy());

    const final = await h.waitFor(queued.id);
    assert.equal(final.state, "done");
    assert.equal(final.progress, 1);
    assert.ok(!h.service.isBusy(), "not busy after completion");
    assert.equal(final.result!.seedUsed, 7);

    // mp4 landed on disk under the art dir.
    assert.ok(existsSync(join(videogenArtDir(h.dir), `${queued.id}.mp4`)), "mp4 written");

    // history row persisted.
    const hist = h.service.history();
    assert.equal(hist.length, 1);
    assert.equal(hist[0]!.id, queued.id);
    assert.equal(hist[0]!.seed, 7);
    assert.equal(hist[0]!.hasSourceImage, false);
    assert.equal(hist[0]!.url, `/videogen/art/${queued.id}.mp4`);

    // progress never rewinds and ends at 1.
    const progresses = h.events
      .filter((e) => e.event === "videogen.job")
      .map((e) => (e.payload as CoreEvents["videogen.job"]).progress)
      .filter((p): p is number => p !== undefined);
    for (let i = 1; i < progresses.length; i += 1) {
      assert.ok(progresses[i]! >= progresses[i - 1]!, "progress is monotonic");
    }
    assert.equal(progresses[progresses.length - 1], 1);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("VideoGenService single-flight throws while a job is running", async () => {
  const h = harness({ ops: hangingOps() });
  try {
    const first = h.service.generate(validateGenerateInput(goodInput(), LTX));
    assert.throws(() => h.service.generate(validateGenerateInput(goodInput(), LTX)));
    h.service.cancel(first.id);
    await h.waitFor(first.id);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("VideoGenService cancel ends 'cancelled' with no history and no mp4", async () => {
  const h = harness({ ops: hangingOps() });
  try {
    const q = h.service.generate(validateGenerateInput(goodInput(), LTX));
    await new Promise((r) => setTimeout(r, 10));
    h.service.cancel(q.id);
    const final = await h.waitFor(q.id);
    assert.equal(final.state, "cancelled");
    assert.equal(final.error, "cancelled");
    assert.ok(!h.service.isBusy());
    assert.equal(h.service.history().length, 0, "no history on cancel");
    assert.ok(!existsSync(join(videogenArtDir(h.dir), `${q.id}.mp4`)), "no lingering mp4");
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test("historyVideoPath + deleteHistory resolve and remove a finished clip", async () => {
  const h = harness();
  try {
    const q = h.service.generate(validateGenerateInput(goodInput(), LTX));
    await h.waitFor(q.id);
    const path = h.service.historyVideoPath(q.id);
    assert.ok(path && existsSync(path), "resolves to the on-disk mp4");
    assert.equal(h.service.deleteHistory(q.id), true);
    assert.equal(h.service.history().length, 0);
    assert.ok(!existsSync(path!), "mp4 removed on delete");
    assert.equal(h.service.deleteHistory("nope"), false, "unknown id → false");
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

/* --------------------------------- routes --------------------------------- */

test("POST /videogen/generate 422 on bad input, 503 when unavailable", async () => {
  const bad = await routeApp({});
  const res422 = await bad.app.inject({ method: "POST", url: "/videogen/generate", payload: goodInput({ numFrames: 10 }) });
  assert.equal(res422.statusCode, 422);
  await bad.app.close();
  rmSync(bad.dir, { recursive: true, force: true });

  const unavailable = await routeApp({ probe: { ...READY_PROBE, hasModelWeights: () => false } });
  const res503 = await unavailable.app.inject({ method: "POST", url: "/videogen/generate", payload: goodInput() });
  assert.equal(res503.statusCode, 503);
  assert.match(res503.json().detail, /weights/);
  await unavailable.app.close();
  rmSync(unavailable.dir, { recursive: true, force: true });
});

test("POST /videogen/generate 409 single-flight and returns {job}", async () => {
  const { app, service, dir } = await routeApp({ ops: hangingOps() });
  const first = await app.inject({ method: "POST", url: "/videogen/generate", payload: goodInput() });
  assert.equal(first.statusCode, 200);
  const jobId = first.json().job.id as string;
  assert.ok(jobId, "returns { job }");
  assert.ok(service.isBusy());
  const second = await app.inject({ method: "POST", url: "/videogen/generate", payload: goodInput() });
  assert.equal(second.statusCode, 409);
  service.cancel(jobId);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("POST /videogen/generate 409 cross-busy when Image Lab OR faces holds the GPU", async () => {
  const img = await routeApp({ isImageGenBusy: () => true });
  const r1 = await img.app.inject({ method: "POST", url: "/videogen/generate", payload: goodInput() });
  assert.equal(r1.statusCode, 409);
  await img.app.close();
  rmSync(img.dir, { recursive: true, force: true });

  const face = await routeApp({ isFacesBusy: () => true });
  const r2 = await face.app.inject({ method: "POST", url: "/videogen/generate", payload: goodInput() });
  assert.equal(r2.statusCode, 409);
  await face.app.close();
  rmSync(face.dir, { recursive: true, force: true });
});

test("history + cancel routes: list, delete 204/404, cancel 204", async () => {
  const { app, service, dir } = await routeApp({});
  const gen = await app.inject({ method: "POST", url: "/videogen/generate", payload: goodInput() });
  const jobId = gen.json().job.id as string;
  // Fake op resolves synchronously-ish; poll the job until done.
  let done = false;
  for (let i = 0; i < 50 && !done; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
    const j = await app.inject({ method: "GET", url: `/videogen/jobs/${jobId}` });
    done = j.json().state === "done";
  }
  assert.ok(done, "job reached done");
  assert.equal(service.history().length, 1);

  const list = await app.inject({ method: "GET", url: "/videogen/history" });
  assert.equal(list.json().length, 1);

  const cancel = await app.inject({ method: "POST", url: `/videogen/jobs/${jobId}/cancel` });
  assert.equal(cancel.statusCode, 204);

  const delOk = await app.inject({ method: "DELETE", url: `/videogen/history/${jobId}` });
  assert.equal(delOk.statusCode, 204);
  const delMiss = await app.inject({ method: "DELETE", url: "/videogen/history/nope" });
  assert.equal(delMiss.statusCode, 404);

  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/* --------------------------- art range streaming -------------------------- */

const ART_FILE = "00000000-0000-0000-0000-000000000001.mp4";

async function artApp(size = 1000) {
  const { app, dir } = await routeApp({});
  const artDir = videogenArtDir(dir);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(artDir, { recursive: true });
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) buf[i] = i % 251;
  writeFileSync(join(artDir, ART_FILE), buf);
  return { app, dir, size };
}

test("GET /videogen/art serves the full mp4 with Accept-Ranges", async () => {
  const { app, dir, size } = await artApp();
  const res = await app.inject({ method: "GET", url: `/videogen/art/${ART_FILE}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "video/mp4");
  assert.equal(res.headers["accept-ranges"], "bytes");
  assert.equal(res.headers["content-length"], String(size));
  assert.match(res.headers["cache-control"] as string, /immutable/);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("GET /videogen/art honors a byte Range with 206 + Content-Range", async () => {
  const { app, dir, size } = await artApp();
  const res = await app.inject({
    method: "GET",
    url: `/videogen/art/${ART_FILE}`,
    headers: { range: "bytes=0-99" },
  });
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["content-range"], `bytes 0-99/${size}`);
  assert.equal(res.headers["content-length"], "100");
  assert.equal(res.rawPayload.length, 100);

  // Open-ended + clamped-past-end range.
  const tailRes = await app.inject({
    method: "GET",
    url: `/videogen/art/${ART_FILE}`,
    headers: { range: "bytes=990-5000" },
  });
  assert.equal(tailRes.statusCode, 206);
  assert.equal(tailRes.headers["content-range"], `bytes 990-999/${size}`);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test("GET /videogen/art returns 416 for an unsatisfiable range, 404 on traversal", async () => {
  const { app, dir, size } = await artApp();
  const res416 = await app.inject({
    method: "GET",
    url: `/videogen/art/${ART_FILE}`,
    headers: { range: "bytes=5000-6000" },
  });
  assert.equal(res416.statusCode, 416);
  assert.equal(res416.headers["content-range"], `bytes */${size}`);

  const traversal = await app.inject({ method: "GET", url: "/videogen/art/..%2f..%2fsecret" });
  assert.equal(traversal.statusCode, 404);
  const missing = await app.inject({ method: "GET", url: `/videogen/art/00000000-0000-0000-0000-0000000000ff.mp4` });
  assert.equal(missing.statusCode, 404);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

// A validated request round-trips through the service unchanged (type guard).
const _typeCheck: VideoGenRequest = validateGenerateInput(goodInput(), LTX);
void _typeCheck;
