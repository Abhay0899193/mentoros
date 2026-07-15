import type Database from "better-sqlite3";
import type { CustomEndpointInfo, EndpointAuth, EndpointKind } from "../types.js";

/**
 * Persistent store for user-defined custom LLM endpoints (§2.4 router). Configs
 * live as JSON rows under an `endpoint.<id>` prefix in the shared
 * `settings(key,value)` table — the token itself is NOT here (it's a secret in
 * KeyStore). Kept behind {@link EndpointKv} so the CRUD/slug/validation logic is
 * unit-testable without the native better-sqlite3 addon.
 *
 * A stored config never carries the token: {@link CustomEndpointInfo.tokenMask}
 * is filled in by the routes layer from KeyStore at read time.
 */

const PREFIX = "endpoint.";

/** The persisted shape of an endpoint (config only — no token, no mask). */
export interface EndpointConfig {
  id: string;
  label: string;
  kind: EndpointKind;
  baseUrl: string;
  auth: EndpointAuth;
  models: string[];
}

/** Fields accepted when creating an endpoint (id is derived). */
export interface EndpointInput {
  label: string;
  kind: EndpointKind;
  baseUrl: string;
  auth?: EndpointAuth;
  models?: string[];
}

/** KV persistence contract for endpoint configs (own `endpoint.%` prefix). */
export interface EndpointKv {
  readAll(): Array<{ key: string; value: string }>;
  writeMany(entries: Array<[string, string]>): void;
  deleteKeys(keys: string[]): void;
}

/** SQLite-backed endpoint KV over the shared `settings(key,value)` table. */
export class SqliteEndpointKv implements EndpointKv {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  readAll(): Array<{ key: string; value: string }> {
    return this.db
      .prepare(`SELECT key, value FROM settings WHERE key LIKE 'endpoint.%'`)
      .all() as Array<{ key: string; value: string }>;
  }

  writeMany(entries: Array<[string, string]>): void {
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    const tx = this.db.transaction(() => {
      for (const [key, value] of entries) stmt.run(key, value);
    });
    tx();
  }

  deleteKeys(keys: string[]): void {
    const stmt = this.db.prepare(`DELETE FROM settings WHERE key = ?`);
    const tx = this.db.transaction(() => {
      for (const key of keys) stmt.run(key);
    });
    tx();
  }
}

/** 400-worthy rejection of invalid endpoint input. */
export class EndpointValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointValidationError";
  }
}

/** Lowercased [a-z0-9-] slug of a label; empty → 'endpoint'. */
export function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "endpoint";
}

const ENDPOINT_KINDS = new Set<string>(["openai", "anthropic"]);
const ENDPOINT_AUTHS = new Set<string>(["bearer", "x-api-key"]);

/**
 * Validate + normalize create/update input into a config (sans id). Throws
 * {@link EndpointValidationError} on any bad field. baseUrl must be an http(s)
 * URL and is stored with any trailing slash stripped.
 */
export function validateEndpointInput(input: unknown): Omit<EndpointConfig, "id"> {
  if (!input || typeof input !== "object") {
    throw new EndpointValidationError("endpoint input must be an object");
  }
  const v = input as Record<string, unknown>;

  const label = typeof v.label === "string" ? v.label.trim() : "";
  if (label.length < 1 || label.length > 60) {
    throw new EndpointValidationError("label must be 1..60 characters");
  }

  if (typeof v.kind !== "string" || !ENDPOINT_KINDS.has(v.kind)) {
    throw new EndpointValidationError("kind must be 'openai' or 'anthropic'");
  }

  const auth = v.auth === undefined ? "bearer" : v.auth;
  if (typeof auth !== "string" || !ENDPOINT_AUTHS.has(auth)) {
    throw new EndpointValidationError("auth must be 'bearer' or 'x-api-key'");
  }

  if (typeof v.baseUrl !== "string") {
    throw new EndpointValidationError("baseUrl is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(v.baseUrl.trim());
  } catch {
    throw new EndpointValidationError("baseUrl must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new EndpointValidationError("baseUrl must be an http(s) URL");
  }
  const baseUrl = v.baseUrl.trim().replace(/\/+$/, "");

  const models = normalizeModels(v.models);

  return {
    label,
    kind: v.kind as EndpointKind,
    auth: auth as EndpointAuth,
    baseUrl,
    models,
  };
}

/** Dedupe + validate a free-typed model list (each 1..64 chars, max 50). */
function normalizeModels(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new EndpointValidationError("models must be an array of strings");
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (typeof m !== "string") {
      throw new EndpointValidationError("models must be an array of strings");
    }
    const trimmed = m.trim();
    if (trimmed.length < 1 || trimmed.length > 64) {
      throw new EndpointValidationError("each model must be 1..64 characters");
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length > 50) {
      throw new EndpointValidationError("at most 50 models per endpoint");
    }
  }
  return out;
}

export class EndpointStore {
  constructor(private readonly kv: EndpointKv) {}

  private read(): Map<string, EndpointConfig> {
    const map = new Map<string, EndpointConfig>();
    for (const { key, value } of this.kv.readAll()) {
      if (!key.startsWith(PREFIX)) continue;
      try {
        const cfg = JSON.parse(value) as EndpointConfig;
        if (cfg && typeof cfg.id === "string") map.set(cfg.id, cfg);
      } catch {
        /* skip corrupt row */
      }
    }
    return map;
  }

  /** All configs, ordered by label (stable for the picker). */
  list(): EndpointConfig[] {
    return [...this.read().values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  get(id: string): EndpointConfig | null {
    return this.read().get(id) ?? null;
  }

  /**
   * Create a new endpoint from validated input. The id is the slug of the label,
   * de-collided with a `-N` suffix. Throws {@link EndpointValidationError}.
   */
  create(input: unknown): EndpointConfig {
    const normalized = validateEndpointInput(input);
    const existing = this.read();
    const id = this.freshId(slugify(normalized.label), existing);
    const cfg: EndpointConfig = { id, ...normalized };
    this.kv.writeMany([[PREFIX + id, JSON.stringify(cfg)]]);
    return cfg;
  }

  /**
   * Partial update of an existing endpoint (id is immutable). Only the fields
   * present in the patch are re-validated + replaced. Returns null when unknown.
   */
  update(id: string, patch: Record<string, unknown>): EndpointConfig | null {
    const current = this.get(id);
    if (!current) return null;
    // Re-validate the merged config so a partial patch can't produce a bad row.
    const merged = validateEndpointInput({
      label: patch.label ?? current.label,
      kind: patch.kind ?? current.kind,
      baseUrl: patch.baseUrl ?? current.baseUrl,
      auth: patch.auth ?? current.auth,
      models: patch.models ?? current.models,
    });
    const cfg: EndpointConfig = { id, ...merged };
    this.kv.writeMany([[PREFIX + id, JSON.stringify(cfg)]]);
    return cfg;
  }

  /** Remove an endpoint config (no-op when absent). */
  delete(id: string): void {
    this.kv.deleteKeys([PREFIX + id]);
  }

  /** First free id from `base`, `base-2`, `base-3`, … given the current set. */
  private freshId(base: string, existing: Map<string, EndpointConfig>): string {
    if (!existing.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!existing.has(candidate)) return candidate;
    }
  }
}
