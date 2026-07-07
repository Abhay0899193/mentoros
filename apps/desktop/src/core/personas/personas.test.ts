import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { AppSettings, CoreEvents, PersonaInput } from "../types.js";
import {
  BUILTIN_PERSONAS,
  PersonaForbiddenError,
  PersonaNotFoundError,
  PersonaStore,
  PersonaValidationError,
  type PersonaRepo,
  type PersonaRow,
} from "./store.js";
import { systemPrompt, MARKER_INSTRUCTIONS } from "./prompt.js";
import {
  clampDraft,
  generatePersonaDraft,
  PersonaDraftError,
  type PersonaDraftOnce,
} from "./draft.js";
import { registerPersonaRoutes } from "./routes.js";
import { DEFAULT_SETTINGS, SettingsStore, type SettingsKv } from "../settings/store.js";

/* ------------------------------ test doubles ------------------------------ */

function memRepo(): PersonaRepo {
  const rows: PersonaRow[] = [];
  return {
    all: () => rows.map((r) => ({ ...r })),
    get: (id) => {
      const r = rows.find((row) => row.id === id);
      return r ? { ...r } : null;
    },
    insert: (row) => {
      rows.push({ ...row });
    },
    update: (row) => {
      const i = rows.findIndex((r) => r.id === row.id);
      if (i >= 0) rows[i] = { ...row };
    },
    delete: (id) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) {
        rows.splice(i, 1);
        return true;
      }
      return false;
    },
  };
}

function fakeSettings(active = "staff-engineer") {
  let activePersona = active;
  return {
    get: () => ({ activePersona }),
    patch: (input: { activePersona: string }) => {
      activePersona = input.activePersona;
      return { activePersona };
    },
    current: () => activePersona,
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

const VALID_INPUT: PersonaInput = {
  name: "Priya — FAANG Staff",
  tagline: "Rigorous FAANG staff interviewer",
  style: "strict",
  domains: ["distributed systems", "DP"],
  blurb:
    "You are Priya, a demanding FAANG staff engineer. You keep the bar high, ask sharp follow-ups, and expect the candidate to justify every trade-off out loud.",
};

/* --------------------------------- CRUD ---------------------------------- */

test("personas: list returns the 4 built-ins first, then customs", () => {
  const store = new PersonaStore(memRepo());
  const before = store.list();
  assert.deepEqual(
    before.map((p) => p.id),
    BUILTIN_PERSONAS.map((p) => p.id),
  );
  assert.ok(before.every((p) => p.builtIn));

  const created = store.create(VALID_INPUT);
  const after = store.list();
  assert.equal(after.length, 5);
  assert.equal(after[4].id, created.id);
  assert.equal(after[4].builtIn, false);
});

test("personas: create derives persona-<slug> id and dedupes with -2/-3", () => {
  const store = new PersonaStore(memRepo());
  const a = store.create(VALID_INPUT);
  const b = store.create(VALID_INPUT);
  const c = store.create(VALID_INPUT);
  assert.equal(a.id, "persona-priya-faang-staff");
  assert.equal(b.id, "persona-priya-faang-staff-2");
  assert.equal(c.id, "persona-priya-faang-staff-3");
  assert.ok(a.createdAt && a.updatedAt);
});

test("personas: create validates name/tagline/blurb/style/domains", () => {
  const store = new PersonaStore(memRepo());
  assert.throws(() => store.create({ ...VALID_INPUT, name: "" }), PersonaValidationError);
  assert.throws(() => store.create({ ...VALID_INPUT, name: "x".repeat(61) }), PersonaValidationError);
  assert.throws(() => store.create({ ...VALID_INPUT, tagline: "x".repeat(121) }), PersonaValidationError);
  assert.throws(() => store.create({ ...VALID_INPUT, blurb: "too short" }), PersonaValidationError);
  assert.throws(
    () => store.create({ ...VALID_INPUT, style: "brutal" as PersonaInput["style"] }),
    PersonaValidationError,
  );
  assert.throws(
    () => store.create({ ...VALID_INPUT, domains: Array(9).fill("x") }),
    PersonaValidationError,
  );
  assert.throws(
    () => store.create({ ...VALID_INPUT, domains: ["x".repeat(41)] }),
    PersonaValidationError,
  );
});

test("personas: create validates mentorFace preset; ttsVoice stored", () => {
  const store = new PersonaStore(memRepo());
  assert.throws(
    () => store.create({ ...VALID_INPUT, mentorFace: "cortana" as PersonaInput["mentorFace"] }),
    PersonaValidationError,
  );
  const rec = store.create({ ...VALID_INPUT, mentorFace: "sienna", ttsVoice: "bf_emma" });
  assert.equal(rec.mentorFace, "sienna");
  assert.equal(rec.ttsVoice, "bf_emma");
});

test("personas: update merges a partial patch and re-validates", () => {
  const store = new PersonaStore(memRepo());
  const created = store.create(VALID_INPUT);
  const updated = store.update(created.id, { tagline: "Kinder now", style: "supportive" });
  assert.equal(updated.tagline, "Kinder now");
  assert.equal(updated.style, "supportive");
  assert.equal(updated.name, VALID_INPUT.name); // untouched
  assert.equal(updated.createdAt, created.createdAt);
  assert.notEqual(updated.updatedAt, undefined);
  assert.throws(() => store.update(created.id, { blurb: "nope" }), PersonaValidationError);
});

test("personas: update/delete reject built-ins (403) and unknown ids (404)", () => {
  const store = new PersonaStore(memRepo());
  assert.throws(() => store.update("staff-engineer", { tagline: "x" }), PersonaForbiddenError);
  assert.throws(() => store.delete("interviewer"), PersonaForbiddenError);
  assert.throws(() => store.update("persona-nope", { tagline: "x" }), PersonaNotFoundError);
  assert.throws(() => store.delete("persona-nope"), PersonaNotFoundError);
});

test("personas: deleting the active custom persona resets settings to staff-engineer", () => {
  const settings = fakeSettings();
  const store = new PersonaStore(memRepo(), settings);
  const created = store.create(VALID_INPUT);
  settings.patch({ activePersona: created.id });
  assert.equal(settings.current(), created.id);

  const res = store.delete(created.id);
  assert.equal(res.activePersonaReset, true);
  assert.equal(settings.current(), "staff-engineer");
});

test("personas: deleting a non-active persona leaves activePersona untouched", () => {
  const settings = fakeSettings("staff-engineer");
  const store = new PersonaStore(memRepo(), settings);
  const created = store.create(VALID_INPUT);
  const res = store.delete(created.id);
  assert.equal(res.activePersonaReset, false);
  assert.equal(settings.current(), "staff-engineer");
});

/* --------------------------- prompt resolution --------------------------- */

test("systemPrompt: built-in id uses its blurb + appends the teaching ladder", () => {
  const store = new PersonaStore(memRepo());
  const prompt = systemPrompt("teacher", store);
  assert.ok(prompt.includes("patient CS teacher"));
  assert.ok(prompt.includes(MARKER_INSTRUCTIONS));
});

test("systemPrompt: custom id resolves to the stored blurb", () => {
  const store = new PersonaStore(memRepo());
  const created = store.create(VALID_INPUT);
  const prompt = systemPrompt(created.id, store);
  assert.ok(prompt.includes("You are Priya"));
  assert.ok(prompt.includes(MARKER_INSTRUCTIONS));
});

test("systemPrompt: unknown/deleted id falls back to staff-engineer", () => {
  const store = new PersonaStore(memRepo());
  const prompt = systemPrompt("persona-gone", store);
  assert.ok(prompt.includes("warm, pragmatic Staff Engineer"));
});

test("systemPrompt: no resolver uses built-in blurbs", () => {
  assert.ok(systemPrompt("architect").includes("systems architect"));
  assert.ok(systemPrompt("who-knows").includes("warm, pragmatic Staff Engineer"));
});

/* ---------------- settings activePersona validation + bundle -------------- */

test("settings: activePersona rejects an unknown id, accepts a built-in", () => {
  const store = new SettingsStore(memKv());
  assert.equal(store.patch({ activePersona: "teacher" }).activePersona, "teacher");
  assert.throws(() => store.patch({ activePersona: "persona-ghost" }), Error);
});

test("settings: activePersona accepts a known custom id via the persona lookup", () => {
  const personas = new PersonaStore(memRepo());
  const custom = personas.create(VALID_INPUT);
  const settings = new SettingsStore(memKv());
  settings.setPersonaLookup(personas);
  assert.equal(settings.patch({ activePersona: custom.id }).activePersona, custom.id);
});

test("settings: activating a persona bundles its mentorFace (→ face) and ttsVoice", () => {
  const personas = new PersonaStore(memRepo());
  const custom = personas.create({ ...VALID_INPUT, mentorFace: "sienna", ttsVoice: "bf_emma" });
  const settings = new SettingsStore(memKv());
  settings.setPersonaLookup(personas);

  const merged = settings.patch({ activePersona: custom.id });
  assert.equal(merged.activePersona, custom.id);
  assert.equal(merged.mentorFace, "sienna");
  assert.equal(merged.mentorIdentity, "face");
  assert.equal(merged.ttsVoice, "bf_emma");
});

test("settings: an explicit field in the same patch overrides the persona bundle", () => {
  const personas = new PersonaStore(memRepo());
  const custom = personas.create({ ...VALID_INPUT, mentorFace: "sienna", ttsVoice: "bf_emma" });
  const settings = new SettingsStore(memKv());
  settings.setPersonaLookup(personas);

  const merged = settings.patch({ activePersona: custom.id, mentorFace: "nova" });
  assert.equal(merged.mentorFace, "nova"); // explicit wins
  assert.equal(merged.ttsVoice, "bf_emma"); // bundle still applies untouched fields
});

test("settings: activating a persona with no identity leaves face/voice at defaults", () => {
  const personas = new PersonaStore(memRepo());
  const custom = personas.create(VALID_INPUT); // no mentorFace/ttsVoice
  const settings = new SettingsStore(memKv());
  settings.setPersonaLookup(personas);
  const merged = settings.patch({ activePersona: custom.id });
  assert.equal(merged.mentorFace, DEFAULT_SETTINGS.mentorFace);
  assert.equal(merged.mentorIdentity, DEFAULT_SETTINGS.mentorIdentity);
  assert.equal(merged.ttsVoice, DEFAULT_SETTINGS.ttsVoice);
});

/* -------------------------------- drafting ------------------------------- */

const onceReturning = (text: string): PersonaDraftOnce => async () => text;

test("clampDraft: honors user-fixed name/style and clamps domains", () => {
  const draft = clampDraft(
    {
      name: "Model Name",
      style: "supportive",
      tagline: "x".repeat(200),
      domains: Array.from({ length: 12 }, (_, i) => `domain-${i} ${"y".repeat(50)}`),
      blurb: "You are a mentor who is thorough and kind and pushes hard on fundamentals.",
    },
    { description: "d", name: "Fixed Name", style: "strict" },
  );
  assert.equal(draft.name, "Fixed Name");
  assert.equal(draft.style, "strict");
  assert.ok(draft.tagline.length <= 120);
  assert.equal(draft.domains.length, 8);
  assert.ok(draft.domains.every((d) => d.length <= 40));
});

test("generatePersonaDraft: parses clean JSON into a PersonaDraft", async () => {
  const payload = JSON.stringify({
    name: "Mara",
    tagline: "Kind systems coach",
    style: "supportive",
    domains: ["systems", "career"],
    blurb: "You are Mara, an encouraging systems coach who builds confidence step by step.",
  });
  const draft = await generatePersonaDraft({ description: "kind coach" }, onceReturning(payload));
  assert.equal(draft.name, "Mara");
  assert.equal(draft.style, "supportive");
  assert.deepEqual(draft.domains, ["systems", "career"]);
});

test("generatePersonaDraft: parses JSON wrapped in a code fence + prose", async () => {
  const wrapped = "Sure!\n```json\n" + JSON.stringify({
    name: "Rex",
    tagline: "Blunt reviewer",
    style: "strict",
    domains: ["code review"],
    blurb: "You are Rex, a blunt staff reviewer who never sugar-coats but always explains.",
  }) + "\n```";
  const draft = await generatePersonaDraft({ description: "blunt" }, onceReturning(wrapped));
  assert.equal(draft.name, "Rex");
});

test("generatePersonaDraft: unusable output throws the designed 502 error", async () => {
  await assert.rejects(
    () => generatePersonaDraft({ description: "d" }, onceReturning("I cannot help.")),
    PersonaDraftError,
  );
  // Present JSON but an empty blurb is still unusable.
  const badBlurb = JSON.stringify({ name: "X", style: "strict", domains: [], blurb: "" });
  await assert.rejects(
    () => generatePersonaDraft({ description: "d" }, onceReturning(badBlurb)),
    PersonaDraftError,
  );
});

/* --------------------------------- routes -------------------------------- */

function routeApp() {
  const fs = fakeSettings();
  const store = new PersonaStore(memRepo(), fs);
  const events: Array<{ event: keyof CoreEvents; payload: unknown }> = [];
  const app = Fastify({ logger: false });
  registerPersonaRoutes(app, {
    store,
    broadcast: (event, payload) => events.push({ event, payload }),
    draftOnce: onceReturning(
      JSON.stringify({
        name: "Drafted",
        tagline: "t",
        style: "balanced",
        domains: ["a"],
        blurb: "You are a drafted mentor who is patient, precise, and endlessly curious.",
      }),
    ),
    getSettings: (): AppSettings => ({ ...DEFAULT_SETTINGS, activePersona: fs.current() }),
  });
  return { app, store, events, fs };
}

test("routes: POST /personas creates + broadcasts, invalid input → 422", async () => {
  const { app, events } = routeApp();
  await app.ready();

  const ok = await app.inject({ method: "POST", url: "/personas", payload: VALID_INPUT });
  assert.equal(ok.statusCode, 200);
  assert.equal(events.at(-1)?.event, "personas.changed");

  const bad = await app.inject({ method: "POST", url: "/personas", payload: { name: "" } });
  assert.equal(bad.statusCode, 422);
  assert.equal((bad.json() as { error: string }).error.length > 0, true);
  await app.close();
});

test("routes: PATCH built-in → 403, unknown → 404", async () => {
  const { app } = routeApp();
  await app.ready();
  const forbidden = await app.inject({
    method: "PATCH",
    url: "/personas/staff-engineer",
    payload: { tagline: "x" },
  });
  assert.equal(forbidden.statusCode, 403);
  const missing = await app.inject({
    method: "PATCH",
    url: "/personas/persona-nope",
    payload: { tagline: "x" },
  });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test("routes: DELETE active custom persona broadcasts settings.changed + personas.changed", async () => {
  const { app, events, fs } = routeApp();
  await app.ready();
  const created = (
    await app.inject({ method: "POST", url: "/personas", payload: VALID_INPUT })
  ).json() as { id: string };
  fs.patch({ activePersona: created.id }); // make it the active persona

  const del = await app.inject({ method: "DELETE", url: `/personas/${created.id}` });
  assert.equal(del.statusCode, 204);
  assert.ok(events.some((e) => e.event === "settings.changed"));
  assert.equal(events.at(-1)?.event, "personas.changed");
  assert.equal(fs.current(), "staff-engineer"); // reset
  await app.close();
});

test("routes: POST /personas/draft returns a draft; empty description → 400", async () => {
  const { app } = routeApp();
  await app.ready();
  const ok = await app.inject({
    method: "POST",
    url: "/personas/draft",
    payload: { description: "a patient teacher" },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal((ok.json() as { name: string }).name, "Drafted");

  const bad = await app.inject({ method: "POST", url: "/personas/draft", payload: {} });
  assert.equal(bad.statusCode, 400);
  await app.close();
});
