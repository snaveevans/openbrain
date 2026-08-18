import { sha256Hex } from "../src/gate.js";
import { FakeKV, FakeRest } from "./fakes.js";

export { sha256Hex };

/** The Worker's own upstream credential (never forwarded from the caller). */
export const API_KEY = "worker-own-key";
/** A caller-supplied key that must never reach REST. */
export const CALLER_KEY = "caller-key";
export const API_URL = "https://api.test/v1";
/** An operator-minted BYOK token seeded into KV. */
export const VALID_TOKEN = "valid-byok-token";
/** Test-known HMAC signing secret for access JWTs (S2). */
export const TOKEN_SECRET = "test-token-secret";

/** A public static client (no secret) — the cheap Grok path. */
export const PUBLIC_CLIENT_ID = "grok-client";
export const PUBLIC_REDIRECT = "https://grok.example.com/callback";

/** A confidential static client (with secret) — the client-auth split path. */
export const CONFIDENTIAL_CLIENT_ID = "claude-client";
export const CONFIDENTIAL_CLIENT_SECRET = "claude-secret";
export const CONFIDENTIAL_REDIRECT = "https://claude.example.com/callback";

/** A valid `MCP_CLIENTS` JSON string with one public + one confidential client. */
export const MCP_CLIENTS_JSON = JSON.stringify({
  [PUBLIC_CLIENT_ID]: { redirect_uris: [PUBLIC_REDIRECT] },
  [CONFIDENTIAL_CLIENT_ID]: {
    client_secret: CONFIDENTIAL_CLIENT_SECRET,
    redirect_uris: [CONFIDENTIAL_REDIRECT],
  },
});

/** A wrong-shaped `MCP_CLIENTS` (valid JSON, invalid structure). */
export const MCP_CLIENTS_BAD_SHAPE = JSON.stringify([{ not: "a map" }]);

/** A valid PKCE S256 pair (verifier → challenge). Computed, not from RFC 7636. */
export const PKCE_VERIFIER = "test-verifier-123456789012345678901234567890";
export const PKCE_CHALLENGE = "Iajpm27U1_8PHjqNetQTja5FrNllTLWEPFSycjlTjYA";

export function makeEnv(kv: FakeKV, extra: Record<string, string> = {}) {
  return {
    API_KEY,
    API_URL,
    TOKENS: kv,
    TOKEN_SECRET,
    ...extra,
  };
}

/** Seed KV so `token` is accepted by the gate (keyed by its SHA-256 hash). */
export async function seedToken(kv: FakeKV, token: string): Promise<void> {
  kv.set(await sha256Hex(token), "minted");
}

export interface CallOptions {
  bearer?: string;
  xApiKey?: string;
  id?: number | string;
}

/**
 * POST a JSON-RPC request to `/mcp` on `app` with the given bindings.
 * `bearer`/`xApiKey` set the corresponding request headers.
 */
/**
 * Build a `POST /mcp` JSON-RPC `RequestInit`. Tests pass it to
 * `app.request("/mcp", rpc(...), env)`. `bearer`/`xApiKey` set the request
 * headers.
 */
export function rpc(
  method: string,
  params: unknown,
  opts: CallOptions = {},
): RequestInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.bearer !== undefined)
    headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.xApiKey !== undefined) headers["x-api-key"] = opts.xApiKey;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: opts.id ?? 1,
    method,
    params,
  });
  return { method: "POST", headers, body };
}

/**
 * Build a `POST /authorize` form-encoded `RequestInit` with hidden OAuth
 * fields + the pasted API key. `apiKey` defaults to the correct key.
 */
export function authorizePost(
  params: Record<string, string>,
  apiKey: string = API_KEY,
): RequestInit {
  const body = new URLSearchParams({ ...params, api_key: apiKey }).toString();
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  };
}

/** Build a `POST /token` form-encoded `RequestInit`. */
export function tokenPost(params: Record<string, string>): RequestInit {
  const body = new URLSearchParams(params).toString();
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  };
}

/** Base64url-encode a string (for hand-crafting JWT parts in tests). */
function bytesToBase64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Hand-craft an unsigned `alg=none` JWT with a valid-looking payload. */
export function algNoneJwt(claims: Record<string, unknown>): string {
  const header = bytesToBase64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = bytesToBase64url(JSON.stringify(claims));
  return `${header}.${payload}.`;
}

/** Decode a JWT payload (no verification) for asserting claims in tests. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const pad =
    parts[1]!.length % 4 === 0 ? "" : "=".repeat(4 - (parts[1]!.length % 4));
  const b64 = (parts[1]! + pad).replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64)) as Record<string, unknown>;
}

export const SAMPLE_MEMORY = {
  id: "00000000-0000-4000-8000-000000000001",
  content: "hello world",
  source: "manual",
  metadata: {},
  created_at: "2026-08-14T12:00:00.000Z",
  updated_at: "2026-08-14T12:00:00.000Z",
  embedding_model: "test-embedder",
  embedded_at: "2026-08-14T12:00:00.000Z",
};

/** Expected memory-model block for {@link SAMPLE_MEMORY} (no similarity). */
export const SAMPLE_BLOCK = `id: 00000000-0000-4000-8000-000000000001
source: manual
created_at: 2026-08-14T12:00:00.000Z
updated_at: 2026-08-14T12:00:00.000Z
embedded_at: 2026-08-14T12:00:00.000Z
embedding_model: test-embedder
metadata: {}

hello world`;

export const SAMPLE_HIT = {
  ...SAMPLE_MEMORY,
  metadata: { tag: "x" },
  similarity: 0.8,
};

/** Expected memory-model block for {@link SAMPLE_HIT} (with similarity). */
export const SAMPLE_HIT_BLOCK = `id: 00000000-0000-4000-8000-000000000001
source: manual
created_at: 2026-08-14T12:00:00.000Z
updated_at: 2026-08-14T12:00:00.000Z
embedded_at: 2026-08-14T12:00:00.000Z
embedding_model: test-embedder
similarity: 0.8000
metadata: {"tag":"x"}

hello world`;

export { FakeRest, FakeKV };
