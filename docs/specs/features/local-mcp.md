---
audience: implementers · operators
purpose: thin stdio MCP client of the REST API
source: this file
date: 2026-08-14
---

# Local MCP

**Status:** `review`
**Owner:** tyler
**Related Specs:** [rest-api](rest-api.md), [authentication](../cross-cutting/authentication.md), [memory-model](../cross-cutting/memory-model.md), [create-memory](create-memory.md), [delete-memory](delete-memory.md), [search-memories](search-memories.md), [fetch-memory](fetch-memory.md)

---

## Summary

A local stdio MCP server lets a desktop agent use Open Brain. It is a
**thin client of the REST API**
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)), not a second
store. Recovered idea from `packages/openbrain-mcp`; the URLs and the
addition of `fetch` follow the new REST table, not `POST /create_memory`.

## User Stories

- As an **operator**, I can **point a local MCP host at the REST API** so that **Claude Desktop / Cursor can use Open Brain without a browser**
- As an **operator who misconfigures the process**, I can **get a clear startup error** so that **I know which flag or env var is missing**

## Acceptance Criteria

- [ ] `S1` The process speaks MCP over **stdio**
- [ ] `S1` It requires an API key (`--api-key` or `OPENBRAIN_API_KEY`) and a REST base URL (`--base-url` or `OPENBRAIN_BASE_URL`)
- [ ] `S1` Missing key or base URL is a fatal startup error (not a tool-level error)
- [ ] `S1` Advertised tools: `create_memory`, `delete_memory`, `search_memories`, `fetch` (same names as [hosted-mcp](hosted-mcp.md))
- [ ] `S1` Each tool calls only the matching REST route with `x-api-key` and `content-type: application/json` where a body exists
- [ ] `S1` HTTP error bodies with `{ error: string }` surface that string to the agent; otherwise the status code is mentioned
- [ ] `S1` There is no `--project-id` and no implied vendor hostname
- [ ] `S1` Tool input/output matches the operation specs; agent text uses the memory-model rendering

## Observable Contract

CLI / env:

| Flag         | Env                  | Required |
| ------------ | -------------------- | -------- |
| `--api-key`  | `OPENBRAIN_API_KEY`  | yes      |
| `--base-url` | `OPENBRAIN_BASE_URL` | yes      |

`base-url` is the versioned REST root `{api}` from [rest-api](rest-api.md)
(origin plus `/v1`). Trailing slashes are stripped. Flags may be `--key value`
or `--key=value`.

| Tool              | REST                          |
| ----------------- | ----------------------------- |
| `create_memory`   | `POST {base}/memories`        |
| `fetch`           | `GET {base}/memories/{id}`    |
| `delete_memory`   | `DELETE {base}/memories/{id}` |
| `search_memories` | `POST {base}/memories/search` |

Startup log (stderr): `openbrain-mcp running on stdio`.

## Delivery Plan

Single slice — the whole feature (`S1`).

## Edge Cases & Error States

| Scenario                            | Expected Behavior                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Flag given without a value          | Fatal: `Missing value for --<key>`                                             |
| HTTP 4xx/5xx                        | Tool fails with the server `error` string                                      |
| Empty search                        | Success text from the search spec (not a throw)                                |
| Hosted MCP URL passed as `base-url` | Will fail — that surface is MCP, not REST. No special-case detection required. |

## Observability

**Request / tool telemetry:** None. Process crashes log
`Fatal error in openbrain-mcp: …` on stderr.

**Audit / domain events:** None.

## Out of Scope

- OAuth
- Embedding or storage
- Implementing domain rules locally

## Open Questions

- None.
