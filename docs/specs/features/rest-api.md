---
audience: implementers · clients
purpose: the HTTP API that owns memory operations
source: this file
date: 2026-08-14
---

# REST API

**Status:** `in-progress`
**Owner:** tyler
**Related Specs:** [authentication](../cross-cutting/authentication.md), [memory-model](../cross-cutting/memory-model.md), [create-memory](create-memory.md), [fetch-memory](fetch-memory.md), [search-memories](search-memories.md), [delete-memory](delete-memory.md)

---

## Summary

The REST API is Open Brain's only domain surface
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)). Remote MCP,
local MCP, and the CLI call these routes. They do not have a second
create/search/fetch/delete contract.

This is a **new** HTTP shape, not the recovered `POST /create_memory` RPC
paths. Resource routes now, so a later OAuth gate can sit in front of the
same URLs without renaming them.

## User Stories

- As a **thin client** (CLI, local MCP, remote MCP), I can **call one HTTP API** so that **I do not reimplement memory rules**
- As an **operator**, I can **probe `/health` without a key** so that **I know the process is up**
- As a **future OAuth integrator**, I can **keep these routes** so that **a new credential does not invent a new API**

## Acceptance Criteria

- [x] `S1` `GET /v1/health` is unauthenticated and returns readiness JSON with no secrets and no memory contents
- [x] `S1` Health payload includes `ok: true` and `service: "openbrain"` (no `auth_provider`)
- [x] `S1` Every route below, except `/v1/health`, requires `x-api-key` per [authentication](../cross-cutting/authentication.md)
- [x] `S1` `POST /v1/memories` creates a memory ([create-memory](create-memory.md))
- [ ] `S1` `GET /v1/memories/{id}` fetches one memory ([fetch-memory](fetch-memory.md))
- [ ] `S1` `DELETE /v1/memories/{id}` deletes one memory ([delete-memory](delete-memory.md))
- [ ] `S1` `POST /v1/memories/search` searches ([search-memories](search-memories.md))
- [x] `S1` JSON error bodies are `{ error: string }`
- [x] `S1` Unknown paths return `404` `{ error: "Not found." }`
- [x] `S1` Wrong method on a known path returns `405` `{ error: "Method not allowed." }`
- [x] `S1` Unexpected failures return `500` `{ error }` and do not leak the API key
- [x] `S1` The API does not publish OAuth discovery routes

## Observable Contract

Public routes live under `/v1`. `{api}` is the versioned root — origin plus
`/v1`, no trailing slash (e.g. `https://openbrain.example.com/v1`). Client
`--base-url` / `OPENBRAIN_BASE_URL` is that same `{api}`. Operation specs
write `{api}/memories`, which is `POST /v1/memories` on the Worker.

| Method   | Path                  | Auth        | Success                         | Spec      |
| -------- | --------------------- | ----------- | ------------------------------- | --------- |
| `GET`    | `/v1/health`          | none        | `200 { ok, service }`           | this file |
| `POST`   | `/v1/memories`        | `x-api-key` | `201 { memory }`                | create    |
| `GET`    | `/v1/memories/{id}`   | `x-api-key` | `200 { memory }`                | fetch     |
| `DELETE` | `/v1/memories/{id}`   | `x-api-key` | `200 { memory, deleted: true }` | delete    |
| `POST`   | `/v1/memories/search` | `x-api-key` | `200 { matches }`               | search    |

Request and response field shapes live in the operation specs and in the
common package. This spec owns the URL table, status codes, and the error
envelope.

`Cache-Control: no-store` on `/health` and on authenticated responses.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | Routing, `/v1/health`, auth gate, error envelope | #4 | #3 |

Operation behavior is #5 (create), #6 (fetch), #7 (delete), #8 (search).

## Edge Cases & Error States

| Scenario                                               | Expected Behavior                                          |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `/v1/health` while storage is down                     | `200` if the process is up. Health does not probe storage. |
| Trailing slash vs not                                  | Treat as the same route                                    |
| `{id}` is not a UUID                                   | `400` from the fetch/delete specs, after auth              |
| Authenticated request, missing `API_KEY` on the server | `500` per authentication spec                              |
| Body is valid JSON but not an object                   | `400` `Request body must be a JSON object.` from the operation spec |

## Observability

**Request / tool telemetry:** [NOT SPECIFIED] beyond “do not log the API
key, `x-api-key`, or memory contents.”

**Audit / domain events:** None.

## Out of Scope

- OAuth / OIDC metadata and bearer tokens (later gate in front of _these_
  routes, new spec + ADR)
- Changing the embedding model or vector index (see [ADR-0006](../../decisions/0006-embed-with-workers-ai-index-in-vectorize.md); documents are in D1)
- MCP or CLI behavior (those specs)
- Package names and Worker wiring

## Open Questions

- None.
