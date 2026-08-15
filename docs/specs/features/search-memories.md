---
audience: implementers · clients
purpose: semantic search over the memory store
source: this file
date: 2026-08-14
---

# Search Memories

**Status:** `review`
**Owner:** tyler
**Related Specs:** [memory-model](../cross-cutting/memory-model.md), [authentication](../cross-cutting/authentication.md), [rest-api](rest-api.md)

---

## Summary

An authorized caller searches the operator's memories by meaning, not by
keyword. The REST API embeds the query, ranks stored memories that already
have embeddings, and returns the closest matches. Thin clients only forward
this ([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)).

`threshold` lives on HTTP so remote MCP does not have to filter locally.

## User Stories

- As a **hosted or local agent**, I can **search by a natural-language query** so that **I retrieve the operator's relevant notes**
- As a **caller with an empty or unrelated store**, I can **get a clean zero-hit result** so that **I do not confuse emptiness with failure**

## Acceptance Criteria

- [ ] `S1` A non-empty `query` returns memories ranked by descending semantic similarity
- [ ] `S1` Each hit includes the memory-model fields for a search result, including a `similarity` number in `[0, 1]`
- [ ] `S1` When `limit` is omitted, at most **10** hits are returned
- [ ] `S1` When `limit` is provided, it is an integer clamped to **1–25**
- [ ] `S1` When `threshold` is provided, it is a number in `[0, 1]`; hits below it are dropped after ranking
- [ ] `S1` When `source` is provided, only memories with that exact `source` are eligible
- [ ] `S1` A leftover row without an embedding (create does not acknowledge one) never appears in results
- [ ] `S1` Zero eligible hits is a **success** with an empty match list, not an error
- [ ] `S1` An empty or whitespace-only `query` is rejected as validation failure
- [ ] `S1` Auth is [authentication](../cross-cutting/authentication.md)
- [ ] `S1` MCP clients render zero hits as `No memories matched "<query>".` and non-empty hits with the memory-model text, numbered from `1`, separated by `---`

## Observable Contract

### REST `POST {api}/memories/search`

Headers: `content-type: application/json`, `x-api-key: <key>`

Body: `{ query, limit?, threshold?, source? }`

- `200` → `{ matches: Memory[] }` (possibly empty)
- `400` → `{ error }` on invalid JSON or validation
- `401` → `{ error: "Unauthorized." }`
- `405` → `{ error: "Method not allowed." }`
- `500` → `{ error }` on embed or store failure

Validation:

- `` `query` must be a non-empty string. ``
- `threshold` if present must be a number in `[0, 1]`
- `limit` if present is truncated toward zero then clamped to 1–25

Both MCP clients advertise this as `search_memories` (not a generic `search`,
which collides with web-search tools on the same host). Both POST this route
with the same body.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | `POST /v1/memories/search` (REST boxes) | #8 | #1 #2 #4 #5 |

MCP rendering boxes wait on #10 (phase 2).

## Edge Cases & Error States

| Scenario                                  | Expected Behavior                   |
| ----------------------------------------- | ----------------------------------- |
| Store is empty                            | Success, zero hits                  |
| Leftover rows without embeddings          | Success, those rows are not hits    |
| `limit` is a float                        | Truncated toward zero, then clamped |
| `threshold` omitted                       | All ranked hits up to `limit`       |
| `threshold` set and every hit is below it | Success, zero hits                  |
| `source` filter matches nothing           | Success, zero hits                  |
| Query embedding provider is down          | `500`, not an empty success         |
| Unauthenticated                           | `401`                               |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED]. Do not log the query text,
embeddings, tokens, or memory contents.

**Audit / domain events:** None.

## Out of Scope

- Keyword / full-text search
- Pagination beyond `limit` (no cursor)
- Changing the embedding model or vector index (see [ADR-0006](../../decisions/0006-embed-with-workers-ai-index-in-vectorize.md))

## Open Questions

- None.
