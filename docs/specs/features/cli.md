---
audience: implementers · operators
purpose: thin CLI client of the REST API
source: this file
date: 2026-08-14
---

# CLI

**Status:** `review`
**Owner:** tyler
**Related Specs:** [rest-api](rest-api.md), [authentication](../cross-cutting/authentication.md), [memory-model](../cross-cutting/memory-model.md), [create-memory](create-memory.md), [fetch-memory](fetch-memory.md), [search-memories](search-memories.md), [delete-memory](delete-memory.md)

---

## Summary

A command-line client for operators. It is a **thin client of the REST
API** ([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)). It does
not speak MCP and does not touch storage.

## User Stories

- As an **operator**, I can **create, fetch, search, and delete from a shell** so that **I can seed and inspect the store without an agent**
- As an **operator**, I can **see HTTP errors as process failures** so that **scripts can branch on success**

## Acceptance Criteria

- [ ] `S1` The package is named **OpenBrain CLI**. After install, the binary on `PATH` is `openbrain`
- [ ] `S1` The CLI requires a REST base URL and API key from flags or `OPENBRAIN_BASE_URL` / `OPENBRAIN_API_KEY`
- [ ] `S1` Missing key or base URL is a fatal error before any request
- [ ] `S1` Commands exist for create, fetch, search, and delete, each calling only the matching REST route
- [ ] `S1` Success prints the JSON body the API returned (memory, `{ memory, deleted }`, or `{ matches }`)
- [ ] `S1` Non-OK HTTP exits non-zero and prints the server `error` string on stderr
- [ ] `S1` The CLI does not implement embedding, storage, or a second auth scheme

## Observable Contract

Config (same names as local MCP):

| Flag | Env | Required |
| ---- | --- | -------- |
| `--api-key` | `OPENBRAIN_API_KEY` | yes |
| `--base-url` | `OPENBRAIN_BASE_URL` | yes |

`--base-url` is the versioned REST root `{api}` from [rest-api](rest-api.md).

The published package title is **OpenBrain CLI**. The installed command is
`openbrain` (not `openbrain-cli`).

| Command | REST |
| ------- | ---- |
| `openbrain create --content … [--source …] [--metadata …]` | `POST {api}/memories` |
| `openbrain fetch --id <uuid>` | `GET {api}/memories/{id}` |
| `openbrain delete --id <uuid>` | `DELETE {api}/memories/{id}` |
| `openbrain search --query … [--limit …] [--threshold …] [--source …]` | `POST {api}/memories/search` |

Create `--metadata` is a JSON object string. Invalid JSON is a local
validation error (exit non-zero, no request).

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | OpenBrain CLI (`openbrain`) | #9 | #3 #5 #6 #7 #8 |

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| Unknown command | Non-zero exit, usage on stderr, no request |
| API 404 on fetch/delete | Non-zero exit, `Memory not found.` (or the server string) |
| API 401 | Non-zero exit, `Unauthorized.` |

## Observability

**Request / tool telemetry:** None.

**Audit / domain events:** None.

## Out of Scope

- Interactive TUI
- MCP
- Bulk import / export
- Storing the API key in a config file (env/flags only for this slice)

## Open Questions

- None.
