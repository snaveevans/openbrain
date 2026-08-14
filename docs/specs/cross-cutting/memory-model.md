---
audience: all contributors
purpose: canonical memory document every feature reads and writes
source: this file
date: 2026-08-14
---

# Memory Model — Cross-Cutting Spec

**Status:** `review`
**Owner:** tyler
**Applies To:** All memory features unless listed in Exceptions

---

## Summary

Open Brain is a **single-tenant personal memory store**. Every feature that
creates, searches, fetches, or deletes a memory uses the same document. This
spec is the recovered contract from the pre-Cloudflare implementation
(`3d52b8e`). Documents live in D1
([ADR-0005](../../decisions/0005-store-memories-in-d1.md)). The embedding
and search product is not decided here.

## Canonical Behavior

A **memory** is one durable record:

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `id` | yes | Stable UUID assigned at create time |
| `content` | yes | Non-empty text after trim. This is what is embedded and what agents read. |
| `source` | yes | Origin label. Default `"manual"` when the caller omits it. |
| `metadata` | yes | JSON object (not an array, not `null`). Default `{}`. |
| `created_at` | yes | Creation timestamp |
| `updated_at` | yes | Last-write timestamp |
| `embedding_model` | no | Model used to embed `content`, when an embedding exists |
| `embedded_at` | no | When the current embedding was written |
| `similarity` | search only | Query-time score in `[0, 1]`. Not stored. Higher is closer. |

Invariants recovered from the old store:

- `content` cannot be empty or whitespace-only.
- The store is **not partitioned by subject**. Any authorized caller sees the
  same memories. Authorization decides *whether* you may use the store, not
  *which rows* you see.
- Semantic search only considers memories that have an embedding. A memory
  without one is still fetchable and deletable.
- `similarity` is computed at query time (historically `1 - cosine distance`).
  Callers must not assume a particular embedding vendor.

Text rendering used by MCP tools (hosted and local) is a stable agent-facing
format, not an internal dump:

```
id: <uuid>
source: <source>
created_at: <timestamp>
updated_at: <timestamp>
embedded_at: <timestamp>          # omitted when absent
embedding_model: <model>          # omitted when absent
similarity: <0.0000>              # search hits only, four decimal places
metadata: <json>

<content>
```

Ranked lists number hits from `1` and separate them with a line containing only
`---`.

## Feature Integration Contract

Every memory feature spec MUST document:

- Which fields it accepts as input and which it returns
- Whether it requires an embedding to exist
- How it treats `source` and `metadata`
- Empty vs not-found vs validation failure (do not collapse these)

## Exceptions

| Feature | Deviation | Reason |
| ------- | --------- | ------ |
| MCP `search_memories` (and HTTP search hits) | Includes `similarity`; may omit `embedded_at` | Ranked hit, not a full record |
| MCP `fetch` / HTTP fetch | Returns `embedded_at`; no `similarity` | Point lookup |

## Anti-Patterns

- **Per-user memory rows without a new ADR:** the recovered contract is a
  personal store. Multi-tenant isolation would be a new decision.
- **Searching un-embedded memories:** they are invisible to search by design.
- **Treating `similarity` as stored state:** it is a query artifact.
