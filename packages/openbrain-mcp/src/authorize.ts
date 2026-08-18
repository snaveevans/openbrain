import type { Context } from "hono";

import type { McpBindings } from "./env.js";
import { jsonError } from "./http.js";
import {
  buildRedirectLocation,
  ERR_INVALID_API_KEY,
  ERR_INVALID_AUTH_REQUEST,
  ERR_UNKNOWN_CLIENT_OR_REDIRECT,
  escapeHtml,
  findClient,
  mintCode,
  parseClients,
  redirectUriMatches,
} from "./oauth.js";

/** OAuth params expected on the authorize request (oauth.md). */
export interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
  state?: string;
}

/** Names of params rendered as hidden fields (preserved verbatim, escaped). */
const HIDDEN_FIELDS: (keyof AuthorizeParams)[] = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
];

function isNonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.length > 0;
}

/**
 * Validate the OAuth params per oauth.md. Returns `null` if valid, or a
 * 400-error reason string ("Unknown client or redirect URI." /
 * "Invalid authorization request.") if invalid. `MCP_CLIENTS` parse failure
 * throws a descriptive `Error` (caller → 500 naming it).
 *
 * Order: structural shape first (→ "Invalid authorization request."), then
 * client/redirect exact-match (→ "Unknown client or redirect URI."). The two
 * 400 bodies are house-envelope sentences; the response never reveals
 * whether the client exists (no oracle).
 */
export function validateAuthorizeParams(
  params: Partial<AuthorizeParams>,
  clientsRaw: unknown,
): string | null {
  if (
    params.response_type !== "code" ||
    !isNonEmpty(params.client_id) ||
    !isNonEmpty(params.redirect_uri) ||
    !isNonEmpty(params.code_challenge) ||
    params.code_challenge_method !== "S256"
  ) {
    return ERR_INVALID_AUTH_REQUEST;
  }

  const clients = parseClients(clientsRaw); // throws if malformed
  const client = findClient(clients, params.client_id as string);
  if (client === undefined) {
    return ERR_UNKNOWN_CLIENT_OR_REDIRECT;
  }
  if (!redirectUriMatches(client, params.redirect_uri as string)) {
    return ERR_UNKNOWN_CLIENT_OR_REDIRECT;
  }
  return null;
}

/**
 * Build the minimal "paste your API key" HTML form. All OAuth params are
 * rendered as **hidden fields** and HTML-escaped (reflected-XSS guard — these
 * are attacker-influenceable). The pasted key is never echoed into the form
 * (secret-leak guard). An optional `errorMessage` renders a generic line
 * above the input (used for the 401 re-render only).
 */
export function renderAuthorizeForm(
  params: Partial<AuthorizeParams>,
  errorMessage?: string,
): string {
  const hidden = HIDDEN_FIELDS.map((name) => {
    const raw = params[name];
    if (raw === undefined || raw === "") return "";
    return `    <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(String(raw))}">`;
  }).join("\n");
  const errorBlock =
    errorMessage !== undefined
      ? `    <p class="error">${escapeHtml(errorMessage)}</p>\n`
      : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Brain — Authorize</title>
</head>
<body>
  <h1>Authorize Open Brain</h1>
${errorBlock}  <form method="post" action="/authorize" autocomplete="off">
${hidden}
    <label for="api-key">API key</label>
    <input type="password" id="api-key" name="api_key" autocomplete="off" required>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}

/** `GET /authorize` — validate params, render the form, or 400. */
export async function getAuthorize(
  c: Context,
  env: McpBindings,
): Promise<Response> {
  const params = readParams(c);
  let reason: string | null;
  try {
    reason = validateAuthorizeParams(params, env.MCP_CLIENTS);
  } catch (err) {
    return jsonError(c, 500, (err as Error).message);
  }
  if (reason !== null) {
    return jsonError(c, 400, reason);
  }
  return c.html(renderAuthorizeForm(params), 200);
}

/** `POST /authorize` — re-validate hidden fields, check key, mint code, 302. */
export async function postAuthorize(
  c: Context,
  env: McpBindings,
): Promise<Response> {
  const apiKey = (env.API_KEY ?? "").trim();
  if (apiKey.length === 0) {
    return jsonError(c, 500, "API_KEY secret is not configured.");
  }

  const form = await readBody(c);
  const params = paramsFromForm(form);

  let reason: string | null;
  try {
    reason = validateAuthorizeParams(params, env.MCP_CLIENTS);
  } catch (err) {
    return jsonError(c, 500, (err as Error).message);
  }
  if (reason !== null) {
    return jsonError(c, 400, reason);
  }

  const pasted = typeof form.api_key === "string" ? form.api_key.trim() : "";
  if (pasted !== apiKey) {
    // 401: re-render the form with a generic error. The pasted key is NOT
    // pre-filled (secret-leak guard); every OAuth param is HTML-escaped.
    return c.html(renderAuthorizeForm(params, ERR_INVALID_API_KEY), 401);
  }

  if (!env.TOKENS) {
    return jsonError(c, 500, "KV binding is not configured.");
  }
  const kv = env.TOKENS;

  const now = Math.floor(Date.now() / 1000);
  let code: string;
  try {
    code = await mintCode(
      kv,
      {
        client_id: params.client_id as string,
        redirect_uri: params.redirect_uri as string,
        code_challenge: params.code_challenge as string,
      },
      now,
    );
  } catch {
    return jsonError(c, 500, "Token store is unavailable.");
  }

  const location = buildRedirectLocation(
    params.redirect_uri as string,
    code,
    params.state,
  );
  return c.redirect(location, 302);
}

function readParams(c: Context): Partial<AuthorizeParams> {
  const q = c.req.query();
  return {
    response_type: q.response_type ?? "",
    client_id: q.client_id ?? "",
    redirect_uri: q.redirect_uri ?? "",
    code_challenge: q.code_challenge ?? "",
    code_challenge_method: q.code_challenge_method ?? "",
    scope: q.scope,
    state: q.state,
  };
}

interface FormBody {
  api_key?: string;
  [key: string]: string | undefined;
}

async function readBody(c: Context): Promise<FormBody> {
  try {
    const body = await c.req.parseBody();
    const out: FormBody = {};
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function paramsFromForm(form: FormBody): Partial<AuthorizeParams> {
  return {
    response_type: form.response_type ?? "",
    client_id: form.client_id ?? "",
    redirect_uri: form.redirect_uri ?? "",
    code_challenge: form.code_challenge ?? "",
    code_challenge_method: form.code_challenge_method ?? "",
    scope: form.scope,
    state: form.state,
  };
}
