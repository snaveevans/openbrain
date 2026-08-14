import {
  API_KEY_HEADER,
  ERROR_API_KEY_NOT_CONFIGURED,
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  ERROR_UNAUTHORIZED,
  HEALTH_SERVICE,
} from "@snaveevans/openbrain-common";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { secretsEqual } from "../src/auth.js";
import { CACHE_CONTROL_NO_STORE } from "../src/http.js";

const KEY = "test-api-key";
const env = { API_KEY: KEY };

function request(path: string, init: RequestInit = {}, bindings: { API_KEY?: string } = env) {
  return createApp().request(path, init, bindings);
}

describe("GET /v1/health", () => {
  it("is unauthenticated and returns readiness JSON", async () => {
    const res = await request("/v1/health", {}, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    await expect(res.json()).resolves.toEqual({ ok: true, service: HEALTH_SERVICE });
  });

  it("treats a trailing slash as the same route", async () => {
    const res = await request("/v1/health/");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, service: HEALTH_SERVICE });
  });

  it("does not include secrets or an auth_provider field", async () => {
    const res = await request("/v1/health", {}, { API_KEY: KEY });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, service: HEALTH_SERVICE });
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(body).not.toHaveProperty("auth_provider");
  });
});

describe("API_KEY gate", () => {
  it("returns 500 when the server key is missing", async () => {
    const res = await request("/v1/memories", { method: "POST" }, {});
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: ERROR_API_KEY_NOT_CONFIGURED });
  });

  it("returns 500 when the server key is whitespace", async () => {
    const res = await request("/v1/memories", { method: "POST" }, { API_KEY: "   " });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: ERROR_API_KEY_NOT_CONFIGURED });
  });

  it("returns 401 for a missing header", async () => {
    const res = await request("/v1/memories", { method: "POST" });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
  });

  it("returns 401 for a wrong key and does not distinguish it from missing", async () => {
    const res = await request("/v1/memories", {
      method: "POST",
      headers: { [API_KEY_HEADER]: "nope" },
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
  });

  it("does not accept the key as a Bearer token", async () => {
    const res = await request("/v1/memories", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
  });

  it("does not accept the key in the query string", async () => {
    const res = await request(`/v1/memories?api_key=${KEY}`, { method: "POST" });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
  });

  it("accepts a trimmed matching key on every memory route", async () => {
    const headers = { [API_KEY_HEADER]: `  ${KEY}  ` };
    const routes: Array<[string, string]> = [
      ["POST", "/v1/memories"],
      ["POST", "/v1/memories/search"],
      ["GET", "/v1/memories/00000000-0000-4000-8000-000000000001"],
      ["DELETE", "/v1/memories/00000000-0000-4000-8000-000000000001"],
    ];
    for (const [method, path] of routes) {
      const res = await request(path, { method, headers });
      expect(res.status, `${method} ${path}`).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: ERROR_NOT_FOUND });
    }
  });
});

describe("error envelope", () => {
  it("returns 404 { error } for an unknown path", async () => {
    const res = await request("/v1/nope", { headers: { [API_KEY_HEADER]: KEY } });
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    await expect(res.json()).resolves.toEqual({ error: ERROR_NOT_FOUND });
  });

  it("returns 405 { error } for the wrong method on a known path", async () => {
    const health = await request("/v1/health", { method: "POST" });
    expect(health.status).toBe(405);
    await expect(health.json()).resolves.toEqual({ error: ERROR_METHOD_NOT_ALLOWED });

    const memories = await request("/v1/memories", {
      method: "GET",
      headers: { [API_KEY_HEADER]: KEY },
    });
    expect(memories.status).toBe(405);
    await expect(memories.json()).resolves.toEqual({ error: ERROR_METHOD_NOT_ALLOWED });
  });

  it("does not publish OAuth discovery routes", async () => {
    const res = await request("/.well-known/oauth-authorization-server", {
      headers: { [API_KEY_HEADER]: KEY },
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: ERROR_NOT_FOUND });
  });

  it("does not leak the API key from an unexpected 500", async () => {
    const app = createApp();
    app.get("/v1/boom", () => {
      throw new Error(`failed for ${KEY}`);
    });
    const res = await app.request(
      "/v1/boom",
      { headers: { [API_KEY_HEADER]: KEY } },
      env,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain(KEY);
    expect(body.error).toBe("Internal error.");
  });
});

describe("secretsEqual", () => {
  it("matches equal strings and rejects others", async () => {
    expect(await secretsEqual("abc", "abc")).toBe(true);
    expect(await secretsEqual("abc", "abd")).toBe(false);
    expect(await secretsEqual("abc", "ab")).toBe(false);
  });
});
