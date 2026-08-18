---
audience: all contributors
purpose: how OAuth gates the hosted MCP surface — clients, tokens, and the single-tenant threat model
source: this file
date: 2026-08-17
---

# OAuth — Cross-Cutting Spec

**Status:** `review`
**Owner:** tyler
**Applies To:** the hosted MCP Worker ([hosted-mcp](../features/hosted-mcp.md)). REST and the CLI continue per [authentication](authentication.md).

---

## Summary

Per [ADR-0008](../../decisions/0008-oauth-gate-in-front-of-hosted-mcp.md), the
hosted MCP endpoint is gated by OAuth served from a dedicated MCP Worker on its
own hostname. This is the **easiest possible OAuth for a single tenant**: one
operator, no user model, no consent UX beyond "prove you hold the API key."

The shared `API_KEY` remains the root credential. Every credential the MCP
surface honors traces back to it: interactive clients paste it at the
authorization page; non-interactive (BYOK) clients hold a token the operator
minted out-of-band with no browser involved. An OAuth client that cannot
produce the key gets nothing — which is why otherwise-open registration is
safe here (see Client Registration).

`x-api-key` on REST and the CLI is **unchanged**
([authentication](authentication.md)). This spec governs only the MCP Worker.

## Canonical Behavior

### Identifiers and configuration

- `{mcp}` is the MCP Worker public origin (e.g.
  `https://mcp.openbrain.tylerevans.co`), no trailing slash.
- The MCP Worker is configured with:
  - `API_KEY` — the root credential, checked at the authorization page and also
    used as the Worker's own credential when it calls REST upstream.
  - `API_URL` — the versioned REST root (`{api}` from [rest-api](../features/rest-api.md)).
  - `TOKEN_SECRET` — signing secret for access tokens.
  - `MCP_CLIENTS` — optional JSON static client registry (see below).
  - a KV namespace binding for token-lifecycle state (codes, clients, refresh
    tokens, operator-minted tokens).
- **Fail closed, fail loud.** Missing/empty `API_KEY` or `TOKEN_SECRET`, or
  unparseable `MCP_CLIENTS`, makes routes that need them return `500` with an
  actionable message naming what is missing. Nothing falls open.

### Discovery — unauthenticated, at the domain root

Both are `GET`, JSON, `Cache-Control: no-store`, and must sit at the domain
root (ChatGPT requires this; the dedicated hostname from ADR-0008 satisfies it
by construction):

- `{mcp}/.well-known/oauth-protected-resource` (RFC 9728): `resource` =
  `{mcp}/mcp`, `authorization_servers` = [`{mcp}`], bearer methods: header.
- `{mcp}/.well-known/oauth-authorization-server` (RFC 8414): `issuer` =
  `{mcp}`, `authorization_endpoint` = `{mcp}/authorize`, `token_endpoint` =
  `{mcp}/token`, `registration_endpoint` = `{mcp}/register`,
  `response_types_supported` = `["code"]`, `grant_types_supported` =
  `["authorization_code", "refresh_token"]`,
  `code_challenge_methods_supported` = `["S256"]`,
  `token_endpoint_auth_methods_supported` = `["none", "client_secret_basic", "client_secret_post"]`.

### Client registration — two paths

**Static path** (Grok: the connector form asks for a pre-defined client id).
`MCP_CLIENTS` maps `client_id` → `{ "client_secret"?: string, "redirect_uris": string[] }`.
The secret is optional; if present it is compared trimmed-exact like the API
key. Static clients exist as soon as the env is set — no DCR needed.

**Dynamic path** (ChatGPT: expects to register itself). `POST {mcp}/register`
(RFC 7591) is **unauthenticated**: it accepts `redirect_uris` (at least one,
`https:` only), optional `client_name`, `grant_types`, and
`token_endpoint_auth_method`; generates a random `client_id`; persists the
record in KV; and responds `201` with the `client_id` and the registered
metadata. Open DCR is safe in this threat model: registration grants nothing —
the API key is still required at `/authorize`. Do not gate DCR behind the key;
ChatGPT cannot present one and it would serve no security purpose.

**CIMD is not supported in v1.** A `client_id` that is a URL is rejected as an
unknown client. Add it only if the real ChatGPT handshake proves DCR
insufficient (see Open Questions in [hosted-mcp](../features/hosted-mcp.md)).

### Redirect URIs — exact match, always

At `/authorize`, `redirect_uri` must equal one of the client's registered URIs
byte-for-byte. No prefixes, no wildcards, no substring matching. If the client
is unknown or the URI does not match: `400` with the JSON error envelope,
**never** a `302` to an unvalidated URI. Only after the URI validates may
errors be delivered via `302` with `error` params and echoed `state`.

### Authorization — "paste your API key"

`GET {mcp}/authorize` requires `response_type=code`, `client_id`,
`redirect_uri`, `code_challenge`, `code_challenge_method=S256`; `scope` and
`state` are optional. Malformed or incompletely validated requests get `400`
JSON. Valid requests get `200 text/html`: a minimal page with all OAuth params
as hidden fields plus one input for the API key.

`POST {mcp}/authorize` trims and exact-compares the pasted key to `API_KEY`
(same comparison rules as [authentication](authentication.md)).

- Wrong or missing key: `401`, the form re-rendered with a generic
  "Invalid API key." message. No redirect, no detail beyond success/failure.
- Valid key: create an authorization code, store it in KV bound to
  `{ client_id, redirect_uri, code_challenge }`, and `302` to the validated
  `redirect_uri` with `code` and echoed `state`.

### Authorization codes

Random with ≥128 bits of entropy. **TTL 10 minutes** (conventional value, not
measured). **Single-use**: read-and-delete at exchange; an unknown, expired,
or replayed code is `400 { "error": "invalid_grant" }`.

### Token endpoint

`POST {mcp}/token`, form-encoded. Client authentication is whatever the client
registered with: `none` (public), `client_secret_basic`, or
`client_secret_post`. DCR clients default to `none`.

- `grant_type=authorization_code`: verify the code as above, then verify
  `code_verifier` per RFC 7636: `BASE64URL(SHA256(verifier))` must equal the
  stored `code_challenge`. Client id and redirect URI must match those bound
  at authorization time. Any mismatch → `400 { "error": "invalid_grant" }`.
  Success → `200` with `access_token`, `token_type: "Bearer"`,
  `expires_in: 3600`, `refresh_token`, `scope: "memories"`.
- `grant_type=refresh_token`: refresh tokens are opaque (≥128 bits), stored
  hashed in KV with a **30-day TTL** (conventional, not measured), bound to
  the client. Every use **rotates**: the old token is deleted and a new pair
  is issued. Replay of a rotated or unknown token →
  `400 { "error": "invalid_grant" }` (chain-wide revocation on replay
  detection is out of scope for v1).
- Anything else → `400 { "error": "unsupported_grant_type" }`.

### Access tokens — stateless by design

HMAC-signed JWTs using `TOKEN_SECRET`. Claims: `iss` = `{mcp}`, `aud` =
`{mcp}/mcp`, `sub` = `"operator"` (a constant; single tenant), `client_id`,
`scope` = `"memories"`, `iat`, `exp` = `iat + 1 hour`, `jti` random.

Validation checks signature, `iss`, `aud`, `exp` only — no storage read. The
MCP hot path adds one signature check and nothing else
(ADR-0008). 1-hour TTL is what bounds an unrevocable token's blast radius.

### MCP endpoint gating

`{mcp}/mcp` requires `Authorization: Bearer <token>`. Two token kinds:

1. **Access tokens** (JWTs as above; stateless).
2. **Operator-minted tokens**: opaque strings stored hashed in KV with a
   label and created-at; validated by lookup (the one stateful read on the
   hot path — BYOK only; see below).

Missing header → `401` with
`WWW-Authenticate: Bearer realm="{mcp}", resource_metadata="{mcp}/.well-known/oauth-protected-resource"`.
A presented-but-rejected token (bad signature, expired, unknown) → `401` with
the same challenge plus `error="invalid_token"`. Body follows the JSON error
envelope; 401 never says which check failed.

### Operator-minted tokens (BYOK / non-interactive path)

For clients with no browser (ChatMCP and similar), the operator mints a
long-lived bearer out-of-band: a documented command (wrangler KV CLI via a
package script) generates a random ≥128-bit token, writes its hash to KV with
an operator-chosen label, and prints the token **once**. No expiry in v1;
revocation is deleting the KV key. A control assertion: minted tokens carry
the same authority as everything else — full store access, single tenant.

KV is eventually consistent: a just-minted token (or just-revoked one) may take
on the order of a minute to be visible at every edge. The documented operator
response is "wait and retry," not a spec gap.

### Scopes

v1 is scope-light by design: `scope` params are **accepted and ignored**, all
tokens carry `scope: "memories"`, and no other scope exists. Clients that
send scopes (ChatGPT does) must not be rejected for it.

### Single-tenant statement

Every valid credential grants access to the entire store. There is no owner
partition and tokens must never be used as an owner id on memory rows
([memory-model](memory-model.md)). Per-user isolation is a **non-goal**; if a
second human ever gets a credential, this spec is the thing to revisit.

### What must never be logged

`API_KEY`, `TOKEN_SECRET`, pasted keys, access/refresh tokens, authorization
codes, PKCE verifiers, `MCP_CLIENTS` values, `Authorization` and `x-api-key`
headers. A 401 must not reveal which check failed.

### Brute force on `/authorize`

Out of scope for v1: no attempt throttling. The mitigation is a high-entropy
(≥128-bit random) `API_KEY`. Documented as an accepted risk; revisit if key
entropy practices ever change.

## Feature Integration Contract

Every feature spec served over the MCP Worker MUST document:

- Which credential kinds the surface accepts (JWT, minted token, or both)
- The 401 + `WWW-Authenticate` behavior (or a pointer here if unchanged)
- That no per-user identity is derived from tokens — the only subject is the
  constant `"operator"`
- That the Worker substitutes its own upstream credential and never forwards
  caller credentials to REST

## Exceptions

| Surface | Deviation | Reason |
| ------- | --------- | ------ |
| REST API + CLI | Governed by [authentication](authentication.md), `x-api-key` only | ADR-0004/0008: OAuth is a gate in front of MCP, not a REST change |
| `{mcp}/health` | Unauthenticated | Readiness probe; no secrets |
| Both well-known documents + `/register` + `/token` | Unauthenticated | Discovery and pre-authorization endpoints by definition; they grant no tokens without the API key |

## Anti-Patterns

- **Accepting the API key as `Authorization: Bearer` or at the MCP surface at
  all:** MCP credentials are issued tokens only; `x-api-key` on the MCP Worker
  is `401`, not a backdoor.
- **Wildcard or prefix matching on redirect URIs:** an open redirect here
  exfiltrates authorization codes. Exact match or `400`.
- **PKCE `plain`, the implicit flow, or password grants:** S256
  authorization-code only.
- **Stateless (JWT) refresh tokens or refresh without rotation:** refresh must
  be revocable, which means stored, which means KV. Rotation without storage
  is theater.
- **Gating `/register` behind the API key:** ChatGPT cannot present one, and
  registration grants nothing anyway.
- **Deriving identity from tokens** (`sub`, `client_id`, request counts) to
  partition memories: there is one tenant. Tokens are a gate, not a user id.
- **Claiming CIMD support** before any code serves it.
