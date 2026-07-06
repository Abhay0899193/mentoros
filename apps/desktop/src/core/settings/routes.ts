import type { FastifyInstance } from "fastify";
import { SettingsStore, SettingsValidationError } from "./store.js";
import type { CoreEvents } from "../types.js";

type Broadcast = <E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]) => void;

export interface SettingsDeps {
  store: SettingsStore;
  broadcast: Broadcast;
}

/**
 * GET /settings → full AppSettings. POST /settings → validate + persist a
 * partial patch, return the merged settings, and broadcast `settings.changed`
 * so every screen re-reads what it cares about. Invalid patches 400 with the
 * offending key/value and persist nothing.
 */
export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsDeps): void {
  app.get("/settings", async () => deps.store.get());

  app.post<{ Body: unknown }>("/settings", async (req, reply) => {
    try {
      const settings = deps.store.patch(req.body ?? {});
      deps.broadcast("settings.changed", { settings });
      return settings;
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });
}
