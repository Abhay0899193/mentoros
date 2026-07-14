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

interface ImportProgress {
  step: string;
  created: number;
  merged: number;
  done: boolean;
  error?: string;
}

/**
 * Snapshot of the most recent import job. Polled via GET /import/status as a
 * WS-miss fallback: the renderer spinner is driven by `import.progress` events,
 * and a dropped terminal ('done') event would otherwise strand it forever.
 */
interface ImportJob {
  source: ImportSource;
  path: string;
  step: string;
  created: number;
  merged: number;
  error?: string;
  active: boolean;
  done: boolean;
  startedAt: number;
  finishedAt?: number;
}

/** Handle returned to the server so boot auto-sync reuses the import runner. */
export interface MemoryRoutesHandle {
  /**
   * Run the 3mc import through the same code path as POST /import (job record +
   * digest persistence + graph relink). No-op when no 3mc importer is wired.
   */
  run3mc: (path: string) => Promise<void>;
}

/** Register the memory + import HTTP routes (mirror of coreClient §Memory). */
export function registerMemoryRoutes(
  app: FastifyInstance,
  deps: {
    engine: MemoryEngine;
    broadcast: Broadcast;
    /** Injected by the server so the 3mc plan importer stays in the learning module. */
    import3mc?: (
      path: string,
      onProgress: (p: ImportProgress) => void,
    ) => Promise<{ created: number; merged: number }>;
    /**
     * Persist `{ sourcePath, digest }` after a successful 3mc import so boot
     * auto-sync can detect out-of-date sources. Best-effort; called by the
     * shared runner only on a clean finish.
     */
    persistImportMeta?: (path: string) => void;
  },
): MemoryRoutesHandle {
  const { engine, broadcast, import3mc, persistImportMeta } = deps;

  let lastImportJob: ImportJob | null = null;

  const startJob = (source: ImportSource, path: string): void => {
    lastImportJob = {
      source,
      path,
      step: "starting",
      created: 0,
      merged: 0,
      active: true,
      done: false,
      startedAt: Date.now(),
    };
  };

  // Progressive fields only. created/merged are monotonic across a run, so keep
  // the max (the trailing relink event reports 0/0 and must not clobber totals).
  const updateJob = (p: ImportProgress): void => {
    if (!lastImportJob) return;
    lastImportJob.step = p.step;
    if (p.created > lastImportJob.created) lastImportJob.created = p.created;
    if (p.merged > lastImportJob.merged) lastImportJob.merged = p.merged;
  };

  const finalizeJob = (error?: string): void => {
    if (!lastImportJob) return;
    lastImportJob.active = false;
    lastImportJob.done = true;
    lastImportJob.finishedAt = Date.now();
    if (error) lastImportJob.error = error;
    else delete lastImportJob.error;
  };

  /**
   * Single code path for every import (POST /import + boot auto-sync): stamp the
   * job record, broadcast progress, relink the graph, then persist meta + mark
   * terminal. `task` performs the actual ingest; `onSuccess` runs only on a
   * clean finish (no captured terminal error).
   */
  const runImport = async (
    source: ImportSource,
    path: string,
    task: (emit: (p: ImportProgress) => void) => Promise<unknown>,
    onSuccess?: () => void,
  ): Promise<void> => {
    startJob(source, path);
    let capturedError: string | undefined;
    const emit = (p: ImportProgress): void => {
      updateJob(p);
      if (p.done && p.error) capturedError = p.error;
      broadcast("import.progress", {
        source,
        step: p.step,
        created: p.created,
        merged: p.merged,
        done: p.done,
        ...(p.error ? { error: p.error } : {}),
      });
    };
    try {
      await task(emit);
      runLinkPass(source);
      if (!capturedError) onSuccess?.();
      finalizeJob(capturedError);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      finalizeJob(msg);
      broadcast("import.progress", {
        source,
        step: "import failed",
        created: 0,
        merged: 0,
        done: true,
        error: msg,
      });
    }
  };

  /** Auto-link the graph after any import (fail-safe; never throws to caller). */
  const runLinkPass = (source: ImportSource): void => {
    try {
      const edges = engine.linkPass();
      broadcast("import.progress", {
        source,
        step: `linked memory graph (${edges} edges)`,
        created: 0,
        merged: 0,
        done: true,
      });
    } catch {
      /* linking is best-effort */
    }
  };

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

  /** Manually re-run the auto-linking pass. */
  app.post("/memories/relink", async () => ({ edges: engine.linkPass() }));

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
        if (!import3mc) {
          return reply.code(503).send({ error: "3mc importer unavailable" });
        }
        // Fire-and-forget: progress + completion arrive over /events; the job
        // record backs the GET /import/status fallback.
        void runImport(
          source,
          abs,
          (emit) => import3mc(abs, emit),
          () => persistImportMeta?.(abs),
        );
        return reply.code(202).send({ started: true as const });
      }

      // Fire-and-forget: progress + completion arrive over /events.
      void runImport(source, abs, (emit) =>
        importInterviewPrep({
          path: abs,
          saveMemory: (input) => engine.saveMemory(input),
          onProgress: emit,
        }),
      );

      return reply.code(202).send({ started: true as const });
    },
  );

  /** WS-miss fallback for the import spinner (see {@link ImportJob}). */
  app.get("/import/status", async () => lastImportJob ?? { active: false, done: false });

  return {
    run3mc: async (path: string) => {
      if (!import3mc) return;
      await runImport(
        "3mc",
        path,
        (emit) => import3mc(path, emit),
        () => persistImportMeta?.(path),
      );
    },
  };
}
