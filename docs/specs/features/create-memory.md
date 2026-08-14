---
audience: implementers · clients
purpose: insert a memory and embed it
source: this file
date: 2026-08-14
---

# Create Memory

**Status:** `review`
**Owner:** tyler
**Related Specs:** [memory-model](../cross-cutting/memory-model.md), [authentication](../cross-cutting/authentication.md), [rest-api](rest-api.md)

---

## Summary

An authorized caller writes a new memory into the store. The REST API trims
`content`, fills defaults, embeds the text before acknowledging success, and
returns the new record. Thin clients (CLI, local MCP, remote MCP) only
forward this operation ([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)).

## User Stories

- As an **operator**, I can **save a piece of text with an optional source and metadata** so that **later search and fetch can retrieve it**
- As a **thin client**, I can **POST the same body the API documents** so that **I do not reimplement defaults or embedding**

## Acceptance Criteria

- [ ] `S1` A request with non-empty `content` creates one memory and returns it
- [ ] `S1` `content` is trimmed before store and embed
- [ ] `S1` Omitted `source` becomes `"manual"`
- [ ] `S1` Omitted `metadata` becomes `{}`
- [ ] `S1` Provided `metadata` must be a JSON object; `null` or an array is rejected
- [ ] `S1` Empty or whitespace-only `content` is rejected as validation failure; nothing is stored
- [ ] `S1` On success the memory has an embedding, `embedding_model`, and `embedded_at`
- [ ] `S1` HTTP success status is **201** with body `{ memory }`
- [ ] `S1` The returned memory includes `id`, `content`, `source`, `metadata`, `embedding_model`, `created_at`, `updated_at`, `embedded_at`
- [ ] `S1` Embed or store failure does not leave a successful 201; the caller sees `500`
- [ ] `S1` Auth is [authentication](../cross-cutting/authentication.md); the key is not stored on the memory

## Observable Contract

### REST `POST {api}/memories`

Headers: `content-type: application/json`, `x-api-key: <key>`

Body: `{ content, source?, metadata? }`

- `201` → `{ memory }`
- `400` → `{ error }` (`content` / `metadata` / invalid JSON)
- `401` → `{ error: "Unauthorized." }`
- `405` → `{ error: "Method not allowed." }`
- `500` → `{ error }` (missing API key config, embed failure, store failure)

Validation messages:

- `` `content` must be a non-empty string. ``
- `` `metadata` must be a JSON object when provided. ``
- `Request body must be valid JSON.`

Clients map this route; they do not invent another body.

## Delivery Plan

Single slice — the whole feature (`S1`).

## Edge Cases & Error States

| Scenario                      | Expected Behavior               |
| ----------------------------- | ------------------------------- |
| `content` is `"   "`          | 400; nothing stored             |
| `source` is `""`              | Treated as omitted → `"manual"` |
| `metadata` is `[]` or `null`  | 400                             |
| Embedding provider is down    | 500; no successful create       |
| Store write fails after embed | 500                             |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED]. Do not log `content`,
metadata, API keys, or embeddings.

**Audit / domain events:** None.

## Out of Scope

- Update / upsert
- Deferred embedding (embed before 201)
- Choosing the embedding vendor
- Client-specific create behavior

## Open Questions

- None.
