import type { FastifyInstance } from "fastify";
import type {
  InterviewLanguage,
  InterviewMode,
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
import { LeetCodeFetchError, LeetCodeNotFound } from "./leetcode.js";
import { PageExtractError, PageFetchError, PageUrlError } from "./page.js";

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

  // Resolve a bank/custom problem by its LeetCode titleSlug (case-insensitive).
  app.get<{ Params: { slug: string } }>(
    "/interview/problems/by-slug/:slug",
    async (req, reply) => {
      const problem = engine.problemBySlug(req.params.slug);
      if (!problem) return reply.code(404).send({ error: "problem not found" });
      return { problem };
    },
  );

  // Fetch a statement from LeetCode's public GraphQL (practice-mode import).
  // 404 = unknown slug, 502 = network/parse failure — renderer falls back to paste.
  app.post<{ Body: { slug?: string } }>(
    "/interview/lc/fetch",
    async (req, reply) => {
      const slug = req.body?.slug?.trim();
      if (!slug) return reply.code(400).send({ error: "slug is required" });
      try {
        return await engine.fetchLeetCode(slug);
      } catch (err) {
        if (err instanceof LeetCodeNotFound) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof LeetCodeFetchError) {
          return reply.code(502).send({ error: err.message });
        }
        return reply.code(502).send({ error: "could not reach LeetCode" });
      }
    },
  );

  // Fetch + extract an arbitrary problem page (import-from-URL). 400 = bad
  // URL, 422 = fetched but no readable statement (client-rendered sites),
  // 502 = network failure — renderer falls back to paste in every case.
  app.post<{ Body: { url?: string } }>(
    "/interview/page/fetch",
    async (req, reply) => {
      const url = req.body?.url?.trim();
      if (!url) return reply.code(400).send({ error: "url is required" });
      try {
        return await engine.fetchPage(url);
      } catch (err) {
        if (err instanceof PageUrlError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof PageExtractError) {
          return reply.code(422).send({ error: err.message });
        }
        if (err instanceof PageFetchError) {
          return reply.code(502).send({ error: err.message });
        }
        return reply.code(502).send({ error: "could not fetch that page" });
      }
    },
  );

  app.post<{
    Body: {
      type?: InterviewType;
      problemId?: string;
      language?: InterviewLanguage;
      mode?: InterviewMode;
    };
  }>("/interview/sessions", async (req, reply) => {
    const type = req.body?.type ?? "coding";
    const language = req.body?.language ?? "python";
    const mode: InterviewMode = req.body?.mode === "practice" ? "practice" : "interview";
    if (type !== "coding") {
      return reply.code(400).send({ error: "only coding interviews are available" });
    }
    try {
      const input: {
        type: InterviewType;
        language: InterviewLanguage;
        mode: InterviewMode;
        problemId?: string;
      } = { type, language, mode };
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
