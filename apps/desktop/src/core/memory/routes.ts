import { homedir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type {
  CoreEvents,
  ImportSource,
  MemoryRecord,
  MemoryType,
  SaveMemoryInput,
} from "../types.js";
import { importInterviewPrep } from "../import/interviewPrep.js";
import type { MemoryEngine } from "./engine.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

type MemoryPatch = Partial<
  Pick<MemoryRecord, "title" | "body" | "type" | "tags" | "confidence" | "links">
>;

/** Register the memory + import HTTP routes (mirror of coreClient §Memory). */
export function registerMemoryRoutes(
  app: FastifyInstance,
  deps: { engine: MemoryEngine; broadcast: Broadcast },
): void {
  const { engine, broadcast } = deps;

  app.get<{ Querystring: { type?: MemoryType; q?: string; limit?: string } }>(
    "/memories",
    async (req) => {
      const { type, q, limit } = req.query;
      const opts: { type?: MemoryType; q?: string; limit?: number } = {};
      if (type) opts.type = type;
      if (q) opts.q = q;
      if (limit) {
        const n = Number.parseInt(limit, 10);
        if (Number.isFinite(n) && n > 0) opts.limit = n;
      }
      return engine.listMemories(opts);
    },
  );

  app.post<{ Body: SaveMemoryInput }>("/memories", async (req, reply) => {
    const input = req.body;
    if (!input || !input.type || !input.body || input.body.trim().length === 0) {
      return reply.code(400).send({ error: "type and body are required" });
    }
    return engine.saveMemory(input);
  });

  app.post<{ Body: { query?: string; k?: number; types?: MemoryType[] } }>(
    "/memories/recall",
    async (req, reply) => {
      const { query, k, types } = req.body ?? {};
      if (!query || query.trim().length === 0) {
        return reply.code(400).send({ error: "query is required" });
      }
      const opts: { k?: number; types?: MemoryType[] } = {};
      if (typeof k === "number") opts.k = k;
      if (types) opts.types = types;
      return engine.recall(query, opts);
    },
  );

  app.get("/memories/graph", async () => engine.graph());
  app.get("/memories/profile", async () => engine.profile());

  app.patch<{ Params: { id: string }; Body: MemoryPatch }>(
    "/memories/:id",
    async (req, reply) => {
      const updated = await engine.updateMemory(req.params.id, req.body ?? {});
      if (!updated) return reply.code(404).send({ error: "memory not found" });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>("/memories/:id", async (req, reply) => {
    const ok = engine.deleteMemory(req.params.id);
    if (!ok) return reply.code(404).send({ error: "memory not found" });
    return reply.code(204).send();
  });

  /* --------------------------------- import -------------------------------- */
  app.post<{ Body: { source?: ImportSource; path?: string } }>(
    "/import",
    async (req, reply) => {
      const source = req.body?.source;
      const path = req.body?.path;
      if (source !== "interview-prep" && source !== "3mc") {
        return reply.code(400).send({ error: "unknown import source" });
      }
      if (!path) {
        return reply.code(400).send({ error: "path is required" });
      }
      const abs = resolve(path);
      const home = resolve(homedir());
      if (abs !== home && !abs.startsWith(home + "/")) {
        return reply.code(400).send({ error: "path must be inside the home directory" });
      }
      if (source === "3mc") {
        // 3-month-challenge importer is a later phase; acknowledge + no-op step.
        broadcast("import.progress", {
          source,
          step: "3mc importer not implemented yet",
          created: 0,
          merged: 0,
          done: true,
        });
        return reply.code(202).send({ started: true as const });
      }

      // Fire-and-forget: progress + completion arrive over /events.
      void importInterviewPrep({
        path: abs,
        saveMemory: (input) => engine.saveMemory(input),
        onProgress: (p) =>
          broadcast("import.progress", {
            source,
            step: p.step,
            created: p.created,
            merged: p.merged,
            done: p.done,
            ...(p.error ? { error: p.error } : {}),
          }),
      }).catch((err: unknown) => {
        broadcast("import.progress", {
          source,
          step: "import failed",
          created: 0,
          merged: 0,
          done: true,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return reply.code(202).send({ started: true as const });
    },
  );
}
