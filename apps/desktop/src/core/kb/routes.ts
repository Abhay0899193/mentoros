import { execFile } from "node:child_process";
import type { FastifyInstance } from "fastify";
import type { KbEngine } from "./engine.js";

/**
 * Register the /kb/* HTTP routes (mirror of coreClient §Knowledge Base). Ingest
 * is fire-and-forget: the POST resolves with { sourceId } once the source row
 * exists, and chunk/embed progress streams over the /events websocket.
 */
export function registerKbRoutes(
  app: FastifyInstance,
  deps: { engine: KbEngine },
): void {
  const { engine } = deps;

  app.get("/kb/sources", async () => engine.listSources());

  app.post<{ Body: { path?: string; title?: string; tags?: string[] } }>(
    "/kb/sources",
    async (req, reply) => {
      const path = req.body?.path;
      if (!path || path.trim().length === 0) {
        return reply.code(400).send({ error: "path is required" });
      }
      const opts: { title?: string; tags?: string[] } = {};
      if (req.body?.title) opts.title = req.body.title;
      if (req.body?.tags) opts.tags = req.body.tags;
      let prepared;
      try {
        prepared = engine.prepareSource(path, opts);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "invalid path" });
      }
      // Fire-and-forget: progress + completion arrive over /events.
      void engine.runIngest(prepared);
      return { sourceId: prepared.sourceId };
    },
  );

  app.delete<{ Params: { id: string } }>("/kb/sources/:id", async (req, reply) => {
    const ok = engine.deleteSource(req.params.id);
    if (!ok) return reply.code(404).send({ error: "source not found" });
    return reply.code(204).send();
  });

  app.patch<{ Params: { id: string }; Body: { read?: boolean } }>(
    "/kb/sources/:id/read",
    async (req, reply) => {
      if (typeof req.body?.read !== "boolean") {
        return reply.code(400).send({ error: "read (boolean) is required" });
      }
      const source = engine.setSourceRead(req.params.id, req.body.read);
      if (!source) return reply.code(404).send({ error: "source not found" });
      return { source };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/kb/sources/:id/open",
    async (req, reply) => {
      const source = engine.getSource(req.params.id);
      if (!source) return reply.code(404).send({ error: "source not found" });
      // Reveal in the OS file manager. macOS: `open -R` reveals a file in Finder;
      // a folder is opened directly. Best-effort — never blocks the response.
      const args = source.kind === "folder" ? [source.path] : ["-R", source.path];
      execFile("open", args, () => undefined);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: { query?: string; k?: number; sourceIds?: string[] } }>(
    "/kb/search",
    async (req, reply) => {
      const query = req.body?.query;
      if (!query || query.trim().length === 0) {
        return reply.code(400).send({ error: "query is required" });
      }
      const opts: { k?: number; sourceIds?: string[] } = {};
      if (typeof req.body?.k === "number") opts.k = req.body.k;
      if (req.body?.sourceIds) opts.sourceIds = req.body.sourceIds;
      return engine.searchPublic(query, opts);
    },
  );

  app.get("/kb/suggestions", async () => engine.suggestions());

  app.get<{ Params: { id: string }; Querystring: { file?: string } }>(
    "/kb/sources/:id/text",
    async (req, reply) => {
      const result = await engine.sourceText(req.params.id, req.query.file);
      if (!result) return reply.code(404).send({ error: "source not found" });
      return result;
    },
  );
}
