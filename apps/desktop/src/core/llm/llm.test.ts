import assert from "node:assert/strict";
import test from "node:test";
import type { OllamaMessage } from "../ollama.js";
import type { ApiKeyState, ModelProvider, ModelSurface } from "../types.js";
import { toAnthropicRequest, CLOUD_CATALOG, isCloudModel } from "./anthropic.js";
import { KeyStore, maskAnthropicKey, type KeyKv } from "./keys.js";
import { ModelRouter, type RouterKeys, type RouterSettings } from "./router.js";

/* ---------------------- anthropic message mapping ---------------------- */

test("toAnthropicRequest: hoists all system entries and preserves the rest in order", () => {
  const messages: OllamaMessage[] = [
    { role: "system", content: "persona" },
    { role: "system", content: "context block" },
    { role: "user", content: "first question" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "follow-up" },
  ];
  const req = toAnthropicRequest(messages);
  assert.equal(req.system, "persona\n\ncontext block");
  assert.deepEqual(req.messages, [
    { role: "user", content: "first question" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "follow-up" },
  ]);
  // First non-system message is user-first (callers guarantee this).
  assert.equal(req.messages[0]?.role, "user");
});

test("toAnthropicRequest: no system messages yields an empty system string", () => {
  const req = toAnthropicRequest([{ role: "user", content: "hi" }]);
  assert.equal(req.system, "");
  assert.equal(req.messages.length, 1);
});

test("catalog: exactly the four current Claude ids, Opus recommended", () => {
  assert.deepEqual(
    CLOUD_CATALOG.map((m) => m.model),
    ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5"],
  );
  assert.equal(CLOUD_CATALOG.find((m) => m.recommended)?.model, "claude-opus-4-8");
  assert.ok(isCloudModel("claude-opus-4-8"));
  assert.ok(!isCloudModel("llama3.1:8b"));
});

/* ------------------------------ key mask ------------------------------- */

test("maskAnthropicKey: shows the sk-ant prefix + last 4 chars, short-safe", () => {
  assert.equal(maskAnthropicKey("sk-ant-api03-abcd1234EF"), "sk-ant-…34EF");
  assert.equal(maskAnthropicKey("xy"), "sk-ant-…xy");
  assert.equal(maskAnthropicKey(""), "sk-ant-…");
});

/* ------------------------------ KeyStore ------------------------------- */

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

test("KeyStore: none → valid → cleared lifecycle", () => {
  const store = new KeyStore(memKeyKv());
  assert.equal(store.getState(), "none");
  assert.equal(store.getKey(), null);
  assert.equal(store.getMask(), undefined);

  store.setKey("sk-ant-secret-value-9f3a", "valid");
  assert.equal(store.getState(), "valid");
  assert.equal(store.getKey(), "sk-ant-secret-value-9f3a");
  assert.equal(store.getMask(), "sk-ant-…9f3a");

  store.setKey("sk-ant-bad", "invalid", "Invalid Anthropic API key");
  assert.equal(store.getState(), "invalid");
  assert.equal(store.getError(), "Invalid Anthropic API key");

  store.clear();
  assert.equal(store.getState(), "none");
  assert.equal(store.getError(), undefined);
});

/* --------------------------- router.resolve ---------------------------- */

function fakeSettings(over: {
  cloudEnabled?: boolean;
  choice?: { provider: ModelProvider; model: string };
}): RouterSettings {
  const choice = over.choice ?? { provider: "ollama", model: "llama3.1:8b" };
  const models = {
    chat: choice,
    voice: choice,
    interviewer: choice,
    scorecard: choice,
  } as Record<ModelSurface, { provider: ModelProvider; model: string }>;
  return { get: () => ({ cloudEnabled: over.cloudEnabled ?? false, models }) };
}

function fakeKeys(state: ApiKeyState): RouterKeys {
  return { getKey: () => (state === "none" ? null : "sk-ant-x"), getState: () => state };
}

const cloudChoice = { provider: "anthropic" as const, model: "claude-opus-4-8" };

test("router.resolve: cloud choice + cloud off → falls back to local default", () => {
  const r = new ModelRouter(fakeSettings({ cloudEnabled: false, choice: cloudChoice }), fakeKeys("valid"));
  assert.deepEqual(r.resolve("chat"), { provider: "ollama", model: "llama3.1:8b", fellBack: true });
});

test("router.resolve: cloud choice + no valid key → falls back to local default", () => {
  const r = new ModelRouter(fakeSettings({ cloudEnabled: true, choice: cloudChoice }), fakeKeys("invalid"));
  assert.deepEqual(r.resolve("chat"), { provider: "ollama", model: "llama3.1:8b", fellBack: true });
});

test("router.resolve: cloud choice + cloud on + valid key → resolves cloud, no fallback", () => {
  const r = new ModelRouter(fakeSettings({ cloudEnabled: true, choice: cloudChoice }), fakeKeys("valid"));
  assert.deepEqual(r.resolve("chat"), { provider: "anthropic", model: "claude-opus-4-8", fellBack: false });
});

test("router.resolve: cloud on + valid key but model not in catalog → falls back", () => {
  const bad = { provider: "anthropic" as const, model: "claude-ghost-0" };
  const r = new ModelRouter(fakeSettings({ cloudEnabled: true, choice: bad }), fakeKeys("valid"));
  assert.equal(r.resolve("chat").fellBack, true);
  assert.equal(r.resolve("chat").provider, "ollama");
});

test("router.resolve: ollama choice passes through untouched", () => {
  const r = new ModelRouter(
    fakeSettings({ cloudEnabled: true, choice: { provider: "ollama", model: "qwen2.5:7b" } }),
    fakeKeys("valid"),
  );
  assert.deepEqual(r.resolve("interviewer"), { provider: "ollama", model: "qwen2.5:7b", fellBack: false });
});

test("router.status: cloud surface reports ready without a probe", async () => {
  const r = new ModelRouter(fakeSettings({ cloudEnabled: true, choice: cloudChoice }), fakeKeys("valid"));
  assert.deepEqual(await r.status("chat"), {
    state: "ready",
    model: "claude-opus-4-8",
    provider: "anthropic",
  });
});
