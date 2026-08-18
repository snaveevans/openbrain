import { methodNotAllowed } from "hono/method-not-allowed";
import { Hono } from "hono";

import type { AppOptions, McpBindings } from "./env.js";
import { getAuthorize, postAuthorize } from "./authorize.js";
import { authorizeBearer } from "./gate.js";
import {
  CACHE_CONTROL_NO_STORE,
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  jsonError,
  MCP_HEALTH_SERVICE,
} from "./http.js";
import { handleJsonRpc, parseErrorResponse } from "./jsonrpc.js";
import { fetchRestClient } from "./rest-client.js";
import { postToken } from "./token.js";

export type { AppOptions, McpBindings } from "./env.js";

export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: McpBindings }>({ strict: false });

  // Every response carries `Cache-Control: no-store` (health, well-knowns,
  // /mcp results, and errors).
  app.use(async (c, next) => {
    await next();
    c.header("Cache-Control", CACHE_CONTROL_NO_STORE);
  });

  // `GET /mcp` (and any non-POST on a registered path) is 405 before the gate
  // runs — the POST handler (gate + dispatch) never executes for other methods.
  app.use(
    methodNotAllowed({
      app,
      onMethodNotAllowed: (c) => jsonError(c, 405, ERROR_METHOD_NOT_ALLOWED),
    }),
  );

  app.get("/health", (c) => {
    return c.json({ ok: true, service: MCP_HEALTH_SERVICE });
  });

  app.get("/.well-known/oauth-protected-resource", (c) => {
    const mcp = new URL(c.req.url).origin;
    return c.json({
      resource: `${mcp}/mcp`,
      authorization_servers: [mcp],
      bearer_methods_supported: ["header"],
    });
  });

  app.get("/.well-known/oauth-authorization-server", (c) => {
    const mcp = new URL(c.req.url).origin;
    return c.json({
      issuer: mcp,
      authorization_endpoint: `${mcp}/authorize`,
      token_endpoint: `${mcp}/token`,
      registration_endpoint: `${mcp}/register`,
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

  // `GET /authorize` renders the "paste your API key" form when all OAuth
  // params validate; `POST /authorize` re-validates the hidden fields, checks
  // the key, mints a single-use code, and 302s to the validated redirect.
  // Invalid requests → 400 JSON (house-envelope bodies); never a 302 to an
  // unvalidated URI. Both carry `Cache-Control: no-store` (via the middleware).
  app.get("/authorize", async (c) => getAuthorize(c, c.env));
  app.post("/authorize", async (c) => postAuthorize(c, c.env));

  // `POST /token` — form-encoded only. Client auth (RFC 6749 §5.2 split) runs
  // before grant validation; `authorization_code` verifies PKCE S256 + binding
  // and issues an ~1h access JWT + refresh token. `GET /token` → 405 (the
  // method-not-allowed middleware fires for non-POST on this registered path).
  app.post("/token", async (c) => postToken(c, c.env));

  // The MCP endpoint. Gate (bearer) runs before the body is parsed; domain
  // work (REST calls) runs only after the gate accepts. All `tools/call`
  // results are HTTP 200 — domain failures live in `result.isError`.
  app.post("/mcp", async (c) => {
    const mcp = new URL(c.req.url).origin;
    const gateResponse = await authorizeBearer(c, c.env, mcp);
    if (gateResponse) {
      return gateResponse;
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(parseErrorResponse(), 200);
    }

    const rest = options.rest ?? fetchRestClient();
    const response = await handleJsonRpc(raw, c.env, rest);
    return c.json(response, 200);
  });

  app.notFound((c) => jsonError(c, 404, ERROR_NOT_FOUND));

  app.onError((err, c) => {
    const apiKey = (c.env?.API_KEY ?? "").trim();
    const tokenSecret = (c.env?.TOKEN_SECRET ?? "").trim();
    const raw =
      err instanceof Error && err.message ? err.message : "Internal error.";
    const leaks =
      (apiKey.length > 0 && raw.includes(apiKey)) ||
      (tokenSecret.length > 0 && raw.includes(tokenSecret));
    return jsonError(c, 500, leaks ? "Internal error." : raw);
  });

  return app;
}
