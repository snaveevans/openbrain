---
audience: implementers · MCP clients
purpose: thin remote MCP client of the REST API, on Cloudflare
source: this file
date: 2026-08-14
---

# Hosted MCP

**Status:** `review`
**Owner:** tyler
**Related Specs:** [rest-api](rest-api.md), [authentication](../cross-cutting/authentication.md), [memory-model](../cross-cutting/memory-model.md), [search-memories](search-memories.md), [fetch-memory](fetch-memory.md), [create-memory](create-memory.md), [delete-memory](delete-memory.md)

---

## Summary

A Cloudflare Worker exposes Open Brain over MCP so hosted agents can call
it. It is a **thin client of the REST API**
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)): it
translates tool calls into HTTP, and translates HTTP back into MCP
content. It does not embed, store, or decide authorization on its own.

Transport is **stateless streamable HTTP** (JSON responses, no session id).
No Durable Object. Each request authenticates, calls REST, and finishes.

Auth for this release is the shared API key
([authentication](../cross-cutting/authentication.md)). The Worker requires
`x-api-key` on tool calls and forwards that same header to REST. OAuth
discovery is not served. A later OAuth gate would sit in front of REST
(and, if needed, in front of this Worker) without changing tool _behavior_.

## User Stories

- As a **hosted agent**, I can **call MCP tools over HTTPS** so that **I can use Open Brain without a local process**
- As an **operator**, I can **hit `/health` without a key** so that **I know the Worker is up**
- As the **API**, I can **remain the only domain implementation** so that **remote MCP cannot drift**

## Acceptance Criteria

- [ ] `S1` `GET {public}/health` is unauthenticated and returns readiness JSON with no secrets
- [ ] `S1` Health payload includes `ok: true` and `service: "openbrain-mcp"` (no `auth_provider`)
- [ ] `S1` MCP is served over streamable HTTP at `{public}/mcp`; JSON responses on; no server-side session
- [ ] `S1` Tool calls without a valid `x-api-key` are rejected per [authentication](../cross-cutting/authentication.md) (`401` / `500` if the Worker itself has no configured key)
- [ ] `S1` The Worker forwards the caller's `x-api-key` to REST and does not substitute a different secret
- [ ] `S1` Each advertised tool is implemented only by calling the matching REST route in [rest-api](rest-api.md)
- [ ] `S1` Advertised tools cover the full REST surface: `search_memories`, `fetch`, `create_memory`, `delete_memory` — input/output per the operation specs
- [ ] `S1` Agent-facing text uses the [memory-model](../cross-cutting/memory-model.md) rendering
- [ ] `S1` REST `401` / `400` / `404` / `500` become MCP tool errors with the server `error` string (or a status mention if the body has none)
- [ ] `S1` The Worker does not publish `/.well-known/oauth-protected-resource`
- [ ] `S1` Unknown non-MCP paths return `404` `{ error: "Not found." }`

## Observable Contract

Let `{public}` be the public remote-MCP base URL.

### `GET {public}/health`

Unauthenticated. `200 { ok, service }` · `Cache-Control: no-store`.

### MCP endpoint `{public}/mcp`

Authenticated with `x-api-key`. Stateless streamable HTTP. This Worker is a
complete wrapper of REST, not a read-only subset.

| Tool              | REST                         |
| ----------------- | ---------------------------- |
| `search_memories` | `POST {api}/memories/search` |
| `fetch`           | `GET {api}/memories/{id}`    |
| `create_memory`   | `POST {api}/memories`        |
| `delete_memory`   | `DELETE {api}/memories/{id}` |

Tool schemas and result text live in the operation specs. This spec owns
the mapping and the “no local domain logic” rule.

## Delivery Plan

Single slice — the whole feature (`S1`). Depends on REST routes existing
(or being stubbed behind the same contract).

## Edge Cases & Error States

| Scenario                                                | Expected Behavior                                               |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| Health while REST is down                               | `200` if this Worker is up. Health does not proxy REST.         |
| REST 401                                                | MCP tool error; do not retry as a different user                |
| REST unreachable                                        | MCP tool error; no partial writes                               |
| Caller sends `Authorization: Bearer` and no `x-api-key` | `401` as a missing key. Bearer is not accepted in this release. |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED] beyond “never log the API
key or memory contents.” Historical `mcp.auth` / `mcp.tool.*` events are
not required for this slice.

**Audit / domain events:** None.

## Out of Scope

- Durable Objects / stateful MCP sessions
- OAuth, JWKS, client allowlists, AAL2
- Implementing memory rules inside the Worker
- Auth UI

## Historical contract (not to implement)

The pre-Cloudflare function (`3d52b8e`) used OAuth bearer tokens, JWKS,
client/subject/email allowlists, AAL2, and
`/.well-known/oauth-protected-resource`, and advertised only `search` and
`fetch`. That record is why a later OAuth gate is plausible. It is **not**
acceptance criteria for this rewrite.

## Open Questions

- None.
