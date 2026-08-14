import {
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  HEALTH_SERVICE,
  type HealthResponse,
} from "@snaveevans/openbrain-common";
import { Hono } from "hono";
import { methodNotAllowed } from "hono/method-not-allowed";

import { requireApiKey } from "./auth.js";
import { CACHE_CONTROL_NO_STORE, jsonError } from "./http.js";

export type ApiBindings = {
  API_KEY?: string;
};

export function createApp() {
  const app = new Hono<{ Bindings: ApiBindings }>({ strict: false });

  app.use(async (c, next) => {
    await next();
    c.header("Cache-Control", CACHE_CONTROL_NO_STORE);
  });

  app.use(requireApiKey);

  app.use(
    methodNotAllowed({
      app,
      onMethodNotAllowed: (c) => jsonError(c, 405, ERROR_METHOD_NOT_ALLOWED),
    }),
  );

  app.get("/v1/health", (c) => {
    const body: HealthResponse = { ok: true, service: HEALTH_SERVICE };
    return c.json(body);
  });

  // Known authenticated routes. Operation behavior is issues #5–#8.
  app.post("/v1/memories", (c) => jsonError(c, 404, ERROR_NOT_FOUND));
  app.post("/v1/memories/search", (c) => jsonError(c, 404, ERROR_NOT_FOUND));
  app.get("/v1/memories/:id", (c) => jsonError(c, 404, ERROR_NOT_FOUND));
  app.delete("/v1/memories/:id", (c) => jsonError(c, 404, ERROR_NOT_FOUND));

  app.notFound((c) => jsonError(c, 404, ERROR_NOT_FOUND));

  app.onError((err, c) => {
    const configured = (c.env?.API_KEY ?? "").trim();
    const raw = err instanceof Error && err.message ? err.message : "Internal error.";
    const error =
      configured.length > 0 && raw.includes(configured) ? "Internal error." : raw;
    return jsonError(c, 500, error);
  });

  return app;
}
