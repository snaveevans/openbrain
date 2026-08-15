import {
  ERROR_INVALID_JSON,
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  HEALTH_SERVICE,
  type HealthResponse,
  type MemoryStore,
  type VectorIndex,
} from "@snaveevans/openbrain-common";
import { Hono } from "hono";
import { methodNotAllowed } from "hono/method-not-allowed";

import { requireApiKey } from "./auth.js";
import {
  createMemory,
  parseCreateBody,
  productionCreateDeps,
} from "./create.js";
import { D1MemoryStore } from "./d1-store.js";
import { deleteMemory, productionDeleteDeps } from "./delete.js";
import type { ApiBindings, AppOptions, DeleteDeps } from "./env.js";
import { ValidationError } from "./errors.js";
import { fetchMemory, LookupError, parseMemoryId } from "./fetch.js";
import { CACHE_CONTROL_NO_STORE, jsonError } from "./http.js";
import { VectorizeMemoryIndex } from "./vectorize-index.js";
import { WorkersAiEmbedder } from "./workers-ai-embedder.js";

export type { ApiBindings } from "./env.js";

export function createApp(options: AppOptions = {}) {
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

  app.post("/v1/memories", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return jsonError(c, 400, ERROR_INVALID_JSON);
    }

    let input;
    try {
      input = parseCreateBody(raw);
    } catch (error) {
      if (error instanceof ValidationError) {
        return jsonError(c, 400, error.message);
      }
      throw error;
    }

    const deps = options.create ?? runtimeCreateDeps(c.env);
    const created = await createMemory(input, deps);
    return c.json(created, 201);
  });

  app.get("/v1/memories/:id", async (c) => {
    let id: string;
    try {
      id = parseMemoryId(c.req.param("id"));
    } catch (error) {
      if (error instanceof ValidationError) {
        return jsonError(c, 400, error.message);
      }
      throw error;
    }

    try {
      const fetched = await fetchMemory(id, resolveStore(c.env, options));
      return c.json(fetched);
    } catch (error) {
      if (error instanceof LookupError) {
        return jsonError(c, 404, error.message);
      }
      throw error;
    }
  });

  app.delete("/v1/memories/:id", async (c) => {
    let id: string;
    try {
      id = parseMemoryId(c.req.param("id"));
    } catch (error) {
      if (error instanceof ValidationError) {
        return jsonError(c, 400, error.message);
      }
      throw error;
    }

    try {
      const result = await deleteMemory(id, resolveDeleteDeps(c.env, options));
      if (result.kind === "deleted") {
        return c.json(result.body);
      }
      // Orphan-index envelope is an Open Question. The leftover vector is gone.
      return jsonError(c, 500, "Internal error.");
    } catch (error) {
      if (error instanceof LookupError) {
        return jsonError(c, 404, error.message);
      }
      throw error;
    }
  });

  // Remaining operation behavior is issue #8.
  app.post("/v1/memories/search", (c) => jsonError(c, 404, ERROR_NOT_FOUND));

  app.notFound((c) => jsonError(c, 404, ERROR_NOT_FOUND));

  app.onError((err, c) => {
    const configured = (c.env?.API_KEY ?? "").trim();
    const raw =
      err instanceof Error && err.message ? err.message : "Internal error.";
    const error =
      configured.length > 0 && raw.includes(configured)
        ? "Internal error."
        : raw;
    return jsonError(c, 500, error);
  });

  return app;
}

function resolveStore(env: ApiBindings, options: AppOptions): MemoryStore {
  if (options.store) {
    return options.store;
  }
  if (options.create) {
    return options.create.store;
  }
  if (!env.DB) {
    throw new Error("Storage bindings are not configured.");
  }
  return new D1MemoryStore(env.DB);
}

function resolveIndex(env: ApiBindings, options: AppOptions): VectorIndex {
  if (options.index) {
    return options.index;
  }
  if (options.create) {
    return options.create.index;
  }
  if (!env.VECTORIZE) {
    throw new Error("Storage bindings are not configured.");
  }
  return new VectorizeMemoryIndex(env.VECTORIZE);
}

function resolveDeleteDeps(env: ApiBindings, options: AppOptions): DeleteDeps {
  return productionDeleteDeps(
    resolveStore(env, options),
    resolveIndex(env, options),
  );
}

function runtimeCreateDeps(env: ApiBindings) {
  if (!env.DB || !env.AI || !env.VECTORIZE) {
    throw new Error("Storage bindings are not configured.");
  }
  return productionCreateDeps(
    new D1MemoryStore(env.DB),
    new WorkersAiEmbedder(env.AI),
    new VectorizeMemoryIndex(env.VECTORIZE),
  );
}
