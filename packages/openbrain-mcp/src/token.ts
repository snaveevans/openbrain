import type { Context } from "hono";

import type { McpBindings } from "./env.js";
import { jsonError } from "./http.js";
import {
  consumeCode,
  ERR_INVALID_CLIENT,
  ERR_INVALID_GRANT,
  ERR_INVALID_REQUEST,
  ERR_UNSUPPORTED_GRANT_TYPE,
  parseClients,
  pkceS256Verify,
  randomToken,
  SCOPE_MEMORIES,
  signAccessJwt,
  storeRefresh,
  SUBJECT_OPERATOR,
  type Clients,
} from "./oauth.js";

/** Response body for a successful token issuance (oauth.md). */
interface TokenSuccess {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Result of client authentication (RFC 6749 §5.2 split). */
type ClientAuthResult =
  { ok: true; clientId: string } | { ok: false; status: 400 | 401 };

/**
 * `POST /token` — form-encoded only. Client authentication runs **before**
 * grant validation and follows the RFC 6749 §5.2 401/400 split (oauth.md):
 *
 * - A wrong `client_secret` via `Authorization: Basic` (or Basic attempted for
 *   an unknown client) → `401 invalid_client` + `WWW-Authenticate: Basic`.
 * - A wrong/absent secret otherwise (post body, or none presented for a
 *   client configured with one) → `400 invalid_client`.
 * - The body never distinguishes unknown-client from wrong-secret, and a
 *   failed client auth never touches the code.
 *
 * Grants: `authorization_code` (S2) verifies PKCE S256 + binding and issues
 * an ~1h access JWT + refresh token; `refresh_token` rotation is S3. Anything
 * else → `unsupported_grant_type`.
 */
export async function postToken(
  c: Context,
  env: McpBindings,
): Promise<Response> {
  // Form-encoded only (oauth.md): a non-form content-type → 400 invalid_request.
  const ct = c.req.header("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return jsonError(c, 400, ERR_INVALID_REQUEST);
  }

  const tokenSecret = (env.TOKEN_SECRET ?? "").trim();
  if (tokenSecret.length === 0) {
    return jsonError(c, 500, "TOKEN_SECRET secret is not configured.");
  }
  if (!env.TOKENS) {
    return jsonError(c, 500, "KV binding is not configured.");
  }
  const kv = env.TOKENS;

  let form: Record<string, string | undefined>;
  try {
    const body = await c.req.parseBody();
    form = {};
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        if (typeof v === "string") form[k] = v;
      }
    }
  } catch {
    return jsonError(c, 400, ERR_INVALID_REQUEST);
  }

  let clients: Clients;
  try {
    clients = parseClients(env.MCP_CLIENTS);
  } catch (err) {
    return jsonError(c, 500, (err as Error).message);
  }

  const mcp = new URL(c.req.url).origin;
  const auth = clientAuth(c, form, clients);
  if (!auth.ok) {
    if (auth.status === 401) {
      c.header("WWW-Authenticate", `Basic realm="${mcp}"`);
      return jsonError(c, 401, ERR_INVALID_CLIENT);
    }
    return jsonError(c, 400, ERR_INVALID_CLIENT);
  }
  const clientId = auth.clientId;

  const grantType = form.grant_type ?? "";
  if (grantType === "authorization_code") {
    return await authorizationCodeGrant(
      c,
      kv,
      clientId,
      form,
      tokenSecret,
      mcp,
    );
  }
  // refresh_token grant is S3 (#47); not implemented in this slice.
  return jsonError(c, 400, ERR_UNSUPPORTED_GRANT_TYPE);
}

/**
 * Client authentication per oauth.md. `none` (public), `client_secret_basic`,
 * `client_secret_post`. Returns `{ok:true, clientId}` or a 400/401 signal.
 * The body never distinguishes unknown-client from wrong-secret.
 */
function clientAuth(
  c: Context,
  form: Record<string, string | undefined>,
  clients: Clients,
): ClientAuthResult {
  // Try HTTP Basic first (client_secret_basic).
  const basic = parseBasicAuth(c.req.header("authorization") ?? "");
  if (basic !== null) {
    const entry = clients.get(basic.id);
    // Unknown client OR wrong secret via Basic → 401 (never 400 for Basic).
    if (entry === undefined || entry.client_secret === undefined) {
      return { ok: false, status: 401 };
    }
    if (basic.secret.trim() !== entry.client_secret.trim()) {
      return { ok: false, status: 401 };
    }
    return { ok: true, clientId: basic.id };
  }

  // Post-body client_id (+ optional client_secret_post).
  const clientId = form.client_id ?? "";
  if (clientId === "") {
    return { ok: false, status: 400 };
  }
  const entry = clients.get(clientId);
  if (entry === undefined) {
    // Unknown client via post body → 400 (same body as wrong secret).
    return { ok: false, status: 400 };
  }
  if (entry.client_secret !== undefined) {
    // Confidential client: secret required in the post body.
    const presented = (form.client_secret ?? "").trim();
    if (presented === "" || presented !== entry.client_secret.trim()) {
      return { ok: false, status: 400 };
    }
  }
  // Public client (no secret configured) → accepted.
  return { ok: true, clientId };
}

function parseBasicAuth(header: string): { id: string; secret: string } | null {
  const match = header.match(/^Basic\s+(\S+)\s*$/i);
  if (!match) return null;
  try {
    const decoded = atob(match[1] as string);
    const idx = decoded.indexOf(":");
    if (idx === -1) return null;
    return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

async function authorizationCodeGrant(
  c: Context,
  kv: KVNamespace,
  clientId: string,
  form: Record<string, string | undefined>,
  tokenSecret: string,
  mcp: string,
): Promise<Response> {
  const code = form.code;
  const verifier = form.code_verifier;
  const redirectUri = form.redirect_uri;

  // Missing required params (absent) → invalid_request (RFC 6749 §5.2).
  if (
    typeof code !== "string" ||
    code === "" ||
    typeof verifier !== "string" ||
    verifier === "" ||
    typeof redirectUri !== "string" ||
    redirectUri === ""
  ) {
    return jsonError(c, 400, ERR_INVALID_REQUEST);
  }

  const now = Math.floor(Date.now() / 1000);

  // Read-and-delete the code (consume-on-attempt). A KV error → 500.
  let binding;
  try {
    binding = await consumeCode(kv, code, now);
  } catch {
    return jsonError(c, 500, "Token store is unavailable.");
  }
  if (binding === null) {
    return jsonError(c, 400, ERR_INVALID_GRANT);
  }

  // The code is already consumed. Any mismatch from here → invalid_grant.
  if (binding.client_id !== clientId || binding.redirect_uri !== redirectUri) {
    return jsonError(c, 400, ERR_INVALID_GRANT);
  }

  const pkceOk = await pkceS256Verify(verifier, binding.code_challenge);
  if (!pkceOk) {
    return jsonError(c, 400, ERR_INVALID_GRANT);
  }

  // Issue the access JWT + refresh token.
  const accessJwt = await signAccessJwt(
    {
      iss: mcp,
      aud: `${mcp}/mcp`,
      sub: SUBJECT_OPERATOR,
      client_id: clientId,
      scope: SCOPE_MEMORIES,
    },
    tokenSecret,
    now,
  );

  const refreshToken = randomToken(32);
  try {
    await storeRefresh(kv, refreshToken, clientId);
  } catch {
    return jsonError(c, 500, "Token store is unavailable.");
  }

  const body: TokenSuccess = {
    access_token: accessJwt,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: SCOPE_MEMORIES,
  };
  return c.json(body, 200);
}
