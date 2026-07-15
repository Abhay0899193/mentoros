import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { ModelProvider, ModelSurface } from "../types.js";
import {
  EndpointStore,
  EndpointValidationError,
  slugify,
  validateEndpointInput,
  type EndpointKv,
} from "./endpoints.js";
import { KeyStore, type KeyKv } from "./keys.js";
import { parseSseLine, SseBuffer } from "./openai.js";
import {
  ModelRouter,
  type ResolvedEndpoint,
  type RouterEndpoints,
  type RouterKeys,
  type RouterSettings,
} from "./router.js";
import { registerModelRoutes } from "./routes.js";

/* ---------------------------- in-memory KVs ---------------------------- */

function memEndpointKv(): EndpointKv {
  const map = new Map<string, string>();
  return {
    readAll: () => [...map].map(([key, value]) => ({ key, value })),
    writeMany: (entries) => {
      for (const [k, v] of entries) map.set(k, v);
    },
    deleteKeys: (keys) => {
      for (const k of keys) map.delete(k);
    },
  };
}

function memKeyKv(): KeyKv {
  const map = new Map<string, string>();
  return {
    readAll: () => [...map].map(([key, value]) => ({ key, value })),
    writeMany: (entries) => {
      for (const [k, v] of entries) map.set(k, v);
    },
    deleteKeys: (keys) => {
      for (const k of keys) map.delete(k);
    },
  };
}

/* --------------------------- EndpointStore CRUD --------------------------- */

test("EndpointStore: create → get → list → update → delete", () => {
  const store = new EndpointStore(memEndpointKv());
  assert.deepEqual(store.list(), []);

  const ep = store.create({
    label: "Corp Gateway",
    kind: "anthropic",
    baseUrl: "https://gw.corp.example/v1/",
    auth: "bearer",
    models: ["claude-opus-4-8", "claude-sonnet-5"],
  });
  assert.equal(ep.id, "corp-gateway");
  assert.equal(ep.baseUrl, "https://gw.corp.example/v1"); // trailing slash stripped
  assert.deepEqual(ep.models, ["claude-opus-4-8", "claude-sonnet-5"]);

  assert.deepEqual(store.get("corp-gateway"), ep);
  assert.equal(store.list().length, 1);

  const updated = store.update("corp-gateway", { label: "Corp GW", models: ["claude-opus-4-8"] });
  assert.equal(updated?.label, "Corp GW");
  assert.equal(updated?.id, "corp-gateway"); // id is immutable
  assert.deepEqual(updated?.models, ["claude-opus-4-8"]);

  assert.equal(store.update("nope", { label: "x" }), null);

  store.delete("corp-gateway");
  assert.equal(store.get("corp-gateway"), null);
});

test("EndpointStore: slug collision appends -2, -3", () => {
  const store = new EndpointStore(memEndpointKv());
  const a = store.create({ label: "Zen", kind: "openai", baseUrl: "https://opencode.ai/zen/v1" });
  const b = store.create({ label: "Zen", kind: "openai", baseUrl: "https://opencode.ai/zen/v1" });
  const c = store.create({ label: "Zen!", kind: "openai", baseUrl: "https://opencode.ai/zen/v1" });
  assert.equal(a.id, "zen");
  assert.equal(b.id, "zen-2");
  assert.equal(c.id, "zen-3");
});

test("EndpointStore: default auth is bearer, empty models allowed", () => {
  const store = new EndpointStore(memEndpointKv());
  const ep = store.create({ label: "Bare", kind: "openai", baseUrl: "https://x.example" });
  assert.equal(ep.auth, "bearer");
  assert.deepEqual(ep.models, []);
});

/* --------------------------- validation rejects --------------------------- */

test("validateEndpointInput: rejects bad label / url / kind / auth / models", () => {
  const base = { label: "Ok", kind: "openai", baseUrl: "https://x.example" };
  assert.throws(() => validateEndpointInput({ ...base, label: "" }), EndpointValidationError);
  assert.throws(() => validateEndpointInput({ ...base, label: "x".repeat(61) }), EndpointValidationError);
  assert.throws(() => validateEndpointInput({ ...base, baseUrl: "notaurl" }), EndpointValidationError);
  assert.throws(() => validateEndpointInput({ ...base, baseUrl: "ftp://x.example" }), EndpointValidationError);
  assert.throws(() => validateEndpointInput({ ...base, kind: "grpc" }), EndpointValidationError);
  assert.throws(() => validateEndpointInput({ ...base, auth: "basic" }), EndpointValidationError);
  assert.throws(() => validateEndpointInput({ ...base, models: [""] }), EndpointValidationError);
  assert.throws(
    () => validateEndpointInput({ ...base, models: Array.from({ length: 51 }, (_, i) => `m${i}`) }),
    EndpointValidationError,
  );
});

test("validateEndpointInput: dedupes models, preserving order", () => {
  const cfg = validateEndpointInput({
    label: "D",
    kind: "openai",
    baseUrl: "https://x.example",
    models: ["a", "b", "a", "c", "b"],
  });
  assert.deepEqual(cfg.models, ["a", "b", "c"]);
});

test("slugify: lowercases and collapses non-alphanumerics", () => {
  assert.equal(slugify("OpenCode Zen!"), "opencode-zen");
  assert.equal(slugify("  --  "), "endpoint");
});

/* --------------------------- KeyStore endpoint tokens --------------------------- */

test("KeyStore: endpoint token set → mask → clear, isolated per id", () => {
  const store = new KeyStore(memKeyKv());
  assert.equal(store.getEndpointToken("zen"), null);
  assert.equal(store.endpointTokenMask("zen"), undefined);

  store.setEndpointToken("zen", "sk-zen-secret-ab12");
  assert.equal(store.getEndpointToken("zen"), "sk-zen-secret-ab12");
  assert.equal(store.endpointTokenMask("zen"), "…ab12");
  // Anthropic key rows are untouched by endpoint tokens.
  assert.equal(store.getState(), "none");

  store.setEndpointToken("corp", "tok-corp-9999");
  assert.equal(store.getEndpointToken("zen"), "sk-zen-secret-ab12");
  assert.equal(store.getEndpointToken("corp"), "tok-corp-9999");

  store.clearEndpointToken("zen");
  assert.equal(store.getEndpointToken("zen"), null);
  assert.equal(store.getEndpointToken("corp"), "tok-corp-9999");
});

/* --------------------------- router resolve (endpoint) --------------------------- */

function fakeSettings(over: {
  cloudEnabled?: boolean;
  choice: { provider: ModelProvider; model: string; endpointId?: string };
}): RouterSettings {
  const models = {
    chat: over.choice,
  } as Record<ModelSurface, { provider: ModelProvider; model: string; endpointId?: string }>;
  return { get: () => ({ cloudEnabled: over.cloudEnabled ?? false, models }) };
}

const noKeys: RouterKeys = { getKey: () => null, getState: () => "none" };

function fakeEndpoints(map: Record<string, ResolvedEndpoint>): RouterEndpoints {
  return { get: (id) => map[id] ?? null };
}

const openaiEndpoint = {
  kind: "openai" as const,
  baseUrl: "https://opencode.ai/zen/v1",
  auth: "bearer" as const,
  token: "tok",
};

test("router.resolve endpoint: cloud off → falls back to local default", () => {
  const r = new ModelRouter(
    fakeSettings({ cloudEnabled: false, choice: { provider: "endpoint", model: "gpt-x", endpointId: "zen" } }),
    noKeys,
    fakeEndpoints({ zen: openaiEndpoint }),
  );
  assert.deepEqual(r.resolve("chat"), { provider: "ollama", model: "llama3.1:8b", fellBack: true });
});

test("router.resolve endpoint: missing endpointId → falls back", () => {
  const r = new ModelRouter(
    fakeSettings({ cloudEnabled: true, choice: { provider: "endpoint", model: "gpt-x" } }),
    noKeys,
    fakeEndpoints({ zen: openaiEndpoint }),
  );
  assert.equal(r.resolve("chat").fellBack, true);
  assert.equal(r.resolve("chat").provider, "ollama");
});

test("router.resolve endpoint: unknown/dangling endpointId → falls back", () => {
  const r = new ModelRouter(
    fakeSettings({ cloudEnabled: true, choice: { provider: "endpoint", model: "gpt-x", endpointId: "ghost" } }),
    noKeys,
    fakeEndpoints({ zen: openaiEndpoint }),
  );
  assert.equal(r.resolve("chat").fellBack, true);
});

test("router.resolve endpoint: happy path resolves with the endpoint target (openai)", () => {
  const r = new ModelRouter(
    fakeSettings({ cloudEnabled: true, choice: { provider: "endpoint", model: "gpt-x", endpointId: "zen" } }),
    noKeys,
    fakeEndpoints({ zen: openaiEndpoint }),
  );
  const res = r.resolve("chat");
  assert.equal(res.provider, "endpoint");
  assert.equal(res.model, "gpt-x");
  assert.equal(res.fellBack, false);
  assert.deepEqual(res.endpoint, openaiEndpoint);
});

test("router.resolve endpoint: anthropic-kind, free-typed model resolves (no catalog check)", () => {
  const anthEndpoint = {
    kind: "anthropic" as const,
    baseUrl: "https://gw.corp.example",
    auth: "x-api-key" as const,
    token: null,
  };
  const r = new ModelRouter(
    fakeSettings({ cloudEnabled: true, choice: { provider: "endpoint", model: "corp-custom-1", endpointId: "corp" } }),
    noKeys,
    fakeEndpoints({ corp: anthEndpoint }),
  );
  const res = r.resolve("chat");
  assert.equal(res.provider, "endpoint");
  assert.equal(res.endpoint?.kind, "anthropic");
});

test("router.status endpoint: reports ready", async () => {
  const r = new ModelRouter(
    fakeSettings({ cloudEnabled: true, choice: { provider: "endpoint", model: "gpt-x", endpointId: "zen" } }),
    noKeys,
    fakeEndpoints({ zen: openaiEndpoint }),
  );
  assert.deepEqual(await r.status("chat"), { state: "ready", model: "gpt-x", provider: "endpoint" });
});

/* --------------------------- SSE parser --------------------------- */

test("parseSseLine: extracts delta content, terminates on [DONE], ignores noise", () => {
  assert.deepEqual(
    parseSseLine('data: {"choices":[{"delta":{"content":"Hi"}}]}'),
    { content: "Hi" },
  );
  assert.deepEqual(parseSseLine("data: [DONE]"), { done: true });
  assert.equal(parseSseLine(""), null);
  assert.equal(parseSseLine(": comment"), null);
  assert.equal(parseSseLine("event: ping"), null);
  assert.equal(parseSseLine("data: {not json"), null); // malformed → ignored
  assert.equal(parseSseLine('data: {"choices":[{"delta":{}}]}'), null); // no content
});

test("SseBuffer: reassembles content across partial + CRLF chunk boundaries", () => {
  const buf = new SseBuffer();
  const out: string[] = [];
  const drain = (chunk: string) => {
    for (const ev of buf.push(chunk)) if ("content" in ev) out.push(ev.content);
  };
  // A single SSE line split across three network chunks, CRLF terminated.
  drain('data: {"choices":[{"delta":{"con');
  drain('tent":"Hello"}}]}\r\n');
  drain('data: {"choices":[{"delta":{"content":" world"}}]}\r\n');
  assert.deepEqual(out, ["Hello", " world"]);

  const done = buf.push("data: [DONE]\n");
  assert.deepEqual(done, [{ done: true }]);
});

/* --------------------------- routes (fastify inject) --------------------------- */

function buildApp() {
  const keys = new KeyStore(memKeyKv());
  const endpoints = new EndpointStore(memEndpointKv());
  const app = Fastify({ logger: false });
  registerModelRoutes(app, {
    router: { status: async () => ({ state: "ready", model: "x" }) } as never,
    keys,
    endpoints,
  });
  return { app, keys, endpoints };
}

test("routes: POST creates (token stored, masked), PUT keeps vs clears token", async () => {
  const { app, keys } = buildApp();
  await app.ready();

  const created = await app.inject({
    method: "POST",
    url: "/models/endpoints",
    payload: { label: "Zen", kind: "openai", baseUrl: "https://opencode.ai/zen/v1", token: "tok-abcd1234" },
  });
  assert.equal(created.statusCode, 201);
  const ep = (created.json() as { endpoint: { id: string; tokenMask?: string } }).endpoint;
  assert.equal(ep.id, "zen");
  assert.equal(ep.tokenMask, "…1234");
  assert.equal(keys.getEndpointToken("zen"), "tok-abcd1234");

  // PUT without a token field → token kept.
  const kept = await app.inject({
    method: "PUT",
    url: "/models/endpoints/zen",
    payload: { label: "Zen Prod" },
  });
  assert.equal(kept.statusCode, 200);
  assert.equal((kept.json() as { endpoint: { label: string } }).endpoint.label, "Zen Prod");
  assert.equal(keys.getEndpointToken("zen"), "tok-abcd1234");

  // PUT with empty token → cleared.
  const cleared = await app.inject({
    method: "PUT",
    url: "/models/endpoints/zen",
    payload: { token: "" },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(keys.getEndpointToken("zen"), null);
  assert.equal((cleared.json() as { endpoint: { tokenMask?: string } }).endpoint.tokenMask, undefined);

  await app.close();
});

test("routes: POST rejects invalid input with 400", async () => {
  const { app } = buildApp();
  await app.ready();
  const bad = await app.inject({
    method: "POST",
    url: "/models/endpoints",
    payload: { label: "", kind: "openai", baseUrl: "https://x.example" },
  });
  assert.equal(bad.statusCode, 400);
  assert.ok((bad.json() as { error: string }).error);
  await app.close();
});

test("routes: PUT/DELETE 404 for unknown id; DELETE clears token", async () => {
  const { app, keys } = buildApp();
  await app.ready();

  const put404 = await app.inject({ method: "PUT", url: "/models/endpoints/ghost", payload: { label: "x" } });
  assert.equal(put404.statusCode, 404);

  await app.inject({
    method: "POST",
    url: "/models/endpoints",
    payload: { label: "Zen", kind: "openai", baseUrl: "https://opencode.ai/zen/v1", token: "tok-9999" },
  });
  assert.equal(keys.getEndpointToken("zen"), "tok-9999");

  const del = await app.inject({ method: "DELETE", url: "/models/endpoints/zen" });
  assert.equal(del.statusCode, 204);
  assert.equal(keys.getEndpointToken("zen"), null);
  await app.close();
});

test("routes: fetch-models returns list (openai) and 502 on failure", async () => {
  const { app } = buildApp();
  await app.ready();
  await app.inject({
    method: "POST",
    url: "/models/endpoints",
    payload: { label: "Zen", kind: "openai", baseUrl: "https://opencode.ai/zen/v1" },
  });

  const realFetch = globalThis.fetch;
  // Happy path: GET /models → data[].id sorted.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ id: "gpt-b" }, { id: "gpt-a" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const ok = await app.inject({ method: "POST", url: "/models/endpoints/zen/models" });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual((ok.json() as { models: string[] }).models, ["gpt-a", "gpt-b"]);

  // Failure: upstream 401 → 502 with humanized copy.
  globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;
  const fail = await app.inject({ method: "POST", url: "/models/endpoints/zen/models" });
  assert.equal(fail.statusCode, 502);
  assert.equal((fail.json() as { error: string }).error, "Endpoint rejected the token");

  globalThis.fetch = realFetch;
  await app.close();
});

test("routes: /test never throws — returns ok:false on a failing endpoint", async () => {
  const { app } = buildApp();
  await app.ready();
  await app.inject({
    method: "POST",
    url: "/models/endpoints",
    payload: { label: "Zen", kind: "openai", baseUrl: "https://opencode.ai/zen/v1" },
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("x", { status: 404 })) as typeof fetch;
  const res = await app.inject({ method: "POST", url: "/models/endpoints/zen/test" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "Endpoint URL not found (check the base URL)");

  globalThis.fetch = realFetch;
  await app.close();
});
