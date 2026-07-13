import type { FastifyInstance } from "fastify";
import type { CoreEvents } from "../types.js";
import type { LearningEngine } from "./engine.js";

type Broadcast = <E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E],
) => void;

/** Register /learning/* and /mission/* routes (mirror of coreClient §Learning). */
export function registerLearningRoutes(
  app: FastifyInstance,
  deps: { engine: LearningEngine; broadcast: Broadcast },
): void {
  const { engine, broadcast } = deps;

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
}
