import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CACHE_CONTROL_NO_STORE } from "../src/http.js";
import { ERR_INVALID_API_KEY } from "../src/oauth.js";
import {
  API_KEY,
  authorizePost,
  makeEnv,
  MCP_CLIENTS_BAD_SHAPE,
  MCP_CLIENTS_JSON,
  PKCE_CHALLENGE,
  PUBLIC_CLIENT_ID,
  PUBLIC_REDIRECT,
} from "./helpers.js";
import { FakeKV } from "./fakes.js";

/** Valid authorize params for the public client (used as a base in tests). */
const PUBLIC_PARAMS = {
  response_type: "code",
  client_id: PUBLIC_CLIENT_ID,
  redirect_uri: PUBLIC_REDIRECT,
  code_challenge: PKCE_CHALLENGE,
  code_challenge_method: "S256",
};

/** Build a GET /authorize URL with the given query params. */
function authorizeUrl(params: Record<string, string>): string {
  return `/authorize?${new URLSearchParams(params).toString()}`;
}

describe("GET /authorize — form render on valid params", () => {
  it("renders the 'paste your API key' form with hidden fields (200 text/html, no-store)", async () => {
    const app = createApp();
    const res = await app.request(
      authorizeUrl(PUBLIC_PARAMS),
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    const html = await res.text();
    // Hidden fields present and escaped.
    expect(html).toContain(`name="response_type" value="code"`);
    expect(html).toContain(`name="client_id" value="${PUBLIC_CLIENT_ID}"`);
    expect(html).toContain(`name="redirect_uri" value="${PUBLIC_REDIRECT}"`);
    expect(html).toContain(`name="code_challenge" value="${PKCE_CHALLENGE}"`);
    expect(html).toContain(`name="code_challenge_method" value="S256"`);
    // API key input is present and is a password field (not echoed).
    expect(html).toContain(`name="api_key"`);
    expect(html).toContain(`type="password"`);
  });

  it("echoes state as a hidden field when provided", async () => {
    const app = createApp();
    const res = await app.request(
      authorizeUrl({ ...PUBLIC_PARAMS, state: "xyz123" }),
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    const html = await res.text();
    expect(html).toContain(`name="state" value="xyz123"`);
  });
});

describe("GET /authorize — 400 on invalid params, never 302", () => {
  it("unknown client_id → 400 { error: 'Unknown client or redirect URI.' }", async () => {
    const app = createApp();
    const res = await app.request(
      authorizeUrl({ ...PUBLIC_PARAMS, client_id: "not-a-client" }),
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Unknown client or redirect URI.",
    });
  });

  it("known client but unregistered redirect_uri → 400 with the SAME body (no oracle)", async () => {
    const app = createApp();
    const res = await app.request(
      authorizeUrl({
        ...PUBLIC_PARAMS,
        redirect_uri: "https://evil.example.com/cb",
      }),
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Unknown client or redirect URI.",
    });
  });

  it("unknown client and unregistered redirect → byte-identical 400 bodies (no oracle)", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const unknownClient = await app.request(
      authorizeUrl({ ...PUBLIC_PARAMS, client_id: "not-a-client" }),
      {},
      env,
    );
    const badRedirect = await app.request(
      authorizeUrl({
        ...PUBLIC_PARAMS,
        redirect_uri: "https://evil.example.com/cb",
      }),
      {},
      env,
    );
    const body1 = await unknownClient.text();
    const body2 = await badRedirect.text();
    expect(unknownClient.status).toBe(400);
    expect(badRedirect.status).toBe(400);
    expect(body1).toBe(body2);
  });

  it("non-S256 code_challenge_method → 400 { error: 'Invalid authorization request.' }", async () => {
    const app = createApp();
    const res = await app.request(
      authorizeUrl({ ...PUBLIC_PARAMS, code_challenge_method: "plain" }),
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid authorization request.",
    });
  });

  it("missing code_challenge → 400 Invalid authorization request.", async () => {
    const app = createApp();
    const params = { ...PUBLIC_PARAMS };
    delete (params as Record<string, string>).code_challenge;
    const res = await app.request(
      authorizeUrl(params),
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid authorization request.",
    });
  });

  it("wrong response_type → 400 Invalid authorization request.", async () => {
    const app = createApp();
    const res = await app.request(
      authorizeUrl({ ...PUBLIC_PARAMS, response_type: "token" }),
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid authorization request.",
    });
  });
});

describe("POST /authorize — wrong key → 401, no redirect, no echo, HTML-escaped (P0 #6)", () => {
  it("wrong key → 401, form re-rendered with generic 'Invalid API key.', no 302", async () => {
    const app = createApp();
    const res = await app.request(
      "/authorize",
      authorizePost(PUBLIC_PARAMS, "wrong-key"),
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    const html = await res.text();
    expect(html).toContain(ERR_INVALID_API_KEY);
  });

  it("does not echo the pasted key into the 401 form (secret-leak guard)", async () => {
    const app = createApp();
    const pasted = "super-secret-pasted-key-12345";
    const res = await app.request(
      "/authorize",
      authorizePost(PUBLIC_PARAMS, pasted),
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    const html = await res.text();
    expect(html).not.toContain(pasted);
  });

  it("HTML-escapes attacker-influenceable params (reflected-XSS guard)", async () => {
    const app = createApp();
    const xssState = "<script>alert(1)</script>";
    const res = await app.request(
      "/authorize",
      authorizePost({ ...PUBLIC_PARAMS, state: xssState }, "wrong-key"),
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    const html = await res.text();
    // The literal <script> text must be escaped — not executed.
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain(xssState);
  });
});

describe("POST /authorize — tampered hidden fields → 400, never 302 (P0 #2)", () => {
  it("tampered redirect_uri → 400, never 302 to the unvalidated URI", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    // POST with a correct key but a tampered redirect_uri hidden field.
    const form = authorizePost(
      { ...PUBLIC_PARAMS, redirect_uri: "https://evil.example.com/cb" },
      API_KEY,
    );
    const res = await app.request("/authorize", form, env);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({
      error: "Unknown client or redirect URI.",
    });
  });

  it("tampered client_id to unknown → 400, never 302", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const form = authorizePost(
      { ...PUBLIC_PARAMS, client_id: "not-a-client" },
      API_KEY,
    );
    const res = await app.request("/authorize", form, env);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("tampered code_challenge_method to plain → 400, never 302", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const form = authorizePost(
      { ...PUBLIC_PARAMS, code_challenge_method: "plain" },
      API_KEY,
    );
    const res = await app.request("/authorize", form, env);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("POST /authorize — correct key → 302 with code + state (P0 #4 redirect)", () => {
  it("302 to the validated redirect_uri with code and echoed state", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const state = "abc123";
    const res = await app.request(
      "/authorize",
      authorizePost({ ...PUBLIC_PARAMS, state }, API_KEY),
      env,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).not.toBeNull();
    const url = new URL(location);
    expect(url.origin).toBe("https://grok.example.com");
    expect(url.pathname).toBe("/callback");
    expect(url.searchParams.get("code")).not.toBeNull();
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("302 Location carries Cache-Control: no-store", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/authorize",
      authorizePost(PUBLIC_PARAMS, API_KEY),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
  });

  it("appends params with & when redirect_uri already has a query string", async () => {
    const app = createApp();
    const redirectWithQuery = "https://grok.example.com/callback?foo=bar";
    const env = makeEnv(new FakeKV(), {
      MCP_CLIENTS: JSON.stringify({
        [PUBLIC_CLIENT_ID]: { redirect_uris: [redirectWithQuery] },
      }),
    });
    const res = await app.request(
      "/authorize",
      authorizePost(
        { ...PUBLIC_PARAMS, redirect_uri: redirectWithQuery },
        API_KEY,
      ),
      env,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    // Must not have a second '?'
    expect((location.match(/\?/g) ?? []).length).toBe(1);
    expect(location).toContain("foo=bar");
    expect(location).toContain("code=");
  });

  it("URL-encodes the code and state in the Location", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const state = "a b&c=d";
    const res = await app.request(
      "/authorize",
      authorizePost({ ...PUBLIC_PARAMS, state }, API_KEY),
      env,
    );
    const location = res.headers.get("location") ?? "";
    // URLSearchParams encodes spaces as + and special chars as %XX.
    const encodedState = new URLSearchParams({ state }).toString();
    expect(location).toContain(encodedState);
  });
});

describe("POST /authorize — missing API_KEY → 500 (fail closed)", () => {
  it("missing API_KEY → 500 naming it", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    delete (env as Record<string, unknown>).API_KEY;
    const res = await app.request(
      "/authorize",
      authorizePost(PUBLIC_PARAMS, API_KEY),
      env,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toMatchObject({
      error: /API_KEY/,
    });
  });
});

describe("malformed MCP_CLIENTS → 500 naming it (fail closed)", () => {
  it("wrong-shaped MCP_CLIENTS → 500 on GET /authorize", async () => {
    const app = createApp();
    const res = await app.request(
      authorizeUrl(PUBLIC_PARAMS),
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_BAD_SHAPE }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toMatchObject({
      error: /MCP_CLIENTS/,
    });
  });

  it("wrong-shaped MCP_CLIENTS → 500 on POST /authorize", async () => {
    const app = createApp();
    const res = await app.request(
      "/authorize",
      authorizePost(PUBLIC_PARAMS, API_KEY),
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_BAD_SHAPE }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toMatchObject({
      error: /MCP_CLIENTS/,
    });
  });

  it("/health is unaffected by malformed MCP_CLIENTS", async () => {
    const app = createApp();
    const res = await app.request(
      "/health",
      {},
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_BAD_SHAPE }),
    );
    expect(res.status).toBe(200);
  });
});

describe("/authorize method contract", () => {
  it("DELETE /authorize → 405", async () => {
    const app = createApp();
    const res = await app.request(
      "/authorize",
      { method: "DELETE" },
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(405);
  });

  it("PUT /authorize → 405", async () => {
    const app = createApp();
    const res = await app.request(
      "/authorize",
      { method: "PUT", body: "x" },
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(405);
  });
});
