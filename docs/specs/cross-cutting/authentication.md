---
audience: all contributors
purpose: every request is gated by a shared API key from the environment
source: this file
date: 2026-08-14
---

# Authentication — Cross-Cutting Spec

**Status:** `review`
**Owner:** tyler
**Applies To:** All features unless listed in Exceptions

---

## Summary

The first Cloudflare-hosted release authenticates with a **single shared API
key**. The server reads the expected key from the environment. The caller
sends the same value on every request. There is no OAuth, no session, no
per-user identity, and no key store. A request either presents the configured
key or it is rejected.

This replaces the recovered dual model (OAuth on hosted MCP, `x-api-key` on
operator HTTP). The historical OAuth challenge is not current behavior.

## Canonical Behavior

### The configured key

- The expected key lives in the process environment as `API_KEY`.
- It is required to serve authenticated routes. If it is missing or empty
  after trim, those routes fail closed with **500**
  `{ error: "API_KEY secret is not configured." }` — they do not become
  public.
- The key is not read from disk, a database, or a secrets manager API beyond
  whatever injected the environment (Worker binding / `.dev.vars` / shell).
- There is one key. There are no key ids, rotations, or per-client keys in
  this spec.

### The presented key

- Callers send the key in the `x-api-key` header.
- The server trims both the configured value and the presented value, then
  compares them as exact strings.
- Missing header, empty header, or any value that is not exactly the
  configured key is **401** `{ error: "Unauthorized." }`.
- 401 does not distinguish "missing" from "wrong". It does not say whether
  `API_KEY` is configured.
- Comparison must not leak the configured key via timing-safe-unaware logs or
  error bodies. Do not echo the presented key back.

### When it runs

- Authentication runs **before** body parsing, validation, and domain work.
- A 401 or a 500-for-missing-config never creates, searches, fetches, or
  deletes a memory.
- The key is a **gate**, not a domain input. Features do not receive a
  subject, email, or client id from it. The store stays single-tenant
  ([memory-model](memory-model.md)).

### What is not authenticated

Only routes listed under Exceptions may skip the check. Everything else —
including hosted MCP tool calls, if that surface is served — requires
`x-api-key`.

### Clients

Thin clients ([rest-api](../features/rest-api.md) callers) present the key
they were started with (`--api-key` / `OPENBRAIN_API_KEY`) as `x-api-key`
on every HTTP call: local MCP, remote MCP, and the CLI. Direct HTTP
callers do the same.

## Feature Integration Contract

Every feature spec MUST document:

- Whether the feature is reachable without `x-api-key` (only Exceptions
  qualify)
- The 401 / missing-config behavior, or a pointer here if it is unchanged
- That the feature does **not** use the key as a memory-partition or owner id

## Exceptions

| Feature | Deviation | Reason |
| ------- | --------- | ------ |
| `GET /v1/health` on REST and `GET {public}/health` on remote MCP | Unauthenticated | Readiness probe; no domain data, no secrets |

No other public exception is specified. OAuth discovery is not served.
When OAuth arrives it is a new spec (and usually an ADR) that adds a gate
in front of the same REST routes — it does not replace this file in place.

## Anti-Patterns

- **Accepting the key in the query string, JSON body, or `Authorization:
  Bearer`:** the recovered and current contract is `x-api-key` only.
- **Soft-failing a missing `API_KEY`:** an unconfigured server is not an
  open server.
- **401 vs 403 for a bad key:** a shared secret has no "authenticated but
  forbidden" state. Wrong key is 401.
- **Logging the key, a prefix of the key, or `Authorization` headers.**
- **Treating the key as a user id** or storing it on a memory row.
- **Shipping a second auth scheme beside this one** without a new spec (and
  usually an ADR). OAuth may come back later as a gate in front of REST
  ([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)); it is not
  live now.
