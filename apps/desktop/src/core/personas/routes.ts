import type { FastifyInstance } from "fastify";
import type { AppSettings, CoreEvents, PersonaDraftRequest } from "../types.js";
import {
  PersonaForbiddenError,
  PersonaNotFoundError,
  PersonaStore,
  PersonaValidationError,
} from "./store.js";
import { generatePersonaDraft, PersonaDraftError, type PersonaDraftOnce } from "./draft.js";

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

export interface PersonaDeps {
  store: PersonaStore;
  broadcast: Broadcast;
  /** Router-bound single-shot completion (scorecard surface) for drafting. */
  draftOnce: PersonaDraftOnce;
  /** Current settings, for the settings.changed carried by an active-persona reset. */
  getSettings: () => AppSettings;
}

/**
 * /personas HTTP routes (mirror of coreClient §personas). Every mutation
 * broadcasts `personas.changed` with the full fresh list so pickers re-fetch.
 * Built-ins are read-only (403); unknown ids 404; invalid input 422; drafting
 * failure 502 — all with designed bodies.
 */
export function registerPersonaRoutes(app: FastifyInstance, deps: PersonaDeps): void {
  const { store, broadcast } = deps;
  const changed = () => broadcast("personas.changed", { personas: store.list() });

  app.get("/personas", async () => store.list());

  app.post<{ Body: unknown }>("/personas", async (req, reply) => {
    try {
      const record = store.create(req.body ?? {});
      changed();
      return record;
    } catch (err) {
      if (err instanceof PersonaValidationError) {
        return reply.code(422).send({ error: err.message });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/personas/:id",
    async (req, reply) => {
      try {
        const record = store.update(req.params.id, req.body ?? {});
        changed();
        return record;
      } catch (err) {
        if (err instanceof PersonaForbiddenError) {
          return reply.code(403).send({ error: err.message });
        }
        if (err instanceof PersonaNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof PersonaValidationError) {
          return reply.code(422).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/personas/:id", async (req, reply) => {
    try {
      const { activePersonaReset } = store.delete(req.params.id);
      if (activePersonaReset) {
        // The reset persisted inside store.delete; carry the whole new settings.
        broadcast("settings.changed", { settings: deps.getSettings() });
      }
      changed();
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof PersonaForbiddenError) {
        return reply.code(403).send({ error: err.message });
      }
      if (err instanceof PersonaNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Body: Partial<PersonaDraftRequest> }>(
    "/personas/draft",
    async (req, reply) => {
      const description = req.body?.description;
      if (typeof description !== "string" || description.trim().length === 0) {
        return reply.code(400).send({ error: "description is required" });
      }
      const request: PersonaDraftRequest = { description };
      if (typeof req.body?.name === "string") request.name = req.body.name;
      if (req.body?.style) request.style = req.body.style;
      try {
        return await generatePersonaDraft(request, deps.draftOnce);
      } catch (err) {
        if (err instanceof PersonaDraftError) {
          return reply.code(502).send({ error: err.message, detail: err.detail });
        }
        throw err;
      }
    },
  );
}
