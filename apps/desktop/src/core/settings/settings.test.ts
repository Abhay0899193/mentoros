import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  DEFAULT_SETTINGS,
  SettingsStore,
  SettingsValidationError,
  type SettingsKv,
} from "./store.js";
import { registerSettingsRoutes } from "./routes.js";
import type { AppSettings, CoreEvents } from "../types.js";

/**
 * In-memory KV — mirrors SqliteSettingsKv's upsert semantics without loading the
 * native better-sqlite3 addon (the test node is x86_64/Rosetta; the addon is
 * arm64). Production wiring is covered by createSettingsSystem.
 */
function memKv(): SettingsKv {
  const map = new Map<string, string>();
  return {
    readAll: () => [...map].map(([key, value]) => ({ key, value })),
    writeMany: (entries) => {
      for (const [key, value] of entries) map.set(key, value);
    },
  };
}

function memStore(): SettingsStore {
  return new SettingsStore(memKv());
}

test("settings: defaults when nothing is stored", () => {
  const store = memStore();
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
});

test("settings: patch persists and round-trips a full merged view", () => {
  const store = memStore();
  const merged = store.patch({ ttsVoice: "am_adam", sttModel: "medium.en", mentorIdentity: "face" });
  assert.deepEqual(merged, { ttsVoice: "am_adam", sttModel: "medium.en", mentorIdentity: "face" });
  assert.deepEqual(store.get(), merged);
});

test("settings: partial patch leaves untouched keys at their prior value", () => {
  const store = memStore();
  store.patch({ sttModel: "large-v3-turbo" });
  const after = store.patch({ mentorIdentity: "face" });
  assert.equal(after.sttModel, "large-v3-turbo"); // preserved
  assert.equal(after.mentorIdentity, "face");
  assert.equal(after.ttsVoice, DEFAULT_SETTINGS.ttsVoice); // still default
});

test("settings: unknown key is rejected and nothing persists", () => {
  const store = memStore();
  assert.throws(() => store.patch({ theme: "dark" }), SettingsValidationError);
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
});

test("settings: invalid values are rejected per key", () => {
  const store = memStore();
  assert.throws(() => store.patch({ ttsVoice: "not_a_voice" }), SettingsValidationError);
  assert.throws(() => store.patch({ ttsVoice: "zf_zzz" }), SettingsValidationError);
  assert.throws(() => store.patch({ sttModel: "tiny.en" }), SettingsValidationError);
  assert.throws(() => store.patch({ mentorIdentity: "avatar" }), SettingsValidationError);
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
});

test("settings: a valid but atypical voice id (bm_fable) is accepted", () => {
  const store = memStore();
  assert.equal(store.patch({ ttsVoice: "bm_fable" }).ttsVoice, "bm_fable");
});

test("POST /settings validates, persists, and broadcasts settings.changed", async () => {
  const app = Fastify({ logger: false });
  const store = memStore();
  const events: Array<{ event: keyof CoreEvents; payload: unknown }> = [];
  registerSettingsRoutes(app, {
    store,
    broadcast: (event, payload) => events.push({ event, payload }),
  });
  await app.ready();

  const ok = await app.inject({
    method: "POST",
    url: "/settings",
    payload: { ttsVoice: "bf_emma" },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal((ok.json() as AppSettings).ttsVoice, "bf_emma");
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "settings.changed");
  assert.deepEqual((events[0].payload as { settings: AppSettings }).settings, store.get());

  const bad = await app.inject({
    method: "POST",
    url: "/settings",
    payload: { sttModel: "huge" },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(events.length, 1); // no broadcast on rejection

  const view = await app.inject({ method: "GET", url: "/settings" });
  assert.equal(view.statusCode, 200);
  assert.equal((view.json() as AppSettings).ttsVoice, "bf_emma");

  await app.close();
});
