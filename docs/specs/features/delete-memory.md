---
audience: implementers · clients
purpose: delete one memory by id
source: this file
date: 2026-08-14
---

# Delete Memory

**Status:** `active`
**Owner:** tyler
**Related Specs:** [memory-model](../cross-cutting/memory-model.md), [authentication](../cross-cutting/authentication.md), [rest-api](rest-api.md)

---

## Summary

An authorized caller permanently removes one memory by UUID v4. Success
means the document and its index entry are both gone. The REST API owns
the behavior. Thin clients only forward it
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)).

## User Stories

- As an **operator**, I can **delete a memory I no longer want retrieved** so that **search and fetch stop returning it**
- As an **operator who mistypes an id**, I can **get a not-found** so that **I know nothing was removed**
- As an **operator who retries after a partial delete**, I can **remove the leftover side** so that **the id is fully gone**

## Acceptance Criteria

- [x] `S1` A UUID v4 whose document exists is removed from the document store and the index, and the deleted record is returned
- [x] `S1` HTTP success is **200** with `{ memory, deleted: true }` only when both the document and the index entry are gone
- [x] `S1` The success `memory` includes `id`, `content`, `source`, `metadata`, `created_at`, `updated_at`, `embedding_model`, and `embedded_at`
- [x] `S1` A UUID v4 that has no document and no index entry is **404** `{ error: "Memory not found." }`; neither store is written
- [x] `S1` A path `id` that is not a UUID v4 is **400** with `` `id` must be a valid UUID v4. ``; nothing is deleted; neither store is queried
- [x] `S1` The path `id` is not rewritten; lookup is an exact match on the string as sent
- [x] `S1` After a successful delete, fetch of that id is not-found and search no longer returns it
- [x] `S1` A failure that removes only one side is **500**; leftovers are possible. A later `DELETE` of the same id removes the remaining side
- [x] `S1` Auth is [authentication](../cross-cutting/authentication.md); it runs before the UUID check and before any store or index work

## Observable Contract

### REST `DELETE {api}/memories/{id}`

Headers: `x-api-key: <key>`

- `200` → `{ memory, deleted: true }` (`memory` has the fetch fields; no `similarity`)
- `400` → `{ error: "`id` must be a valid UUID v4." }`
- `401` → `{ error: "Unauthorized." }`
- `404` → `{ error: "Memory not found." }`
- `405` → `{ error: "Method not allowed." }`
- `500` → `{ error }` (missing API key config, document-store failure, index failure)

Id is the path parameter, not a JSON body.

`{id}` is a UUID v4 in 8-4-4-4-12 hexadecimal with version nibble `4` and
RFC 4122 variant (`8`, `9`, `a`, `b`, `A`, or `B`). Unhyphenated hex,
`urn:uuid:`, braces, UUID v1, and the nil UUID are not accepted. The server
does not lowercase, uppercase, or otherwise rewrite the path value. Lookup
compares that string to the stored `id` exactly.

`200` is atomic across the document store and the index: both are gone, or
the caller does not see success. A `500` that removed only one side leaves
that leftover. Retrying `DELETE` on the same id removes the remaining side
(the document if it is still there; the index entry if it is still there).
A dedicated repair queue is out of scope.

Validation messages:

- `` `id` must be a valid UUID v4. ``
- `Unauthorized.`
- `Memory not found.`
- `API_KEY secret is not configured.`

MCP `delete` and the CLI `delete` command are clients of this route. They
do not talk to storage themselves.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | `DELETE /v1/memories/{id}` | #7 | #1 #4 #6 |

The search-no-longer-returns-it half of the post-delete AC waits on #8 if
search has not landed. The fetch half is this issue.

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| Unknown UUID v4 (no document, no index entry) | 404 `Memory not found.`; neither store is written |
| Not a UUID v4 | 400 `` `id` must be a valid UUID v4. ``; neither store is queried |
| UUID v4 whose hex case (or other spelling) differs from the stored `id` | 404; path is not rewritten; neither store is written |
| Double delete (both sides already gone) | First 200, second 404 |
| Document exists, index entry already missing | 200 after the document is removed |
| Either side fails before both are gone | 500 `{ error }`; leftover is whichever side was not removed |
| Index delete fails after the document is gone | 500 `{ error }`; document gone; index entry remains |
| Document delete fails after the index is gone | 500 `{ error }`; index gone; document remains |
| Retry when the document remains | Remaining index (if any) and the document are removed; 200 `{ memory, deleted: true }` |
| Retry when only the index remains | Index entry is removed. HTTP envelope is an Open Question |
| Unauthenticated, including on a malformed id | 401; neither store is queried |
| Missing or empty server `API_KEY` | 500 `API_KEY secret is not configured.`; neither store is queried |
| Key in query, JSON body, or `Authorization: Bearer` | 401; neither store is queried |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED]. Do not log memory contents
or API keys. Leftovers after a `500` are visible to the caller only as that
`500`; a dedicated cleanup signal or queue is out of scope.

**Audit / domain events:** None.

## Out of Scope

- Bulk delete
- Soft delete / tombstones
- A dedicated leftover-repair feature or queue
- CLI / MCP delete clients

## Open Questions

- [ ] Retry finds no document but an index entry remains: the vector is still deleted. What is the HTTP envelope? `200` cannot include `memory` (there is no document). `404` `Memory not found.` would hide that this call did work. Pick one or a new `{ error }` / success shape. — tyler
