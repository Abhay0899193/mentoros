import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { LanTokenStore, registerNetwork, type NetworkDeps } from "./network.js";
import type { KeyKv } from "./llm/keys.js";

/**
 * In-memory KeyKv — mirrors SqliteKeyKv semantics (incl. deleteKeys) without the
 * native better-sqlite3 addon (the test node is x86_64/Rosetta; the addon is
 * arm64). Production wiring is covered by createNetworkSystem.
 */
function memKv(): KeyKv {
  const map = new Map<string, string>();
  return {
    readAll: () => [...map].map(([key, value]) => ({ key, value })),
    writeMany: (entries) => {
      for (const [key, value] of entries) map.set(key, value);
    },
    deleteKeys: (keys) => {
      for (const k of keys) map.delete(k);
    },
  };
}

interface Harness {
  app: FastifyInstance;
  store: LanTokenStore;
  setLan: (v: boolean) => void;
  rendererDir: string;
}

function harness(opts: { lanEnabled?: boolean; rendererDir?: string } = {}): Harness {
  const app = Fastify({ logger: false });
  const store = new LanTokenStore(memKv());
  let lanEnabled = opts.lanEnabled ?? false;
  const rendererDir = opts.rendererDir ?? "/nonexistent-renderer";
  const deps: NetworkDeps = {
    tokenStore: store,
    getPort: () => 4820,
    rendererDir,
    get lanEnabled() {
      return lanEnabled;
    },
  } as NetworkDeps;
  registerNetwork(app, deps);
  return { app, store, setLan: (v) => (lanEnabled = v), rendererDir };
}

const REMOTE = "192.168.1.50";

/* ------------------------------ token store ---------------------------- */

test("LanTokenStore: null until ensured, then stable + persisted", () => {
  const store = new LanTokenStore(memKv());
  assert.equal(store.getToken(), null);
  const t = store.ensureToken();
  assert.match(t, /^[0-9a-f]{32}$/);
  assert.equal(store.ensureToken(), t); // idempotent
  assert.equal(store.getToken(), t);
  store.clear();
  assert.equal(store.getToken(), null);
});

/* ------------------------------- auth hook ----------------------------- */

test("auth: loopback without a token still passes", async () => {
  const { app } = harness();
  const res = await app.inject({ method: "GET", url: "/health", remoteAddress: "127.0.0.1" });
  // No /health route here, but the hook let it through → 404 (not 401).
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("auth: non-loopback with no token stored → 401", async () => {
  const { app } = harness();
  const res = await app.inject({ method: "GET", url: "/", remoteAddress: REMOTE });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: "unauthorized" });
  await app.close();
});

test("auth: non-loopback with a token but no credential → 401", async () => {
  const { app, store } = harness();
  store.ensureToken();
  const res = await app.inject({ method: "GET", url: "/", remoteAddress: REMOTE });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("auth: header token authenticates a non-loopback request", async () => {
  const { app, store } = harness();
  const token = store.ensureToken();
  const res = await app.inject({
    method: "GET",
    url: "/",
    remoteAddress: REMOTE,
    headers: { "x-mentoros-token": token },
  });
  // Renderer dir missing → 404, but auth passed (would be 401 otherwise).
  assert.equal(res.statusCode, 404);
  assert.equal(res.body, "renderer not built");
  await app.close();
});

test("auth: query token authenticates and sets the mentoros_token cookie", async () => {
  const { app, store } = harness();
  const token = store.ensureToken();
  const res = await app.inject({
    method: "GET",
    url: `/?token=${token}`,
    remoteAddress: REMOTE,
  });
  assert.equal(res.statusCode, 404); // renderer missing
  const setCookie = res.headers["set-cookie"];
  assert.ok(typeof setCookie === "string" && setCookie.includes(`mentoros_token=${token}`));
  assert.ok((setCookie as string).includes("SameSite=Lax"));
  await app.close();
});

test("auth: cookie token authenticates without re-setting the cookie", async () => {
  const { app, store } = harness();
  const token = store.ensureToken();
  const res = await app.inject({
    method: "GET",
    url: "/",
    remoteAddress: REMOTE,
    headers: { cookie: `mentoros_token=${token}` },
  });
  assert.equal(res.statusCode, 404); // renderer missing → auth passed
  assert.equal(res.headers["set-cookie"], undefined);
  await app.close();
});

test("auth: a wrong token is rejected", async () => {
  const { app, store } = harness();
  store.ensureToken();
  const res = await app.inject({
    method: "GET",
    url: "/?token=deadbeef",
    remoteAddress: REMOTE,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

/* ----------------------------- access-info ----------------------------- */

test("access-info: non-loopback is 403 even with a valid token", async () => {
  const { app, store } = harness({ lanEnabled: true });
  const token = store.ensureToken();
  const res = await app.inject({
    method: "GET",
    url: "/network/access-info",
    remoteAddress: REMOTE,
    headers: { "x-mentoros-token": token },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("access-info: lanAccess=false keeps the token null and urls empty", async () => {
  const { app } = harness({ lanEnabled: false });
  const res = await app.inject({ method: "GET", url: "/network/access-info" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    lanAccess: boolean;
    port: number;
    ips: string[];
    token: string | null;
    urls: string[];
  };
  assert.equal(body.lanAccess, false);
  assert.equal(body.token, null);
  assert.deepEqual(body.urls, []);
  assert.equal(body.port, 4820);
  assert.ok(Array.isArray(body.ips));
  await app.close();
});

test("access-info: lanAccess=true lazily generates a token that persists across calls", async () => {
  const { app, store } = harness({ lanEnabled: true });
  assert.equal(store.getToken(), null);
  const first = (await app.inject({ method: "GET", url: "/network/access-info" })).json() as {
    token: string | null;
    urls: string[];
  };
  assert.match(first.token ?? "", /^[0-9a-f]{32}$/);
  assert.equal(store.getToken(), first.token);
  const second = (await app.inject({ method: "GET", url: "/network/access-info" })).json() as {
    token: string | null;
  };
  assert.equal(second.token, first.token); // stable
  // urls reference the token when present.
  for (const url of first.urls) assert.ok(url.includes(`token=${first.token}`));
  await app.close();
});

/* ------------------------------ static ---------------------------------- */

test("static: serves index.html and assets with correct types + ETag/304", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mentoros-renderer-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>MentorOS</title>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log('hi')");
  const { app } = harness({ rendererDir: dir });
  try {
    const index = await app.inject({ method: "GET", url: "/" });
    assert.equal(index.statusCode, 200);
    assert.match(String(index.headers["content-type"]), /text\/html/);
    const etag = index.headers.etag as string;
    assert.ok(etag);

    const notMod = await app.inject({
      method: "GET",
      url: "/",
      headers: { "if-none-match": etag },
    });
    assert.equal(notMod.statusCode, 304);

    const js = await app.inject({ method: "GET", url: "/assets/app.js" });
    assert.equal(js.statusCode, 200);
    assert.match(String(js.headers["content-type"]), /javascript/);

    const traversal = await app.inject({ method: "GET", url: "/assets/..%2f..%2fetc%2fpasswd" });
    assert.equal(traversal.statusCode, 404);

    // Encoded "../secret" decodes to a multi-segment path → no single-segment
    // :file match → 404 (never reaches the file system).
    const traversal2 = await app.inject({ method: "GET", url: "/assets/%2e%2e%2fsecret" });
    assert.equal(traversal2.statusCode, 404);

    const missing = await app.inject({ method: "GET", url: "/assets/nope.js" });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("static: missing renderer dir → 404 'renderer not built'", async () => {
  const { app } = harness({ rendererDir: "/definitely/not/here" });
  const res = await app.inject({ method: "GET", url: "/" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body, "renderer not built");
  await app.close();
});
