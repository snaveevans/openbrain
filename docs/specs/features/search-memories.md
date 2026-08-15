---
audience: implementers · clients
purpose: semantic search over the memory store
source: this file
date: 2026-08-14
---

# Search Memories

**Status:** `in-progress`
**Owner:** tyler
**Related Specs:** [memory-model](../cross-cutting/memory-model.md), [authentication](../cross-cutting/authentication.md), [rest-api](rest-api.md)

---

## Summary

An authorized caller searches the operator's memories by meaning, not by
keyword. The REST API embeds the query, ranks stored memories that already
have embeddings, and returns the closest matches. Thin clients only forward
this ([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)).

`threshold` lives on HTTP so remote MCP does not have to filter locally.
Published `similarity` is the index cosine clamped into `[0, 1]`
([ADR-0006](../../decisions/0006-embed-with-workers-ai-index-in-vectorize.md)).

## User Stories

- As a **hosted or local agent**, I can **search by a natural-language query** so that **I retrieve the operator's relevant notes**
- As a **caller with an empty or unrelated store**, I can **get a clean zero-hit result** so that **I do not confuse emptiness with failure**

## Acceptance Criteria

- [x] `S1` A non-empty `query` returns memories ranked by descending semantic similarity
- [x] `S1` Each hit includes the memory-model fields for a search result, including a `similarity` number in `[0, 1]`
- [x] `S1` Published `similarity` is the index cosine clamped to `[0, 1]` (`min(1, max(0, score))`). The score is not stretched
- [x] `S1` When `limit` is omitted, at most **10** hits are returned
- [x] `S1` When `limit` is provided, it is truncated toward zero then clamped to **1–25**
- [x] `S1` Eligible hits are ranked first; then hits **below** `threshold` are dropped (`==` is kept); then `limit` is applied
- [x] `S1` When `source` is provided, only memories with that exact `source` string are eligible
- [x] `S1` A leftover row without an embedding never appears. An index id with no document is dropped from `matches`
- [x] `S1` Zero eligible hits is a **success** with an empty match list, not an error
- [x] `S1` `query` is trimmed before the empty check and before embed
- [x] `S1` An empty or whitespace-only `query` is rejected as validation failure
- [x] `S1` A `query` larger than the embedder accepts is **400** `` `query` is too large. ``
- [x] `S1` Search does not create, update, index, or delete
- [x] `S1` Auth is [authentication](../cross-cutting/authentication.md); it runs before body parse, embed, and ranking
- [ ] `S1` MCP clients render zero hits as `No memories matched "<query>".` and non-empty hits with the memory-model text, numbered from `1`, separated by `---`

## Observable Contract

### REST `POST {api}/memories/search`

Headers: `content-type: application/json`, `x-api-key: <key>`

Body: `{ query, limit?, threshold?, source? }`

- `200` → `{ matches: Memory[] }` (possibly empty). Each hit has `id`,
  `content`, `source`, `metadata`, `created_at`, `updated_at`,
  `embedding_model`, `embedded_at`, and `similarity`. No other top-level
  keys. `Cache-Control: no-store`.
- `400` → `{ error }` on invalid JSON or validation
- `401` → `{ error: "Unauthorized." }`
- `405` → `{ error: "Method not allowed." }`
- `500` → `{ error }` (missing API key config, query embed failure, index
  query failure, document-store hydrate failure)

`query` is trimmed. The embedder sees the trimmed string. Search embeds the
query as a *query* task, not a document
([ADR-0006](../../decisions/0006-embed-with-workers-ai-index-in-vectorize.md)).

`similarity` is the index cosine clamped to `[0, 1]`. Values below `0`
become `0`; values above `1` become `1`. `(score + 1) / 2` is not used.
`threshold` compares against that published number.

Pipeline: rank by descending published `similarity` → drop hits **below**
`threshold` when it is provided → take at most `limit`. The index may be
asked for more than `limit` so a later drop can still fill the page.
A just-created memory may not appear until the index is consistent
([ADR-0006](../../decisions/0006-embed-with-workers-ai-index-in-vectorize.md));
that lag is not a `500`.

Search is read-only. A `400`, `401`, or `500` writes nothing.

Validation messages:

- `` `query` must be a non-empty string. ``
- `` `query` is too large. ``
- `` `limit` must be a number when provided. ``
- `` `threshold` must be a number in [0, 1]. ``
- `` `source` must be a non-empty string when provided. ``
- `Request body must be valid JSON.`
- `Request body must be a JSON object.`
- `Unauthorized.`
- `API_KEY secret is not configured.`

Both MCP clients advertise this as `search_memories` (not a generic `search`,
which collides with web-search tools on the same host). Both POST this route
with the same body.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | `POST /v1/memories/search` (REST boxes) | #8 | #1 #2 #4 #5 |

MCP rendering boxes wait on #10 (phase 2). Delete-then-search also closes
the search half of [delete-memory](delete-memory.md) `S1`.

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| Store is empty | `200 { matches: [] }` |
| Leftover document with no index entry | Not a hit |
| Index id with no document | Dropped from `matches`. All orphans → `200 { matches: [] }` |
| `query` is `"   "` | 400 `` `query` must be a non-empty string. ``; embedder not called |
| `query` missing, `null`, or not a string | 400 `` `query` must be a non-empty string. `` |
| `query` exceeds the embedder's maximum input | 400 `` `query` is too large. ``; embedder not called with that text as a successful embed |
| `limit` omitted | At most 10 hits |
| `limit` is a finite float | Truncated toward zero, then clamped to 1–25 |
| `limit` is `0` or negative | Clamped to 1 |
| `limit` is greater than 25 | Clamped to 25 |
| `limit` is not a finite number (`"10"`, `null`, `true`, `[]`, `NaN`, `Infinity`) | 400 `` `limit` must be a number when provided. `` |
| `threshold` omitted | All ranked hits up to `limit` |
| `threshold` is `0` or `1` | Valid. `0` keeps clamped zeros; `1` keeps only `1` |
| `threshold` not a finite number, or outside `[0, 1]` | 400 `` `threshold` must be a number in [0, 1]. `` |
| Index cosine `0.8` | Published `similarity` is `0.8` |
| Index cosine `-0.2` | Published `similarity` is `0.0` |
| Index cosine `1.2` | Published `similarity` is `1.0` |
| `threshold` set and every hit is below it | `200 { matches: [] }` |
| More hits sit at or above `threshold` than `limit` | First `limit` after the drop, still descending |
| `source` provided | Exact, case-sensitive match. `"Note"` does not match `"note"` |
| `source` is `""`, `"   "`, `null`, or not a string | 400 `` `source` must be a non-empty string when provided. `` |
| `source` filter matches nothing | `200 { matches: [] }` |
| Body is `{` / empty / not JSON | 400 `Request body must be valid JSON.` |
| Body is valid JSON but not an object (`[]`, `"x"`, `42`) | 400 `Request body must be a JSON object.` |
| Query embedding provider is down | `500`, not an empty success. Nothing written |
| Query embed returns no values | `500`, not an empty success. Nothing written |
| Index query fails | `500`, not an empty success. Nothing written |
| Document hydrate fails | `500`, not an empty success. Nothing written |
| Unauthenticated, including on invalid JSON | 401; embedder and stores not called |
| Missing or empty server `API_KEY` | 500 `API_KEY secret is not configured.`; embedder and stores not called |
| Key in query, JSON body, or `Authorization: Bearer` | 401; embedder and stores not called |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED]. Do not log the query text,
embeddings, tokens, API keys, or memory contents.

**Audit / domain events:** None.

## Out of Scope

- Keyword / full-text search
- Pagination beyond `limit` (no cursor)
- Changing the embedding model or vector index (see [ADR-0006](../../decisions/0006-embed-with-workers-ai-index-in-vectorize.md))
- A dedicated leftover-repair feature
- CLI / MCP search clients (including the MCP numbered-text box)
- Extra JSON keys on the body, missing or wrong `Content-Type`, and
  equal-score tie-breaks — unspecified this slice

## Open Questions

- [ ] Extra keys on the search body (`id`, `similarity`, unknown): ignore or `400`? — tyler
