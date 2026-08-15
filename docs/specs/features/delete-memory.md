---
audience: implementers · clients
purpose: delete one memory by id
source: this file
date: 2026-08-14
---

# Delete Memory

**Status:** `review`
**Owner:** tyler
**Related Specs:** [memory-model](../cross-cutting/memory-model.md), [authentication](../cross-cutting/authentication.md), [rest-api](rest-api.md)

---

## Summary

An authorized caller permanently removes one memory by UUID. The REST API
owns the behavior. Thin clients only forward it
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)).

## User Stories

- As an **operator**, I can **delete a memory I no longer want retrieved** so that **search and fetch stop returning it**
- As an **operator who mistypes an id**, I can **get a not-found** so that **I know nothing was removed**

## Acceptance Criteria

- [ ] `S1` A valid UUID that exists is deleted and the deleted record is returned
- [ ] `S1` HTTP success is **200** with `{ memory, deleted: true }`
- [ ] `S1` The success `memory` includes `id`, `content`, `source`, `metadata`, `created_at`, `updated_at`, `embedding_model`, and `embedded_at`
- [ ] `S1` A valid UUID that does not exist is **404** `{ error: "Memory not found." }`
- [ ] `S1` A path `id` that is not a UUID v4 is **400** with `` `id` must be a valid UUID v4. ``; nothing is deleted
- [ ] `S1` After a successful delete, fetch of that id is not-found and search no longer returns it
- [ ] `S1` Auth is [authentication](../cross-cutting/authentication.md)

## Observable Contract

### REST `DELETE {api}/memories/{id}`

Headers: `x-api-key: <key>`

- `200` → `{ memory, deleted: true }`
- `400` → `{ error: "`id` must be a valid UUID v4." }`
- `401` → `{ error: "Unauthorized." }`
- `404` → `{ error: "Memory not found." }`
- `405` → `{ error: "Method not allowed." }`
- `500` → `{ error }`

Id is the path parameter, not a JSON body.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | `DELETE /v1/memories/{id}` | #7 | #1 #4 #6 |

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| Unknown UUID v4 | 404; store unchanged |
| Not a UUID v4 | 400 `` `id` must be a valid UUID v4. ``; nothing is deleted |
| UUID v4 whose spelling differs from the stored `id` | 404; path is not rewritten; store unchanged |
| Double delete | First 200, second 404 |
| Unauthenticated | 401; nothing is deleted |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED]. Do not log memory contents
or API keys.

**Audit / domain events:** None.

## Out of Scope

- Bulk delete
- Soft delete / tombstones

## Open Questions

- None.
