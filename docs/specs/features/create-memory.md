---
audience: implementers · clients
purpose: insert a memory and embed it
source: this file
date: 2026-08-14
---

# Create Memory

**Status:** `active`
**Owner:** tyler
**Related Specs:** [memory-model](../cross-cutting/memory-model.md), [authentication](../cross-cutting/authentication.md), [rest-api](rest-api.md)

---

## Summary

An authorized caller writes a new memory into the store. The REST API trims
`content`, fills defaults, assigns a UUID v4, embeds the text before
acknowledging success, and returns the new record. Thin clients (CLI, local
MCP, remote MCP) only forward this operation
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)).

## User Stories

- As an **operator**, I can **save a piece of text with an optional source and metadata** so that **later search and fetch can retrieve it**
- As a **thin client**, I can **POST the same body the API documents** so that **I do not reimplement defaults or embedding**

## Acceptance Criteria

- [x] `S1` A request with non-empty `content` creates one memory and returns it
- [x] `S1` `content` is trimmed before store and embed
- [x] `S1` Omitted `source` becomes `"manual"`
- [x] `S1` Omitted `metadata` becomes `{}`
- [x] `S1` Provided `metadata` must be a JSON object; `null` or an array is rejected
- [x] `S1` Empty or whitespace-only `content` is rejected as validation failure; nothing is stored
- [x] `S1` On success the memory has an embedding, `embedding_model`, and `embedded_at`
- [x] `S1` HTTP success status is **201** with body `{ memory }`
- [x] `S1` The returned memory includes `id`, `content`, `source`, `metadata`, `embedding_model`, `created_at`, `updated_at`, `embedded_at`
- [x] `S1` Embed or store failure does not leave a successful 201; the caller sees `500`
- [x] `S1` Auth is [authentication](../cross-cutting/authentication.md); the key is not stored on the memory
- [x] `S1` Whitespace-only `source` is treated as omitted (`"manual"`)
- [x] `S1` A request body that is valid JSON but not an object is rejected; nothing is stored
- [x] `S1` Content or a document larger than the embedder or store will accept is rejected; nothing is stored or indexed
- [x] `S1` Embed, store, or index failure leaves no memory row and no index entry

## Observable Contract

### REST `POST {api}/memories`

Headers: `content-type: application/json`, `x-api-key: <key>`

Body: `{ content, source?, metadata? }`

- `201` → `{ memory }`
- `400` → `{ error }` (`content` / `metadata` / body shape / invalid JSON / too large)
- `401` → `{ error: "Unauthorized." }`
- `405` → `{ error: "Method not allowed." }`
- `500` → `{ error }` (missing API key config, embed failure, store failure, index failure)

A `500` from embed, store, or index means the caller may retry. A retry is a
**new** create (two POSTs → two ids). Create is not upsert.

Validation messages:

- `` `content` must be a non-empty string. ``
- `` `metadata` must be a JSON object when provided. ``
- `Request body must be valid JSON.`
- `Request body must be a JSON object.`
- `` `content` is too large. ``
- `Memory is too large to store.`

Clients map this route; they do not invent another body.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | `POST /v1/memories` create + embed | #5 | #1 #2 #3 #4 |

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| `content` is `"   "` | 400; nothing stored or indexed |
| `source` is `""` or `"   "` | Treated as omitted → `"manual"` |
| `metadata` is `[]` or `null` | 400 `` `metadata` must be a JSON object when provided. `` |
| Body is valid JSON but not an object (`[]`, `"x"`, `42`) | 400 `Request body must be a JSON object.`; nothing stored or indexed |
| `content` exceeds the embedder's maximum input | 400 `` `content` is too large. ``; nothing stored or indexed |
| Document (content + metadata) exceeds the store's row ceiling | 400 `Memory is too large to store.`; nothing stored or indexed |
| Embedding provider is down | 500; no row; no index entry |
| Store write fails after embed (and after any index write) | 500; vector compensated (deleted); no row |
| Index write fails after store write | 500; row rolled back / deleted; no index entry |
| Compensation itself fails | Still 500, no 201. Leftovers possible — in-request delete is not a distributed transaction. |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED]. Do not log `content`,
metadata, API keys, or embeddings. Compensation is visible to the caller
only as the `500`; a dedicated signal, queue, or repair path is out of scope.

**Audit / domain events:** None.

## Out of Scope

- Update / upsert
- Deferred embedding (embed before 201)
- Silent truncate of `content` (stored text must equal embedded text)
- Changing the embedding model (see [ADR-0006](../../decisions/0006-embed-with-workers-ai-index-in-vectorize.md); that is a re-embed, not a config flip)
- Durable outbox, compensation metrics, or a repair queue
- Client-specific create behavior

## Open Questions

- None.
