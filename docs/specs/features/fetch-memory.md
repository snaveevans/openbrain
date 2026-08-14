---
audience: implementers · clients
purpose: load one memory by id
source: this file
date: 2026-08-14
---

# Fetch Memory

**Status:** `review`
**Owner:** tyler
**Related Specs:** [memory-model](../cross-cutting/memory-model.md), [authentication](../cross-cutting/authentication.md), [rest-api](rest-api.md)

---

## Summary

An authorized caller loads exactly one memory by UUID. This is a first-class
REST route so every thin client can use it
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)). The
pre-rewrite tree only had this on hosted MCP.

## User Stories

- As a **hosted or local agent**, I can **fetch a memory by the id search returned** so that **I can read the full record**
- As a **client that guessed or stale-cached an id**, I can **get a clear not-found** so that **I do not treat absence as a transport failure**

## Acceptance Criteria

- [ ] `S1` A valid UUID that exists returns exactly that memory
- [ ] `S1` The payload includes `id`, `content`, `source`, `metadata`, `created_at`, `updated_at`, and `embedded_at` / `embedding_model` when present
- [ ] `S1` A valid UUID that does not exist is **404** `{ error: "Memory not found." }`
- [ ] `S1` A non-UUID `id` is **400** with `` `id` must be a valid UUID. `` before storage is queried
- [ ] `S1` A memory without an embedding is still returned
- [ ] `S1` Auth is [authentication](../cross-cutting/authentication.md)
- [ ] `S1` MCP clients that wrap this route use agent text `Memory <id> was not found.` when REST returns 404

## Observable Contract

### REST `GET {api}/memories/{id}`

Headers: `x-api-key: <key>`

- `200` → `{ memory }`
- `400` → `{ error }` (non-UUID)
- `401` → `{ error: "Unauthorized." }`
- `404` → `{ error: "Memory not found." }`
- `405` → `{ error: "Method not allowed." }`
- `500` → `{ error }`

MCP `fetch` and the CLI `fetch` command are clients of this route. They do
not look up storage themselves.

## Delivery Plan

Single slice — the whole feature (`S1`).

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| Unknown UUID | 404 |
| Malformed id | 400; no store lookup |
| Memory exists but was never embedded | 200; omit or null embedding fields per memory-model |
| Unauthenticated | 401 |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED]. Do not log memory contents
or API keys.

**Audit / domain events:** None.

## Out of Scope

- Batch fetch
- Fetch by anything other than UUID

## Open Questions

- None.
