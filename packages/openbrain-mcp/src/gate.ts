import { ERROR_UNAUTHORIZED } from "@snaveevans/openbrain-common";
import type { Context } from "hono";

import type { McpBindings } from "./env.js";
import { jsonError } from "./http.js";

/**
 * SHA-256 hex of the presented bearer. Operator-minted BYOK tokens are stored
 * in KV **keyed by this hash** (the raw token never touches KV), so the hot
 * path is one lookup: present → valid, absent → `invalid_token`. This is the
 * single stateful read on the hot path (ADR-0008).
 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
 * The BYOK bearer gate for `POST {mcp}/mcp`. Returns a `Response` to reject
 * (401 / 500) or `null` to accept. Fail-closed: a KV error never opens the
 * gate. `x-api-key` and the raw API key are never accepted here — the API key
 * is not in KV, so hashing it is a KV miss → `invalid_token`; `x-api-key`
 * without a bearer is a missing-bearer 401. A presented access JWT is a KV
 * miss in S1 (no JWT parsing — that lands in S2).
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

  if (!env.TOKENS) {
    return jsonError(c, 500, "KV binding is not configured.");
  }

  let record: string | null;
  try {
    record = await env.TOKENS.get(await sha256Hex(match[1] as string));
  } catch {
    return jsonError(c, 500, "Token store is unavailable.");
  }

  if (record === null) {
    return unauthorized(c, mcp, true);
  }
  return null;
}
