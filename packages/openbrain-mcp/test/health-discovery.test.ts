import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CACHE_CONTROL_NO_STORE, MCP_HEALTH_SERVICE } from "../src/http.js";
import { API_KEY, makeEnv } from "./helpers.js";
import { FakeKV, FakeRest } from "./fakes.js";

describe("GET /health", () => {
  it("is unauthenticated and returns 200 { ok, service } with no secrets", async () => {
    const app = createApp();
    const res = await app.request(
      "/health",
      {},
      makeEnv(new FakeKV(), { TOKEN_SECRET: "super-secret" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, service: MCP_HEALTH_SERVICE });
    expect(JSON.stringify(body)).not.toContain(API_KEY);
    expect(JSON.stringify(body)).not.toContain("super-secret");
  });

  it("does not proxy REST (zero upstream) even when REST is down", async () => {
    const rest = new FakeRest();
    rest.throw("unreachable");
    const app = createApp({ rest });
    const res = await app.request("/health", {}, makeEnv(new FakeKV()));
    expect(res.status).toBe(200);
    expect(rest.requestCount).toBe(0);
  });

  it("treats a trailing slash as the same route", async () => {
    const app = createApp();
    const res = await app.request("/health/", {}, makeEnv(new FakeKV()));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({
      ok: true,
      service: MCP_HEALTH_SERVICE,
    });
  });
});

describe("well-known discovery documents", () => {
  const ORIGIN = "http://localhost";

  it("GET /.well-known/oauth-protected-resource (RFC 9728), unauthenticated, no-store", async () => {
    const app = createApp();
    const res = await app.request(
      "/.well-known/oauth-protected-resource",
      {},
      makeEnv(new FakeKV()),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    expect(res.headers.get("content-type") ?? "").toMatch(/json/);
    expect((await res.json()) as unknown).toEqual({
      resource: `${ORIGIN}/mcp`,
      authorization_servers: [ORIGIN],
      bearer_methods_supported: ["header"],
    });
  });

  it("GET /.well-known/oauth-authorization-server (RFC 8414), unauthenticated, no-store", async () => {
    const app = createApp();
    const res = await app.request(
      "/.well-known/oauth-authorization-server",
      {},
      makeEnv(new FakeKV()),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    expect((await res.json()) as unknown).toEqual({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post",
      ],
    });
  });

  it("wrong method on a well-known path → 405", async () => {
    const app = createApp();
    const res = await app.request(
      "/.well-known/oauth-authorization-server",
      { method: "POST", body: "x" },
      makeEnv(new FakeKV()),
    );
    expect(res.status).toBe(405);
  });
});
