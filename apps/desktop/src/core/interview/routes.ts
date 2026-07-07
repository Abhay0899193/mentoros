import type { FastifyInstance } from "fastify";
import type {
  InterviewLanguage,
  InterviewProblemDraft,
  InterviewType,
} from "../types.js";
import {
  DraftGenerationError,
  DraftInvalidError,
  InterviewConflict,
  InterviewForbidden,
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

  /* ------------------------------ importer ------------------------------ */

  app.post<{ Body: { sourceText?: string } }>(
    "/interview/import/draft",
    async (req, reply) => {
      const sourceText = req.body?.sourceText;
      if (!sourceText || sourceText.trim().length === 0) {
        return reply.code(400).send({ error: "sourceText is required" });
      }
      try {
        return await engine.importDraft(sourceText);
      } catch (err) {
        if (err instanceof DraftGenerationError) {
          return reply.code(502).send({ message: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Body: { draft?: InterviewProblemDraft } }>(
    "/interview/import/validate",
    async (req, reply) => {
      const draft = req.body?.draft;
      if (!draft) return reply.code(400).send({ error: "draft is required" });
      return engine.validateDraftInput(draft);
    },
  );

  app.post<{ Body: { draft?: InterviewProblemDraft } }>(
    "/interview/import",
    async (req, reply) => {
      const draft = req.body?.draft;
      if (!draft) return reply.code(400).send({ error: "draft is required" });
      try {
        return await engine.saveDraftInput(draft);
      } catch (err) {
        if (err instanceof DraftInvalidError) {
          return reply.code(422).send({ message: err.message, validation: err.validation });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/interview/problems/:id",
    async (req, reply) => {
      try {
        const ok = engine.deleteProblem(req.params.id);
        if (!ok) return reply.code(404).send({ error: "problem not found" });
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof InterviewForbidden) {
          return reply.code(403).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
