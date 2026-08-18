/**
 * OAuth primitives for the hosted MCP Worker (oauth.md). S2 surface:
 * static-client parsing, PKCE S256, HMAC-signed access JWTs (alg pinned to
 * HS256), authorization-code + refresh-token minting, and the KV layout for
 * token-lifecycle state.
 *
 * Nothing here reads the request or writes the response — that is the
 * handlers' job. This module owns the crypto and the KV key shapes so the
 * handlers stay thin and the contract is in one place.
 */

/** Authorization-code TTL in seconds (conventional 10 minutes; oauth.md). */
export const CODE_TTL_SECONDS = 600;
/** Access-token TTL in seconds (1 hour; ADR-0008 bounds the blast radius). */
export const ACCESS_TTL_SECONDS = 3600;
/** Refresh-token TTL in seconds (conventional 30 days; oauth.md). */
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

/** KV key prefixes so the single `TOKENS` namespace stays legible. */
export const KV_CODE_PREFIX = "code:";
export const KV_REFRESH_PREFIX = "refresh:";
export const KV_BYOK_PREFIX = "byok:";

/** Scope every token carries (v1 is scope-light; scopes are accepted+ignored). */
export const SCOPE_MEMORIES = "memories";
/** The single subject — one tenant (oauth.md). */
export const SUBJECT_OPERATOR = "operator";

/** House-envelope 400 bodies for `/authorize` (oauth.md). */
export const ERR_UNKNOWN_CLIENT_OR_REDIRECT = "Unknown client or redirect URI.";
export const ERR_INVALID_AUTH_REQUEST = "Invalid authorization request.";

/** RFC 6749 §5.2 error codes for `/token`. */
export const ERR_INVALID_GRANT = "invalid_grant";
export const ERR_INVALID_REQUEST = "invalid_request";
export const ERR_INVALID_CLIENT = "invalid_client";
export const ERR_UNSUPPORTED_GRANT_TYPE = "unsupported_grant_type";

/** Generic 401 re-render message for a wrong API key (oauth.md). */
export const ERR_INVALID_API_KEY = "Invalid API key.";

export interface ClientEntry {
  client_secret?: string;
  redirect_uris: string[];
}

/** client_id → entry. Empty map is valid (static path is optional). */
export type Clients = Map<string, ClientEntry>;

/** Binding stored alongside a single-use authorization code. */
export interface CodeBinding {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  /** Created-at epoch seconds; checked against `CODE_TTL_SECONDS`. */
  created_at: number;
}

/**
 * Parse `MCP_CLIENTS`. Throws a descriptive `Error` when set-but-malformed
 * (valid JSON, wrong shape) or unparseable — callers catch and return `500`
 * naming it. Unset/empty-string → empty map (valid: static path optional).
 * Per oauth.md, a wrong-shape registry never degrades to "no clients".
 */
export function parseClients(raw: unknown): Clients {
  if (raw === undefined || raw === null || raw === "") {
    return new Map();
  }
  if (typeof raw !== "string") {
    throw new Error("MCP_CLIENTS is not configured correctly: not a string.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "MCP_CLIENTS is not configured correctly: unparseable JSON.",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "MCP_CLIENTS is not configured correctly: expected a client_id → metadata map.",
    );
  }
  const clients: Clients = new Map();
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `MCP_CLIENTS is not configured correctly: client "${id}" is not an object.`,
      );
    }
    const entry = value as Record<string, unknown>;
    if (
      !Array.isArray(entry.redirect_uris) ||
      entry.redirect_uris.length === 0 ||
      !entry.redirect_uris.every((u) => typeof u === "string")
    ) {
      throw new Error(
        `MCP_CLIENTS is not configured correctly: client "${id}" needs a non-empty redirect_uris string array.`,
      );
    }
    if (
      entry.client_secret !== undefined &&
      typeof entry.client_secret !== "string"
    ) {
      throw new Error(
        `MCP_CLIENTS is not configured correctly: client "${id}" client_secret must be a string.`,
      );
    }
    clients.set(id, {
      client_secret:
        typeof entry.client_secret === "string"
          ? entry.client_secret
          : undefined,
      redirect_uris: entry.redirect_uris as string[],
    });
  }
  return clients;
}

/** Look up a client by id; `undefined` if unknown. */
export function findClient(
  clients: Clients,
  clientId: string,
): ClientEntry | undefined {
  return clients.get(clientId);
}

/** Exact-match a `redirect_uri` against a client's registered URIs. */
export function redirectUriMatches(
  client: ClientEntry,
  redirectUri: string,
): boolean {
  return client.redirect_uris.includes(redirectUri);
}

// ── crypto primitives ──────────────────────────────────────────────────────

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(str: string): Uint8Array | null {
  try {
    const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
    const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function strToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64url(bytes);
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", strToBytes(text) as BufferSource),
  );
}

/** SHA-256 hex of a string (used for BYOK + code/refresh KV keys). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * PKCE S256 verify (RFC 7636): `BASE64URL(SHA256(verifier))` must equal the
 * stored `code_challenge`. No `plain` support — S256 only (oauth.md).
 */
export async function pkceS256Verify(
  verifier: string,
  challenge: string,
): Promise<boolean> {
  const computed = bytesToBase64url(await sha256(verifier));
  return computed === challenge;
}

// ── HMAC (HS256) ───────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    strToBytes(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    strToBytes(data) as BufferSource,
  );
  return new Uint8Array(sig);
}

// ── access JWT ──────────────────────────────────────────────────────────────

export interface AccessJwtClaims {
  iss: string;
  aud: string;
  sub: string;
  client_id: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
}

const JWT_HEADER = { alg: "HS256", typ: "JWT" };

function headerB64(): string {
  return bytesToBase64url(strToBytes(JSON.stringify(JWT_HEADER)));
}

function payloadB64(claims: AccessJwtClaims): string {
  return bytesToBase64url(strToBytes(JSON.stringify(claims)));
}

/**
 * Sign an access JWT (HS256) with `TOKEN_SECRET`. Claims per oauth.md:
 * `iss={mcp}`, `aud={mcp}/mcp`, `sub="operator"`, `client_id`, `scope="memories"`,
 * `iat`, `exp=iat+3600`, `jti` random. Returns the compact `header.payload.sig`.
 */
export async function signAccessJwt(
  claims: Omit<AccessJwtClaims, "iat" | "exp" | "jti"> & {
    iat?: number;
    jti?: string;
  },
  secret: string,
  nowSeconds: number,
): Promise<string> {
  const iat = claims.iat ?? nowSeconds;
  const exp = iat + ACCESS_TTL_SECONDS;
  const jti = claims.jti ?? randomToken(16);
  const full: AccessJwtClaims = {
    iss: claims.iss,
    aud: claims.aud,
    sub: claims.sub,
    client_id: claims.client_id,
    scope: claims.scope,
    iat,
    exp,
    jti,
  };
  const data = `${headerB64()}.${payloadB64(full)}`;
  const sig = await hmacSign(secret, data);
  return `${data}.${bytesToBase64url(sig)}`;
}

export type JwtVerifyResult =
  { ok: true; claims: AccessJwtClaims } | { ok: false };

/**
 * Validate an access JWT. Pins `alg=HS256` and rejects `alg=none` / any
 * non-HMAC algorithm **before** touching the signature (the classic
 * `alg=none` bypass). Checks signature, `iss`, `aud`, `exp`. No storage read
 * (stateless hot path; ADR-0008). Returns `{ok:false}` on any failure — the
 * caller surfaces a single generic `401 invalid_token`.
 */
export async function verifyAccessJwt(
  token: string,
  secret: string,
  expectedIss: string,
  expectedAud: string,
  nowSeconds: number,
): Promise<JwtVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false };
  const [h, p, s] = parts;

  const headerBytes = base64urlToBytes(h);
  if (headerBytes === null) return { ok: false };
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return { ok: false };
  }
  if (
    header === null ||
    typeof header !== "object" ||
    Array.isArray(header) ||
    (header as { alg?: unknown }).alg !== "HS256"
  ) {
    // Reject alg=none and any non-HMAC/missing alg — never verify such a token.
    return { ok: false };
  }

  const expectedSig = await hmacSign(secret, `${h}.${p}`);
  const presentedSig = base64urlToBytes(s);
  if (presentedSig === null) return { ok: false };
  if (!constantTimeEqual(expectedSig, presentedSig)) return { ok: false };

  const payloadBytes = base64urlToBytes(p);
  if (payloadBytes === null) return { ok: false };
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false };
  }
  if (claims === null || typeof claims !== "object" || Array.isArray(claims)) {
    return { ok: false };
  }
  const c = claims as Record<string, unknown>;
  if (
    c.iss !== expectedIss ||
    c.aud !== expectedAud ||
    c.sub !== SUBJECT_OPERATOR ||
    typeof c.exp !== "number" ||
    c.exp <= nowSeconds
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    claims: {
      iss: c.iss as string,
      aud: c.aud as string,
      sub: c.sub as string,
      client_id: c.client_id as string,
      scope: c.scope as string,
      iat: c.iat as number,
      exp: c.exp as number,
      jti: c.jti as string,
    },
  };
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── KV layout ──────────────────────────────────────────────────────────────

/** KV key for an authorization code (hashed, like BYOK tokens). */
export async function codeKey(code: string): Promise<string> {
  return `${KV_CODE_PREFIX}${await sha256Hex(code)}`;
}

/** KV key for a refresh token (hashed). */
export async function refreshKey(token: string): Promise<string> {
  return `${KV_REFRESH_PREFIX}${await sha256Hex(token)}`;
}

/** Mint an authorization code and store its binding in KV (single-use, 10min). */
export async function mintCode(
  kv: KVNamespace,
  binding: Omit<CodeBinding, "created_at">,
  nowSeconds: number,
): Promise<string> {
  const code = randomToken(32);
  const value: CodeBinding = { ...binding, created_at: nowSeconds };
  await kv.put(await codeKey(code), JSON.stringify(value), {
    expirationTtl: CODE_TTL_SECONDS,
  });
  return code;
}

/**
 * Read-and-delete an authorization code (consume-on-attempt). Returns the
 * binding if the code exists and is unexpired, `null` otherwise. The code is
 * deleted before any caller-side verification so a failed exchange
 * (wrong verifier, wrong client) is final — every later presentation is a
 * miss (oauth.md). KV errors surface as a thrown `Error` (caller → 500).
 */
export async function consumeCode(
  kv: KVNamespace,
  code: string,
  nowSeconds: number,
): Promise<CodeBinding | null> {
  const key = await codeKey(code);
  let raw: string | null;
  try {
    raw = await kv.get(key);
  } catch {
    throw new Error("Token store is unavailable.");
  }
  if (raw === null) return null;
  // Delete before verification — consume-on-attempt.
  try {
    await kv.delete(key);
  } catch {
    throw new Error("Token store is unavailable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const b = parsed as Record<string, unknown>;
  if (
    typeof b.client_id !== "string" ||
    typeof b.redirect_uri !== "string" ||
    typeof b.code_challenge !== "string" ||
    typeof b.created_at !== "number"
  ) {
    return null;
  }
  const binding: CodeBinding = {
    client_id: b.client_id,
    redirect_uri: b.redirect_uri,
    code_challenge: b.code_challenge,
    created_at: b.created_at,
  };
  if (nowSeconds - binding.created_at > CODE_TTL_SECONDS) {
    return null; // expired (already deleted above)
  }
  return binding;
}

/** Store a refresh token (hashed, 30-day TTL) bound to a client. */
export async function storeRefresh(
  kv: KVNamespace,
  token: string,
  clientId: string,
): Promise<void> {
  await kv.put(await refreshKey(token), clientId, {
    expirationTtl: REFRESH_TTL_SECONDS,
  });
}

/** Delete a refresh token (rotation / replay rejection). */
export async function deleteRefresh(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  await kv.delete(await refreshKey(token));
}

/** Look up a refresh token's bound client; `null` if unknown/expired. */
export async function lookupRefresh(
  kv: KVNamespace,
  token: string,
): Promise<string | null> {
  let value: string | null;
  try {
    value = await kv.get(await refreshKey(token));
  } catch {
    throw new Error("Token store is unavailable.");
  }
  return value;
}

/** Build a `302` Location with `code` and `state` appended to the redirect URI. */
export function buildRedirectLocation(
  redirectUri: string,
  code: string,
  state: string | undefined,
): string {
  const params = new URLSearchParams();
  params.set("code", code);
  if (state !== undefined && state !== "") params.set("state", state);
  const qs = params.toString();
  return redirectUri.includes("?")
    ? `${redirectUri}&${qs}`
    : `${redirectUri}?${qs}`;
}

/** HTML-escape a string for safe interpolation into HTML text/attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
