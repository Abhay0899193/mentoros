import type { FastifyInstance } from "fastify";
import type { CoreEvents } from "../types.js";
import { GuideError } from "./guides.js";
import type { LearningEngine } from "./engine.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

/** Register /learning/* and /mission/* routes (mirror of coreClient §Learning). */
export function registerLearningRoutes(
  app: FastifyInstance,
  deps: {
    engine: LearningEngine;
    broadcast: Broadcast;
    /**
     * In-app "New guide" generator (Phase G). Injected by the server (needs the
     * model router + kb engine); undefined only in narrow tests that don't wire it.
     */
    guideGenerator?: { generate: (prompt: string) => Promise<void> };
  },
): void {
  const { engine, broadcast, guideGenerator } = deps;

  app.get("/learning/summary", async () => engine.summary());
  app.get("/learning/weeks", async () => engine.weeks());

  app.get<{ Params: { id: string } }>(
    "/learning/days/:id/tasks",
    async (req) => engine.dayTasks(req.params.id),
  );

  app.get<{ Params: { id: string } }>(
    "/learning/days/:id/notes",
    async (req) => ({ notes: engine.dayNotes(req.params.id) }),
  );

  // Pasted study-ui `study-progress` localStorage export (see importer.ts).
  app.post<{ Body: { progress?: unknown } }>(
    "/learning/progress/import",
    async (req, reply) => {
      const progress = req.body?.progress;
      if (typeof progress !== "object" || progress === null) {
        return reply
          .code(400)
          .send({ error: "progress must be the study-progress JSON object" });
      }
      const result = engine.importProgress(progress);
      broadcast("learning.progress", { summary: result.summary });
      return result;
    },
  );

  app.post<{ Params: { id: string }; Body: { done?: boolean } }>(
    "/learning/tasks/:id/complete",
    async (req, reply) => {
      const done = req.body?.done ?? true;
      const summary = engine.completeTask(req.params.id, done);
      if (!summary) return reply.code(404).send({ error: "task not found" });
      broadcast("learning.progress", { summary });
      return summary;
    },
  );

  app.get("/learning/reviews", async () => engine.reviews());

  app.get<{ Querystring: { days?: string } }>(
    "/learning/heatmap",
    async (req) => {
      const n = Number.parseInt(req.query.days ?? "", 10);
      return engine.heatmap(Number.isFinite(n) && n > 0 ? n : 84);
    },
  );

  app.get("/mission/today", async () => engine.todayMission());

  app.post<{ Params: { id: string }; Body: { done?: boolean } }>(
    "/mission/items/:id/complete",
    async (req, reply) => {
      const done = req.body?.done ?? true;
      const mission = engine.completeMissionItem(req.params.id, done);
      if (!mission) return reply.code(404).send({ error: "mission item not found" });
      broadcast("mission.updated", { mission });
      broadcast("learning.progress", { summary: engine.summary() });
      return mission;
    },
  );

  /**
   * "New guide" (Phase G): writes ONE supplementary study-guide part to
   * STUDY-GUIDES/custom/<slug>.md from a prompt, then ingests it — NEVER
   * touches STUDY-GUIDES/week-NN/. Fire-and-forget: progress arrives over
   * `guide.progress` (§coreClient); this just starts it or reports why not.
   */
  app.post<{ Body: { prompt?: string } }>("/learning/guides", async (req, reply) => {
    const prompt = req.body?.prompt;
    if (typeof prompt !== "string") {
      return reply.code(400).send({ error: "prompt is required" });
    }
    if (!guideGenerator) {
      return reply.code(503).send({ error: "guide generator unavailable" });
    }
    try {
      // generate() validates + single-flight-checks SYNCHRONOUSLY (throws a
      // GuideError before any await) — caught here for an immediate 400/409.
      // The returned promise (the actual slow generation) is fire-and-forget;
      // its own failures already reached the client via `guide.progress`.
      const promise = guideGenerator.generate(prompt);
      promise.catch(() => {
        /* already broadcast as guide.progress {step:'error'} */
      });
      return reply.code(202).send({ started: true as const });
    } catch (err) {
      if (err instanceof GuideError) {
        return reply.code(err.status).send({ error: err.message });
      }
      return reply.code(500).send({ error: "could not start guide generation" });
    }
  });
}
