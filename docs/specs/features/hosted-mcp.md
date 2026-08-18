---
audience: implementers · MCP clients
purpose: thin remote MCP client of the REST API, gated by OAuth, on Cloudflare
source: this file
date: 2026-08-17
---

# Hosted MCP

**Status:** `review`
**Owner:** tyler
**Related Specs:** [rest-api](rest-api.md), [authentication](../cross-cutting/authentication.md), [oauth](../cross-cutting/oauth.md), [memory-model](../cross-cutting/memory-model.md), [search-memories](search-memories.md), [fetch-memory](fetch-memory.md), [create-memory](create-memory.md), [delete-memory](delete-memory.md)

---

## Summary

A Cloudflare Worker exposes Open Brain over MCP so hosted agents can call it.
It is a **thin client of the REST API**
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)): it translates
tool calls into HTTP and translates HTTP back into MCP content. It does not
embed, store, or decide authorization itself beyond credential checks.

Per [ADR-0008](../../decisions/0008-oauth-gate-in-front-of-hosted-mcp.md), the
Worker is deployed on its own hostname (`{mcp}`, e.g.
`https://mcp.openbrain.tylerevans.co`) and acts as both the MCP endpoint and a
minimal OAuth authorization server. Credentialing follows
[oauth](../cross-cutting/oauth.md): clients authenticate with issued bearer
tokens, and the Worker calls REST with the `API_KEY` it holds as a secret.
It does **not** forward any caller credential upstream.

This spec supersedes the previous revision's auth boxes (`x-api-key`
passthrough, bearer not accepted, no OAuth discovery served). Tool behavior —
the MCP-to-REST mapping — is unchanged.

Transport is **stateless streamable HTTP** (JSON responses, no session id).
No Durable Object. OAuth token-lifecycle state lives in one KV namespace; MCP
tool requests carry a token and finish. `POST /register`, `GET/POST
/authorize`, `POST /token`, and the two well-known documents follow
[oauth](../cross-cutting/oauth.md) exactly; this file pins only what is
MCP-specific.

## User Stories

- As a **hosted agent** (Claude, ChatGPT, Grok), I can **connect over OAuth with no custom headers** so that **I can use Open Brain from my native connector form**
- As a **BYOK client operator** (ChatMCP), I can **present a token minted out-of-band** so that **I don't need a browser OAuth popup**
- As an **operator**, I can **hit `/health` without a credential** so that **I know the Worker is up**
- As an **operator**, I can **paste my API key once in a browser** so that **chat clients get tokens without me provisioning each by hand**
- As the **API**, I can **remain the only domain implementation** so that **remote MCP cannot drift**

## Acceptance Criteria

### Slice S1 — Worker, discovery, BYOK gate, full tool surface

- [ ] `S1` `GET {mcp}/health` is unauthenticated and returns `200 { ok: true, service: "openbrain-mcp" }` with no secrets
- [ ] `S1` MCP is served over stateless streamable HTTP at `{mcp}/mcp`; JSON responses on; no server-side session
- [ ] `S1` `{mcp}/mcp` without `Authorization: Bearer` is `401` carrying the `WWW-Authenticate` challenge per [oauth](../cross-cutting/oauth.md)
- [ ] `S1` Any bearer token that does not resolve to an operator-minted token in KV is `401` with `error="invalid_token"` in the challenge. In S1 the gate does **not** parse JWTs — a presented access JWT is simply a KV miss and gets the same rejection
- [ ] `S1` An operator-minted token present in KV is accepted as `Bearer` at `{mcp}/mcp`, per the BYOK section of [oauth](../cross-cutting/oauth.md)
- [ ] `S1` `x-api-key` presented without a bearer token is `401` — the MCP surface never accepts the API key as a caller credential
- [ ] `S1` The Worker calls REST with its **own configured** `API_KEY` and never forwards a caller credential or token upstream
- [ ] `S1` Each advertised tool is implemented only by calling the matching REST route in [rest-api](rest-api.md)
- [ ] `S1` Advertised tools cover the full REST surface: `search_memories`, `fetch`, `create_memory`, `delete_memory` per the operation specs
- [ ] `S1` The Worker speaks the streamable-HTTP method set statelessly: `initialize` returns protocol version and a `tools` capability, `ping` succeeds, and no other capabilities are advertised
- [ ] `S1` `{mcp}/mcp` is POST-only; `GET /mcp` (SSE stream request) is `405` with the JSON error envelope
- [ ] `S1` `tools/call` results use the MCP envelope `{ content: [{ type: "text", text }] }`; domain failures arrive as HTTP 200 with `isError: true`
- [ ] `S1` Agent-facing text uses the [memory-model](../cross-cutting/memory-model.md) rendering, plus the per-operation text pins in the operation specs
- [ ] `S1` REST `401` / `400` / `500` become MCP tool errors (`isError: true`) with the server `error` string (or a status mention if the body has none)
- [ ] `S1` REST `404` on `fetch` / `delete_memory` is a **normal** (non-error) tool result with the operation spec's not-found text — absence is data for the agent, not a tool failure
- [ ] `S1` The Worker URL-encodes the `id` argument as a single path segment before calling REST; it validates nothing client-side — REST owns UUID validation
- [ ] `S1` Both well-known documents are served unauthenticated at the domain root with the fields required by [oauth](../cross-cutting/oauth.md)
- [ ] `S1` Unknown non-MCP paths return `404` `{ error: "Not found." }`

### Slice S2 — Interactive OAuth: authorize, codes, token issuance (static clients)

- [ ] `S2` `GET {mcp}/authorize` renders the minimal "paste your API key" form when all OAuth params validate per [oauth](../cross-cutting/oauth.md)
- [ ] `S2` Unknown client, unregistered `redirect_uri`, non-S256 challenge, or otherwise invalid request → `400` JSON, never a `302` to an unvalidated URI
- [ ] `S2` `POST {mcp}/authorize` with a wrong or missing key → `401`, form re-rendered with the generic error, no redirect
- [ ] `S2` `POST {mcp}/authorize` with a correct key → `302` to the validated `redirect_uri` with a code and echoed `state`
- [ ] `S2` Codes are single-use, bound to client/redirect/challenge, and expire after 10 minutes
- [ ] `S2` `POST {mcp}/token` `authorization_code` verifies PKCE S256 and issues an ~1h JWT (claims per [oauth](../cross-cutting/oauth.md)) plus a refresh token; `code_verifier` mismatch or replayed code → `invalid_grant`
- [ ] `S2` Static clients from `MCP_CLIENTS` can complete the flow (optional `client_secret` honored when present)
- [ ] `S2` Issued access tokens are accepted as `Bearer` at `{mcp}/mcp` (JWT signature/iss/aud/exp validation — the JWT-accepting gate path lands in this slice)
- [ ] `S2` Missing/empty `API_KEY`, `TOKEN_SECRET`, or unparseable `MCP_CLIENTS` fails closed with `500` naming what is missing

### Slice S3 — Dynamic registration + refresh rotation (ChatGPT path)

- [ ] `S3` `POST {mcp}/register` accepts redirect_URIs (`https:` only), generates a `client_id`, persists it to KV, and returns `201` with the client metadata
- [ ] `S3` A dynamically registered public client (`token_endpoint_auth_method: none`) completes authorize + token end-to-end
- [ ] `S3` `refresh_token` grant issues a rotated pair and deletes the used token
- [ ] `S3` Replaying a used or unknown refresh token → `400 { "error": "invalid_grant" }`

## Observable Contract

Let `{mcp}` be the MCP Worker origin (no trailing slash), e.g.
`https://mcp.openbrain.tylerevans.co`.

### Endpoints this Worker owns

| Endpoint | Auth | Behavior |
| -------- | ---- | -------- |
| `GET {mcp}/health` | none | `200 { ok, service: "openbrain-mcp" }`, `Cache-Control: no-store` |
| `GET {mcp}/.well-known/oauth-protected-resource` | none | RFC 9728 metadata ([oauth](../cross-cutting/oauth.md)) |
| `GET {mcp}/.well-known/oauth-authorization-server` | none | RFC 8414 metadata ([oauth](../cross-cutting/oauth.md)) |
| `POST {mcp}/register` | none | DCR ([oauth](../cross-cutting/oauth.md)) |
| `GET/POST {mcp}/authorize` | pasted API key | authorization flow ([oauth](../cross-cutting/oauth.md)) |
| `POST {mcp}/token` | per-client | grants ([oauth](../cross-cutting/oauth.md)) |
| `{mcp}/mcp` | `Bearer` (issued access JWT or operator-minted token) | MCP tools below |

### MCP tool mapping

Stateless streamable HTTP. This Worker is a complete wrapper of REST, not a
read-only subset. Upstream calls carry the Worker's own `API_KEY` to `{api}`
from its `API_URL` config.

| Tool              | REST                         |
| ----------------- | ---------------------------- |
| `search_memories` | `POST {api}/memories/search` |
| `fetch`           | `GET {api}/memories/{id}`    |
| `create_memory`   | `POST {api}/memories`        |
| `delete_memory`   | `DELETE {api}/memories/{id}` |

Tool schemas and result text live in the operation specs. This spec owns the
mapping, the credential substitution, and the "no local domain logic" rule.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1` | Worker + MCP tools + well-knowns + BYOK `Bearer` acceptance | #10 | REST routes on main (#11) |
| `S2` | `/authorize`, codes, `/token` authorization_code, static clients | #10 | `S1` |
| `S3` | `/register` (DCR), `refresh_token` rotation | #10 | `S2` |

Client readiness per slice: ChatMCP works at `S1`; Grok and Claude at `S2`;
ChatGPT at `S3`.

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| KV unreachable during gate check (BYOK lookup) or token issuance | Loud failure: `500` with actionable message; never silently open |
| Just-minted or just-revoked BYOK token | KV propagation (~1 min); operator waits and retries ([oauth](../cross-cutting/oauth.md)) |
| Health while REST is down | `200` if this Worker is up; health does not proxy REST |
| REST unreachable or misconfigured (`API_KEY`/`API_URL`) | MCP tool error (`isError: true`); do not retry as a different identity |
| Expired access JWT at `/mcp` | `401` with `error="invalid_token"`; client refreshes via `S3` rotation |
| Caller sends `x-api-key` and no bearer | `401` — see Anti-Patterns in [oauth](../cross-cutting/oauth.md) |
| `/authorize` brute force | Accepted risk in v1 (high-entropy key); see [oauth](../cross-cutting/oauth.md) |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED] beyond the [oauth](../cross-cutting/oauth.md)
log-prohibition list (never log keys, tokens, codes, verifiers, or `Authorization` /
`x-api-key` headers) and “never log memory contents.”

**Audit / domain events:** None.

## Out of Scope

- Durable Objects / stateful MCP sessions
- CIMD (client-id metadata documents) — deferred until ChatGPT's handshake demands it
- Refresh-chain revocation on replay detection (replay is `invalid_grant` only)
- Per-token revocation of access JWTs (1h TTL is the bound; see [ADR-0008](../../decisions/0008-oauth-gate-in-front-of-hosted-mcp.md))
- `/authorize` attempt throttling (accepted risk, v1)
- Implementing memory rules inside the Worker
- Local stdio MCP — [local-mcp](local-mcp.md) is deprecated

## Open Questions

- **ChatGPT deep-research tool naming.** ChatGPT's deep-research surface
  validates tools literally named `search` and `fetch`; ordinary dev-mode
  connector use does not. Our tool is `search_memories`. Decision on an alias
  is parked until the real connector handshake is exercised.
- **CIMD timing.** Add only if DCR proves insufficient for ChatGPT.
- **Text for an unreachable REST upstream.** When the upstream call to `{api}`
  throws (network error, DNS, connection refused — no HTTP response), the edge
  table pins `isError: true` but not the result *text*. The AC's "server `error`
  string (or a status mention if the body has none)" assumes an HTTP response
  exists. Pick a generic message (e.g. `REST API is unreachable.`), or define
  what a no-status tool error says. — tyler

## Historical note

The prior revision of this spec specified `x-api-key` passthrough and no OAuth
discovery; those boxes were superseded here per
[ADR-0008](../../decisions/0008-oauth-gate-in-front-of-hosted-mcp.md). Older
still, the pre-Cloudflare function (`3d52b8e`) used JWKS, client/subject
allowlists, and AAL2 — a reminder that the single-tenant-via-API-key design is
a deliberate simplification relative to what OAuth _could_ require, recorded so
nobody reads this spec as an oversight.
