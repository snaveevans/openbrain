---
audience: implementers · clients
purpose: load one memory by id
source: this file
date: 2026-08-14
---

# Fetch Memory

**Status:** `active`
**Owner:** tyler
**Related Specs:** [memory-model](../cross-cutting/memory-model.md), [authentication](../cross-cutting/authentication.md), [rest-api](rest-api.md)

---

## Summary

An authorized caller loads exactly one memory by UUID v4. This is a first-class
REST route so every thin client can use it
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)). The
pre-rewrite tree only had this on hosted MCP. Create does not acknowledge a
memory unless the document and its embedding both succeed, so a fetchable row
includes `embedding_model` and `embedded_at`.

## User Stories

- As a **hosted or local agent**, I can **fetch a memory by the id search returned** so that **I can read the full record**
- As a **client that guessed or stale-cached an id**, I can **get a clear not-found** so that **I do not treat absence as a transport failure**

## Acceptance Criteria

- [x] `S1` A UUID v4 that exists returns exactly that memory as `200 { memory }`
- [x] `S1` The payload includes `id`, `content`, `source`, `metadata`, `created_at`, `updated_at`, `embedding_model`, and `embedded_at`
- [x] `S1` A UUID v4 that does not exist is **404** `{ error: "Memory not found." }`
- [x] `S1` A path `id` that is not a UUID v4 is **400** with `` `id` must be a valid UUID v4. `` before storage is queried
- [x] `S1` The path `id` is not rewritten; lookup is an exact match on the string as sent
- [x] `S1` Fetch does not create, embed, index, or delete
- [x] `S1` Auth is [authentication](../cross-cutting/authentication.md); it runs before the UUID check and before any store read
- [x] `S1` MCP clients that wrap this route use agent text `Memory <id> was not found.` when REST returns 404 — a normal (non-error) tool result; absence is not a transport or tool failure

## Observable Contract

### REST `GET {api}/memories/{id}`

Headers: `x-api-key: <key>`

- `200` → `{ memory }` (`id`, `content`, `source`, `metadata`, `created_at`, `updated_at`, `embedding_model`, `embedded_at`; no `similarity`)
- `400` → `{ error: "`id` must be a valid UUID v4." }`
- `401` → `{ error: "Unauthorized." }`
- `404` → `{ error: "Memory not found." }`
- `405` → `{ error: "Method not allowed." }`
- `500` → `{ error }` (missing API key config, store read failure)

`{id}` is a UUID v4 in 8-4-4-4-12 hexadecimal with version nibble `4` and
RFC 4122 variant (`8`, `9`, `a`, `b`, `A`, or `B`). Unhyphenated hex,
`urn:uuid:`, braces, UUID v1, and the nil UUID are not accepted. The server
does not lowercase, uppercase, or otherwise rewrite the path value. Lookup
compares that string to the stored `id` exactly.

Validation messages:

- `` `id` must be a valid UUID v4. ``
- `Unauthorized.`
- `Memory not found.`
- `API_KEY secret is not configured.`

MCP `fetch` and the CLI `fetch` command are clients of this route. They do
not look up storage themselves.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | `GET /v1/memories/{id}` (REST boxes) | #6 | #1 #4 |

The MCP agent-text box waits on #10 (phase 2).

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| Unknown UUID v4 | 404 `Memory not found.` |
| Not a UUID v4 | 400 `` `id` must be a valid UUID v4. ``; store not queried |
| UUID v4 whose hex case (or other spelling) differs from the stored `id` | 404; path is not rewritten |
| Unauthenticated, including on a malformed id | 401; store not queried |
| Missing or empty server `API_KEY` | 500 `API_KEY secret is not configured.`; store not queried |
| Store read fails | 500 `{ error }`; no write |
| Key in query, JSON body, or `Authorization: Bearer` | 401; store not queried |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED]. Do not log memory contents
or API keys.

**Audit / domain events:** None.

## Out of Scope

- Batch fetch
- Fetch by anything other than the path UUID v4
- Serving or repairing a row that was never embedded (create does not acknowledge one)

## Open Questions

- None.
