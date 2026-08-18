import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  signAccessJwt,
  SUBJECT_OPERATOR,
  SCOPE_MEMORIES,
} from "../src/oauth.js";
import {
  algNoneJwt,
  API_KEY,
  CALLER_KEY,
  makeEnv,
  MCP_CLIENTS_JSON,
  PKCE_CHALLENGE,
  PKCE_VERIFIER,
  PUBLIC_CLIENT_ID,
  PUBLIC_REDIRECT,
  rpc,
  SAMPLE_MEMORY,
  seedToken,
  authorizePost,
  tokenPost,
  TOKEN_SECRET,
  VALID_TOKEN,
} from "./helpers.js";
import { FakeKV, FakeRest } from "./fakes.js";

const ORIGIN = "http://localhost";

/** Complete the full authorize → token flow and return the issued tokens. */
async function fullFlow(
  app: ReturnType<typeof createApp>,
  env: Record<string, unknown>,
  clientId = PUBLIC_CLIENT_ID,
  redirectUri = PUBLIC_REDIRECT,
  verifier = PKCE_VERIFIER,
  challenge = PKCE_CHALLENGE,
): Promise<{ access_token: string; refresh_token: string }> {
  const authParams = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
  const authRes = await app.request(
    "/authorize",
    authorizePost(authParams),
    env,
  );
  expect(authRes.status).toBe(302);
  const location = authRes.headers.get("location") ?? "";
  const code = new URL(location).searchParams.get("code");
  if (code === null) throw new Error("no code in redirect");

  const tokenRes = await app.request(
    "/token",
    tokenPost({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
    env,
  );
  expect(tokenRes.status).toBe(200);
  return (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
  };
}

describe("JWT gate: alg=none rejected (P0 #1)", () => {
  it("rejects an alg=none JWT as 401 invalid_token even with a valid-looking payload", async () => {
    const rest = new FakeRest();
    const kv = new FakeKV();
    const app = createApp({ rest });
    const env = makeEnv(kv, { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: ORIGIN,
      aud: `${ORIGIN}/mcp`,
      sub: SUBJECT_OPERATOR,
      client_id: PUBLIC_CLIENT_ID,
      scope: SCOPE_MEMORIES,
      iat: now,
      exp: now + 3600,
      jti: "fake-jti",
    };
    const jwt = algNoneJwt(claims);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: jwt },
      ),
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain(
      'error="invalid_token"',
    );
    expect(rest.requestCount).toBe(0);
  });

  it("rejects an HS256 JWT signed with the wrong key as 401 invalid_token", async () => {
    const rest = new FakeRest();
    const kv = new FakeKV();
    const app = createApp({ rest });
    const env = makeEnv(kv, { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signAccessJwt(
      {
        iss: ORIGIN,
        aud: `${ORIGIN}/mcp`,
        sub: SUBJECT_OPERATOR,
        client_id: PUBLIC_CLIENT_ID,
        scope: SCOPE_MEMORIES,
      },
      "wrong-secret",
      now,
    );
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: jwt },
      ),
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain(
      'error="invalid_token"',
    );
    expect(rest.requestCount).toBe(0);
  });
});

describe("Issued JWT + minted token both accepted at /mcp; no credential forwarding (P0 #8)", () => {
  it("accepts a freshly issued access JWT at /mcp (tool call proceeds)", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { matches: [] });
    const kv = new FakeKV();
    const app = createApp({ rest });
    const env = makeEnv(kv, { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const tokens = await fullFlow(app, env);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: tokens.access_token },
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(rest.requestCount).toBe(1);
  });

  it("accepts an S1 operator-minted token in KV (no JWT needed)", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { matches: [] });
    const kv = new FakeKV();
    await seedToken(kv, VALID_TOKEN);
    const app = createApp({ rest });
    const env = makeEnv(kv);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(rest.requestCount).toBe(1);
  });

  it("substitutes the Worker's own API key and never forwards the caller's Bearer upstream", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { memory: SAMPLE_MEMORY });
    const kv = new FakeKV();
    const app = createApp({ rest });
    const env = makeEnv(kv, { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const tokens = await fullFlow(app, env);
    await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: tokens.access_token, xApiKey: CALLER_KEY },
      ),
      env,
    );
    const upstream = rest.last as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string | undefined;
    };
    expect(upstream.headers["x-api-key"]).toBe(API_KEY);
    expect(upstream.headers.authorization).toBeUndefined();
    expect(upstream.headers.Authorization).toBeUndefined();
    const serialized = [
      upstream.method,
      upstream.url,
      JSON.stringify(upstream.headers),
      upstream.body ?? "",
    ].join("\n");
    expect(serialized).not.toContain(tokens.access_token);
    expect(serialized).not.toContain(CALLER_KEY);
  });
});

describe("Missing config fails closed at /mcp (P1)", () => {
  it("missing TOKEN_SECRET → /mcp 500 for a JWT (naming it)", async () => {
    const rest = new FakeRest();
    const kv = new FakeKV();
    const app = createApp({ rest });
    const env = makeEnv(kv, { MCP_CLIENTS: MCP_CLIENTS_JSON });
    delete (env as Record<string, unknown>).TOKEN_SECRET;
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signAccessJwt(
      {
        iss: ORIGIN,
        aud: `${ORIGIN}/mcp`,
        sub: SUBJECT_OPERATOR,
        client_id: PUBLIC_CLIENT_ID,
        scope: SCOPE_MEMORIES,
      },
      TOKEN_SECRET,
      now,
    );
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: jwt },
      ),
      env,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toMatchObject({
      error: /TOKEN_SECRET/,
    });
    expect(rest.requestCount).toBe(0);
  });

  it("missing TOKEN_SECRET → /mcp 500 for a minted token too (BYOK included)", async () => {
    const rest = new FakeRest();
    const kv = new FakeKV();
    await seedToken(kv, VALID_TOKEN);
    const app = createApp({ rest });
    const env = makeEnv(kv);
    delete (env as Record<string, unknown>).TOKEN_SECRET;
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toMatchObject({
      error: /TOKEN_SECRET/,
    });
    expect(rest.requestCount).toBe(0);
  });

  it("/health is 200 even when TOKEN_SECRET is missing", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV());
    delete (env as Record<string, unknown>).TOKEN_SECRET;
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
  });
});
