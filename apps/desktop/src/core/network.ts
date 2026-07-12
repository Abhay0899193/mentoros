import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { SqliteKeyKv, type KeyKv } from "./llm/keys.js";

/**
 * "Phone over LAN" networking for the core server.
 *
 * Framework-agnostic (no electron import). Adds three things to the Fastify
 * instance:
 *   1. an onRequest auth hook — loopback is trusted (Electron + `tailscale
 *      serve` which proxies via loopback); non-loopback needs the LAN token.
 *   2. hand-rolled static serving of the built renderer (no @fastify/static),
 *      same idiom as the faces art route.
 *   3. GET /network/access-info (loopback-only) — the QR/URL payload the
 *      desktop shows so a phone on the same LAN can open the app.
 *
 * The LAN token is a SECRET stored as `keys.lanToken` (mirrors keys.fal /
 * keys.anthropic): it is excluded from GET /settings reads and rejected by any
 * settings patch (both handled by SettingsStore's `keys.*` guard).
 */

const TOKEN_KEY = "keys.lanToken";

/** Secret store for the LAN token over the shared `settings(key,value)` KV. */
export class LanTokenStore {
  constructor(private readonly kv: KeyKv) {}

  private read(): Map<string, string> {
    return new Map(this.kv.readAll().map(({ key, value }) => [key, value]));
  }

  /** The stored token, or null when none has been generated yet. */
  getToken(): string | null {
    const v = this.read().get(TOKEN_KEY);
    return v && v.length > 0 ? v : null;
  }

  /** Return the stored token, lazily generating + persisting one if absent. */
  ensureToken(): string {
    const existing = this.getToken();
    if (existing) return existing;
    const token = randomBytes(16).toString("hex");
    this.kv.writeMany([[TOKEN_KEY, token]]);
    return token;
  }

  /** Forget the token (rotates on next ensureToken). */
  clear(): void {
    this.kv.deleteKeys([TOKEN_KEY]);
  }
}

export interface NetworkSystem {
  tokenStore: LanTokenStore;
  close(): void;
}

/**
 * Build the network subsystem on the shared MentorOS database (own connection,
 * WAL — mirror of the other core subsystems, §2.5).
 */
export function createNetworkSystem(dataDir: string): NetworkSystem {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "mentoros.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const tokenStore = new LanTokenStore(new SqliteKeyKv(db));
  return {
    tokenStore,
    close() {
      db.close();
    },
  };
}

export interface NetworkDeps {
  tokenStore: LanTokenStore;
  /** Resolved listen port (known only after `app.listen`). */
  getPort: () => number;
  /** Directory of the built renderer (index.html + assets/…). */
  rendererDir: string;
  /** Effective LAN opt-in: persisted `lanAccess` setting OR MENTOROS_LAN=1. */
  lanEnabled: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** True when the request originates from loopback (Electron / tailscale serve). */
function isLoopback(req: FastifyRequest): boolean {
  const ip = req.ip;
  const remote = req.socket?.remoteAddress;
  return (
    (typeof ip === "string" && LOOPBACK.has(ip)) ||
    (typeof remote === "string" && LOOPBACK.has(remote))
  );
}

/** Hand-parse a single cookie value from the raw Cookie header (no deps). */
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Extract `?token=` from a raw URL without relying on Fastify query parsing. */
function urlToken(url: string): string | undefined {
  const q = url.indexOf("?");
  if (q === -1) return undefined;
  return new URLSearchParams(url.slice(q + 1)).get("token") ?? undefined;
}

/** IPv4, non-internal addresses across all interfaces. */
function ipv4Addresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    if (!addrs) continue;
    for (const a of addrs) {
      const fam = a.family as string | number;
      if ((fam === "IPv4" || fam === 4) && !a.internal) out.push(a.address);
    }
  }
  return out;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const SAFE_FILE = /^[A-Za-z0-9._-]+$/;

/**
 * Stream a static file with an ETag (size-mtime) + 304 revalidation, matching
 * the faces art route idiom. Traversal-guarded: the resolved path must sit
 * inside `root` (or equal an explicitly-allowed file).
 */
function sendStatic(
  req: FastifyRequest,
  reply: FastifyReply,
  absPath: string,
  root: string,
): FastifyReply {
  const rootResolved = resolve(root);
  const abs = resolve(absPath);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
    return reply.code(404).type("text/plain").send("not found");
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return reply.code(404).type("text/plain").send("not found");
  }
  const stat = statSync(abs);
  const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
  reply.header("etag", etag).header("cache-control", "no-cache").type(type);
  if (req.headers["if-none-match"] === etag) return reply.code(304).send();
  return reply.send(readFileSync(abs));
}

/**
 * Register the LAN auth hook, static renderer serving, and the access-info
 * endpoint. Call this AFTER cors and BEFORE the app's other route registrations
 * so the onRequest hook covers every subsequently-declared route. Fastify runs
 * onRequest hooks for @fastify/websocket upgrade routes too (the hook fires on
 * the HTTP upgrade request), so the cookie set here also gates /events and
 * /voice WS upgrades.
 */
export function registerNetwork(app: FastifyInstance, deps: NetworkDeps): void {
  const { tokenStore, rendererDir } = deps;

  /* ------------------------------ auth hook ------------------------------ */
  app.addHook("onRequest", async (req, reply) => {
    if (isLoopback(req)) return; // Electron + tailscale-serve pass untouched.

    const token = tokenStore.getToken();
    if (!token) {
      // LAN never enabled (or token cleared): no remote access at all.
      return reply.code(401).send({ error: "unauthorized" });
    }

    const header = req.headers["x-mentoros-token"];
    const query = urlToken(req.raw.url ?? req.url);
    const cookie = cookieValue(req.headers.cookie, "mentoros_token");

    if (header === token || cookie === token) return;
    if (query === token) {
      // Promote the query token to a cookie so subsequent asset/fetch/WS
      // requests authenticate with zero renderer plumbing.
      reply.header(
        "set-cookie",
        `mentoros_token=${token}; Path=/; SameSite=Lax; Max-Age=15552000`,
      );
      return;
    }
    return reply.code(401).send({ error: "unauthorized" });
  });

  /* --------------------------- static renderer --------------------------- */
  app.get("/", async (req, reply) => {
    const index = join(rendererDir, "index.html");
    if (!existsSync(index)) {
      return reply.code(404).type("text/plain").send("renderer not built");
    }
    return sendStatic(req, reply, index, rendererDir);
  });

  app.get<{ Params: { file: string } }>("/assets/:file", async (req, reply) => {
    const { file } = req.params;
    if (!SAFE_FILE.test(file)) return reply.code(404).type("text/plain").send("not found");
    const dir = join(rendererDir, "assets");
    return sendStatic(req, reply, join(dir, file), dir);
  });

  // Top-level static files (favicon.ico, vite.svg, manifest.json, …). Fastify's
  // static routes (/health, /threads, …) take priority over this param route.
  app.get<{ Params: { file: string } }>("/:file", async (req, reply) => {
    const { file } = req.params;
    if (!SAFE_FILE.test(file) || !(extname(file).toLowerCase() in MIME)) {
      return reply.code(404).type("text/plain").send("not found");
    }
    return sendStatic(req, reply, join(rendererDir, file), rendererDir);
  });

  /* --------------------------- access-info ------------------------------- */
  app.get("/network/access-info", async (req, reply) => {
    // Loopback-only: never expose the token/URLs to a remote caller, even one
    // holding a valid token.
    if (!isLoopback(req)) return reply.code(403).send({ error: "forbidden" });

    const port = deps.getPort();
    const ips = ipv4Addresses();
    let token = tokenStore.getToken();
    if (deps.lanEnabled && !token) token = tokenStore.ensureToken();
    const urls = token ? ips.map((ip) => `http://${ip}:${port}/?token=${token}`) : [];

    return {
      lanAccess: deps.lanEnabled,
      port,
      ips,
      token: token ?? null,
      urls,
    };
  });
}
