import type { RestClient } from "./rest-client.js";

/**
 * Cloudflare bindings for the MCP Worker (ADR-0008).
 *
 * - `API_KEY` (secret) — the root credential; also the Worker's own upstream
 *   credential when it calls REST. Never forwarded from the caller.
 * - `API_URL` (var) — the versioned REST root `{api}` (origin + `/v1`, no
 *   trailing slash), e.g. `https://openbrain.tylerevans.co/v1`.
 * - `TOKENS` (KV) — operator-minted BYOK token hashes in S1; codes / refresh
 *   tokens in S2+. The single stateful read on the hot path.
 * - `TOKEN_SECRET` (secret, S2+) — HMAC signing secret for access JWTs.
 *   Required from S2 on for the whole `/mcp` gate (BYOK lookups included) and
 *   for `POST /token` signing. A loud mis-deploy beats silently serving minted
 *   tokens around a broken JWT path (oauth.md).
 * - `MCP_CLIENTS` (var, S2+) — optional JSON static client registry
 *   (`client_id → { client_secret?: string, redirect_uris: string[] }`).
 *   Unset/empty is valid (static path optional); set-but-malformed is an
 *   operator error that 500s the routes that consult it (oauth.md).
 */
export type McpBindings = {
  API_KEY?: string;
  API_URL?: string;
  TOKENS?: KVNamespace;
  TOKEN_SECRET?: string;
  MCP_CLIENTS?: string;
};

/**
 * Test seam. Inject a `FakeRest` to record upstream calls and return canned
 * responses without touching the network. Production resolves a
 * `fetchRestClient` from `McpBindings` per request.
 */
export type AppOptions = {
  rest?: RestClient;
};
