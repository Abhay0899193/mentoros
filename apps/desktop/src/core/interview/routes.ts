import type { FastifyInstance } from "fastify";
import type { InterviewLanguage, InterviewType } from "../types.js";
import {
  InterviewConflict,
  InterviewNotFound,
  type InterviewEngine,
} from "./engine.js";

/**
 * Register the /interview/* HTTP routes (mirror of coreClient §Interview
 * Platform). Interviewer replies stream over the /events websocket via
 * interview.token / interview.status; the POST bodies here resolve immediately
 * with the turn ids so the renderer can bind the incoming stream.
 */
export function registerInterviewRoutes(
  app: FastifyInstance,
  deps: { engine: InterviewEngine },
): void {
  const { engine } = deps;

  app.get<{ Querystring: { type?: InterviewType } }>(
    "/interview/problems",
    async (req) => engine.listProblems(req.query?.type ?? "coding"),
  );

  app.get("/interview/sessions", async () => engine.listSessions());

  app.post<{
    Body: { type?: InterviewType; problemId?: string; language?: InterviewLanguage };
  }>("/interview/sessions", async (req, reply) => {
    const type = req.body?.type ?? "coding";
    const language = req.body?.language ?? "python";
    if (type !== "coding") {
      return reply.code(400).send({ error: "only coding interviews are available" });
    }
    try {
      const input: {
        type: InterviewType;
        language: InterviewLanguage;
        problemId?: string;
      } = { type, language };
      if (req.body?.problemId) input.problemId = req.body.problemId;
      return engine.startSession(input);
    } catch (err) {
      if (err instanceof InterviewNotFound) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>(
    "/interview/sessions/:id",
    async (req, reply) => {
      const full = engine.getFullSession(req.params.id);
      if (!full) return reply.code(404).send({ error: "session not found" });
      return full;
    },
  );

  app.post<{ Params: { id: string }; Body: { content?: string } }>(
    "/interview/sessions/:id/say",
    async (req, reply) => {
      const content = req.body?.content;
      if (!content || content.trim().length === 0) {
        return reply.code(400).send({ error: "content is required" });
      }
      try {
        return engine.say(req.params.id, content);
      } catch (err) {
        if (err instanceof InterviewNotFound) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/interview/sessions/:id/hint",
    async (req, reply) => {
      try {
        return engine.hint(req.params.id);
      } catch (err) {
        if (err instanceof InterviewNotFound) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof InterviewConflict) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { code?: string } }>(
    "/interview/sessions/:id/run",
    async (req, reply) => {
      const code = req.body?.code ?? "";
      try {
        return await engine.run(req.params.id, code);
      } catch (err) {
        if (err instanceof InterviewNotFound) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { code?: string } }>(
    "/interview/sessions/:id/finish",
    async (req, reply) => {
      const code = req.body?.code ?? "";
      try {
        return engine.finish(req.params.id, code);
      } catch (err) {
        if (err instanceof InterviewNotFound) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/interview/sessions/:id/end",
    async (req, reply) => {
      try {
        return engine.end(req.params.id);
      } catch (err) {
        if (err instanceof InterviewNotFound) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/interview/sessions/:id/abandon",
    async (req, reply) => {
      const ok = engine.abandon(req.params.id);
      if (!ok) return reply.code(404).send({ error: "session not found" });
      return reply.code(204).send();
    },
  );
}
