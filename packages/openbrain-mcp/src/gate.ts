import { ERROR_UNAUTHORIZED } from "@snaveevans/openbrain-common";
import type { Context } from "hono";

import type { McpBindings } from "./env.js";
import { jsonError } from "./http.js";
import { sha256Hex, verifyAccessJwt } from "./oauth.js";

// Re-exported for tests that seed BYOK tokens by hash (unchanged from S1).
export { sha256Hex };

/**
 * `WWW-Authenticate` challenge per oauth.md. Missing bearer → no `error=`;
 * a presented-but-rejected token → the same challenge plus
 * `error="invalid_token"`. The 401 body is always `{ "error": "Unauthorized." }`
 * — the challenge carries the distinction, the body never does.
 */
function challenge(mcp: string, rejected: boolean): string {
  const base = `Bearer realm="${mcp}", resource_metadata="${mcp}/.well-known/oauth-protected-resource"`;
  return rejected ? `${base}, error="invalid_token"` : base;
}

function unauthorized(c: Context, mcp: string, rejected: boolean): Response {
  c.header("WWW-Authenticate", challenge(mcp, rejected));
  return jsonError(c, 401, ERROR_UNAUTHORIZED);
}

/**
 * The bearer gate for `POST {mcp}/mcp`. Returns a `Response` to reject
 * (401 / 500) or `null` to accept. Two token kinds (oauth.md):
 *
 * 1. **Operator-minted (BYOK)** — opaque, stored hashed in KV; one lookup.
 * 2. **Access JWTs (S2)** — HMAC-signed, stateless; validated locally with no
 *    storage read. The validator pins `HS256` and rejects `alg=none` / any
 *    non-HMAC algorithm before touching the signature.
 *
 * Fail-closed: a missing `TOKEN_SECRET` fails the **whole** gate (BYOK
 * included) with `500` naming it — a loud mis-deploy beats silently serving
 * minted tokens around a broken JWT path. A KV error never opens the gate.
 * `x-api-key` and the raw API key are never accepted here — the API key is
 * not in KV, so hashing it is a KV miss; `x-api-key` without a bearer is a
 * missing-bearer 401.
 */
export async function authorizeBearer(
  c: Context,
  env: McpBindings,
  mcp: string,
): Promise<Response | null> {
  const auth = c.req.header("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) {
    return unauthorized(c, mcp, false);
  }

  const tokenSecret = (env.TOKEN_SECRET ?? "").trim();
  if (tokenSecret.length === 0) {
    return jsonError(c, 500, "TOKEN_SECRET secret is not configured.");
  }

  if (!env.TOKENS) {
    return jsonError(c, 500, "KV binding is not configured.");
  }

  const presented = match[1] as string;

  // 1. BYOK: one KV lookup by hash. Found → accept.
  let record: string | null;
  try {
    record = await env.TOKENS.get(await sha256Hex(presented));
  } catch {
    return jsonError(c, 500, "Token store is unavailable.");
  }
  if (record !== null) {
    return null;
  }

  // 2. Access JWT: stateless signature/iss/aud/exp check. Valid → accept.
  const now = Math.floor(Date.now() / 1000);
  const jwt = await verifyAccessJwt(
    presented,
    tokenSecret,
    mcp,
    `${mcp}/mcp`,
    now,
  );
  if (jwt.ok) {
    return null;
  }

  // Neither BYOK nor a valid JWT → rejected bearer.
  return unauthorized(c, mcp, true);
}
