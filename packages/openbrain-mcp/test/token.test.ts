import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { SUBJECT_OPERATOR, SCOPE_MEMORIES } from "../src/oauth.js";
import {
  API_KEY,
  authorizePost,
  CONFIDENTIAL_CLIENT_ID,
  CONFIDENTIAL_CLIENT_SECRET,
  CONFIDENTIAL_REDIRECT,
  decodeJwtPayload,
  makeEnv,
  MCP_CLIENTS_BAD_SHAPE,
  MCP_CLIENTS_JSON,
  PKCE_CHALLENGE,
  PKCE_VERIFIER,
  PUBLIC_CLIENT_ID,
  PUBLIC_REDIRECT,
  tokenPost,
} from "./helpers.js";
import { FakeKV } from "./fakes.js";

const ORIGIN = "http://localhost";

const PUBLIC_PARAMS = {
  response_type: "code",
  client_id: PUBLIC_CLIENT_ID,
  redirect_uri: PUBLIC_REDIRECT,
  code_challenge: PKCE_CHALLENGE,
  code_challenge_method: "S256",
};

/** POST /authorize with a correct key and extract the `code` from the 302. */
async function getCode(
  app: ReturnType<typeof createApp>,
  env: Record<string, unknown>,
  params: Record<string, string> = PUBLIC_PARAMS,
): Promise<string> {
  const res = await app.request(
    "/authorize",
    authorizePost(params, API_KEY),
    env,
  );
  expect(res.status).toBe(302);
  const location = res.headers.get("location") ?? "";
  const code = new URL(location).searchParams.get("code");
  if (code === null) throw new Error("no code in redirect");
  return code;
}

/** Complete authorize + token and return the token response. */
async function exchange(
  app: ReturnType<typeof createApp>,
  env: Record<string, unknown>,
  overrides: {
    code?: string;
    verifier?: string;
    redirectUri?: string;
    clientId?: string;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const code = overrides.code ?? (await getCode(app, env, overrides.params));
  return app.request(
    "/token",
    tokenPost({
      grant_type: "authorization_code",
      code,
      redirect_uri: overrides.redirectUri ?? PUBLIC_REDIRECT,
      client_id: overrides.clientId ?? PUBLIC_CLIENT_ID,
      code_verifier: overrides.verifier ?? PKCE_VERIFIER,
    }),
    env,
  );
}

describe("Token issuance claims + refresh present (P0 #7)", () => {
  it("200 with token_type, expires_in, scope, non-empty refresh_token, decodable JWT", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await exchange(app, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
    expect(body.scope).toBe("memories");
    expect(typeof body.refresh_token).toBe("string");
    expect((body.refresh_token as string).length).toBeGreaterThan(0);
    expect(typeof body.access_token).toBe("string");

    // JWT decodes to the expected claims (signed with the test TOKEN_SECRET).
    const claims = decodeJwtPayload(body.access_token as string);
    expect(claims.iss).toBe(ORIGIN);
    expect(claims.aud).toBe(`${ORIGIN}/mcp`);
    expect(claims.sub).toBe(SUBJECT_OPERATOR);
    expect(claims.client_id).toBe(PUBLIC_CLIENT_ID);
    expect(claims.scope).toBe(SCOPE_MEMORIES);
    expect(typeof claims.iat).toBe("number");
    expect(claims.exp).toBe((claims.iat as number) + 3600);
    expect(typeof claims.jti).toBe("string");
    expect((claims.jti as string).length).toBeGreaterThan(0);
  });

  it("issued JWT is accepted at /mcp", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await exchange(app, env);
    const body = (await res.json()) as { access_token: string };
    // Verify with signAccessJwt's counterpart — the gate accepts it.
    const mcpRes = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${body.access_token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
          params: {},
        }),
      },
      env,
    );
    expect(mcpRes.status).toBe(200);
  });
});

describe("Single-use code: consume-on-attempt (P0 #3)", () => {
  it("replay the same code with the correct verifier → 400 invalid_grant", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const code = await getCode(app, env);
    const first = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code,
        redirect_uri: PUBLIC_REDIRECT,
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(first.status).toBe(200);

    const replay = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code,
        redirect_uri: PUBLIC_REDIRECT,
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(replay.status).toBe(400);
    expect((await replay.json()) as unknown).toEqual({
      error: "invalid_grant",
    });
  });

  it("wrong verifier consumes the code; later correct verifier → also invalid_grant", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const code = await getCode(app, env);

    // Wrong verifier → 400 invalid_grant (code is consumed on attempt).
    const wrong = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code,
        redirect_uri: PUBLIC_REDIRECT,
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: "wrong-verifier",
      }),
      env,
    );
    expect(wrong.status).toBe(400);
    expect((await wrong.json()) as unknown).toEqual({ error: "invalid_grant" });

    // Correct verifier now → also 400 invalid_grant (code is gone).
    const retry = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code,
        redirect_uri: PUBLIC_REDIRECT,
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(retry.status).toBe(400);
    expect((await retry.json()) as unknown).toEqual({ error: "invalid_grant" });
  });

  it("unknown code → 400 invalid_grant", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code: "nonexistent-code",
        redirect_uri: PUBLIC_REDIRECT,
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_grant" });
  });
});

describe("PKCE S256 enforced at /token (P0 #5)", () => {
  it("code_verifier whose SHA256 does not match the challenge → 400 invalid_grant", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await exchange(app, env, { verifier: "different-verifier" });
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_grant" });
  });
});

describe("Missing vs mismatched params (P1)", () => {
  it("missing code → 400 invalid_request", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        redirect_uri: PUBLIC_REDIRECT,
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_request" });
  });

  it("missing code_verifier → 400 invalid_request", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const code = await getCode(app, env);
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code,
        redirect_uri: PUBLIC_REDIRECT,
        client_id: PUBLIC_CLIENT_ID,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_request" });
  });

  it("missing redirect_uri → 400 invalid_request", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const code = await getCode(app, env);
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code,
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_request" });
  });

  it("mismatched redirect_uri → 400 invalid_grant", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const code = await getCode(app, env);
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://wrong.example.com/cb",
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_grant" });
  });

  it("mismatched client_id (known, authenticated) → 400 invalid_grant", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    // Code is bound to PUBLIC_CLIENT_ID; present CONFIDENTIAL_CLIENT_ID with
    // correct Basic auth so client auth passes, then the binding mismatches.
    const code = await getCode(app, env);
    const res = await app.request(
      "/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${btoa(`${CONFIDENTIAL_CLIENT_ID}:${CONFIDENTIAL_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: PUBLIC_REDIRECT,
          code_verifier: PKCE_VERIFIER,
        }).toString(),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_grant" });
  });
});

describe("Unsupported grant_type (P1)", () => {
  it("grant_type=password → 400 unsupported_grant_type", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/token",
      tokenPost({ grant_type: "password", client_id: PUBLIC_CLIENT_ID }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({
      error: "unsupported_grant_type",
    });
  });

  it("grant_type=implicit → 400 unsupported_grant_type", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/token",
      tokenPost({ grant_type: "implicit", client_id: PUBLIC_CLIENT_ID }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({
      error: "unsupported_grant_type",
    });
  });
});

describe("Missing config fails closed (P1)", () => {
  it("missing TOKEN_SECRET → /token 500 naming it", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    delete (env as Record<string, unknown>).TOKEN_SECRET;
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        client_id: PUBLIC_CLIENT_ID,
      }),
      env,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toMatchObject({
      error: /TOKEN_SECRET/,
    });
  });

  it("malformed MCP_CLIENTS → /token 500 naming it (when a static client is needed)", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_BAD_SHAPE });
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        client_id: PUBLIC_CLIENT_ID,
      }),
      env,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toMatchObject({
      error: /MCP_CLIENTS/,
    });
  });
});

describe("/token method + content-type contract (P1)", () => {
  it("GET /token → 405", async () => {
    const app = createApp();
    const res = await app.request(
      "/token",
      { method: "GET" },
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(405);
  });

  it("POST /token with application/json content-type → 400 invalid_request", async () => {
    const app = createApp();
    const res = await app.request(
      "/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code" }),
      },
      makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_request" });
  });
});

describe("scope accepted and ignored (P2)", () => {
  it("scope=foo in /token request still succeeds and the token carries scope=memories", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const code = await getCode(app, env);
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code,
        redirect_uri: PUBLIC_REDIRECT,
        client_id: PUBLIC_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
        scope: "foo",
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scope).toBe("memories");
  });
});

describe("Client-auth split (RFC 6749 §5.2) + runs before grant + does not consume code (P1)", () => {
  const CONF_PARAMS = {
    response_type: "code",
    client_id: CONFIDENTIAL_CLIENT_ID,
    redirect_uri: CONFIDENTIAL_REDIRECT,
    code_challenge: PKCE_CHALLENGE,
    code_challenge_method: "S256",
  };

  function basicAuth(id: string, secret: string): string {
    return `Basic ${btoa(`${id}:${secret}`)}`;
  }

  it("wrong secret via Basic → 401 invalid_client + WWW-Authenticate: Basic", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(CONFIDENTIAL_CLIENT_ID, "wrong-secret"),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "any-code",
          redirect_uri: CONFIDENTIAL_REDIRECT,
          code_verifier: PKCE_VERIFIER,
        }).toString(),
      },
      env,
    );
    expect(res.status).toBe(401);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_client" });
    expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("Basic attempted for an unknown client → 401 invalid_client (no oracle)", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth("unknown-client", "any-secret"),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "any-code",
          redirect_uri: CONFIDENTIAL_REDIRECT,
          code_verifier: PKCE_VERIFIER,
        }).toString(),
      },
      env,
    );
    expect(res.status).toBe(401);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_client" });
  });

  it("wrong secret via post body → 400 invalid_client", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code: "any-code",
        redirect_uri: CONFIDENTIAL_REDIRECT,
        client_id: CONFIDENTIAL_CLIENT_ID,
        client_secret: "wrong-secret",
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_client" });
  });

  it("absent secret for a confidential client via post body → 400 invalid_client", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code: "any-code",
        redirect_uri: CONFIDENTIAL_REDIRECT,
        client_id: CONFIDENTIAL_CLIENT_ID,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid_client" });
  });

  it("body never distinguishes unknown-client from wrong-secret (no oracle)", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const unknownClient = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code: "x",
        client_id: "not-a-client",
        client_secret: "x",
        redirect_uri: CONFIDENTIAL_REDIRECT,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    const wrongSecret = await app.request(
      "/token",
      tokenPost({
        grant_type: "authorization_code",
        code: "x",
        client_id: CONFIDENTIAL_CLIENT_ID,
        client_secret: "wrong",
        redirect_uri: CONFIDENTIAL_REDIRECT,
        code_verifier: PKCE_VERIFIER,
      }),
      env,
    );
    const b1 = await unknownClient.text();
    const b2 = await wrongSecret.text();
    expect(unknownClient.status).toBe(wrongSecret.status);
    expect(b1).toBe(b2);
  });

  it("failed client auth does not consume the code: wrong secret → 401, then correct secret → 200", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const code = await getCode(app, env, CONF_PARAMS);

    // Wrong secret via Basic → 401 (code NOT consumed).
    const wrong = await app.request(
      "/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(CONFIDENTIAL_CLIENT_ID, "wrong-secret"),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: CONFIDENTIAL_REDIRECT,
          code_verifier: PKCE_VERIFIER,
        }).toString(),
      },
      env,
    );
    expect(wrong.status).toBe(401);

    // Correct secret via Basic → 200 (code is still valid).
    const correct = await app.request(
      "/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(
            CONFIDENTIAL_CLIENT_ID,
            CONFIDENTIAL_CLIENT_SECRET,
          ),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: CONFIDENTIAL_REDIRECT,
          code_verifier: PKCE_VERIFIER,
        }).toString(),
      },
      env,
    );
    expect(correct.status).toBe(200);
  });

  it("confidential client with correct Basic secret completes the full flow", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const code = await getCode(app, env, CONF_PARAMS);
    const res = await app.request(
      "/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(
            CONFIDENTIAL_CLIENT_ID,
            CONFIDENTIAL_CLIENT_SECRET,
          ),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: CONFIDENTIAL_REDIRECT,
          code_verifier: PKCE_VERIFIER,
        }).toString(),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe("memories");
  });

  it("public client (no secret) completes the full flow end-to-end", async () => {
    const app = createApp();
    const env = makeEnv(new FakeKV(), { MCP_CLIENTS: MCP_CLIENTS_JSON });
    const res = await exchange(app, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("Bearer");
  });
});
