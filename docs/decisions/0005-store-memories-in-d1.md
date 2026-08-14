# Store memory documents in D1

- Status: accepted
- Date: 2026-08-14

## Context and Problem Statement

Open Brain is hosted on Cloudflare
([ADR-0003](0003-host-on-cloudflare.md)). That record left storage open.
The domain surface is REST
([ADR-0004](0004-rest-as-domain-surface.md)); create, fetch, and delete
need a durable home for the memory document
([memory-model](../specs/cross-cutting/memory-model.md)).

The recovered store was Postgres: one row per memory, `jsonb` metadata,
lookup and delete by UUID, an optional exact `source` filter. Leaving
Supabase means that row has to live somewhere else. The rewrite is
single-tenant and one-person-operated. Search ranking and the embedding
vendor are a sibling decision, not this one.

## Decision Drivers

- Stay on the existing Cloudflare account — a second paid backend must
  earn its keep
- Point lookup and delete by UUID must be cheap and immediately
  consistent
- An exact `source` filter, and “no embedding → still fetchable,” must
  not require a full scan of the store
- One-person ops: one dashboard, backups/restore, no extra runtime just
  to hold rows
- Do not introduce a Durable Object for storage
  ([ADR-0004](0004-rest-as-domain-surface.md) kept remote MCP stateless
  and deferred DOs until something actually needs one)
- Do not choose the embedding or vector product here

## Considered Options

- Cloudflare D1
- Workers KV
- R2
- One SQLite Durable Object
- Vectorize as the only store
- External Postgres (Hyperdrive, Neon, or back to Supabase)

## Decision Outcome

Chosen option: **Cloudflare D1**, because the memory is a relational
row, D1 is already on the account we operate, and it does not invent a
Durable Object or a second vendor.

D1 is the system of record for the memory document: identity, content,
source, metadata, timestamps, and embed *metadata* (`embedding_model`,
`embedded_at`) when an embedding exists. Where the vector itself lives
is left to the embeddings and search decision.

### Positive Consequences

- Create, fetch, and delete have an on-platform home that matches the
  recovered table shape
- Time Travel gives a restore story without a second backup product
- The common-package store port can be a SQL-shaped adapter without
  pulling Postgres back in
- Search can still hang vectors off these rows, or in another product,
  without this record having to say which

### Negative Consequences

- D1 is not Postgres. SQL dialect, types, and operational habits from
  the old store will not transfer cleanly — the same Cloudflare-shaped
  cost [ADR-0003](0003-host-on-cloudflare.md) already accepted
- A D1 row is capped at 2 MB. That becomes a content/metadata ceiling
  the old `text` / `jsonb` columns did not have
- Vectors are not in this database. Create-and-embed and search will
  talk to a second product once that ADR lands
- Vendor concentration deepens: site, compute, and now rows fail
  together

---

## Pros and Cons of the Options

### Cloudflare D1

- ✅ Good, because a memory is a row with filters (`id`, `source`,
  “has an embedding”), not a blob or a cache entry
- ✅ Good, because it stays inside the Cloudflare account and Workers
  Paid plan we already run
- ✅ Good, because it does not require a Durable Object
- ❌ Bad, because it is SQLite-shaped, not Postgres-shaped
- ❌ Bad, because the 2 MB row limit is now a product constraint

### Workers KV

- ✅ Good, because get-by-id is the native operation and the API is
  tiny
- ❌ Bad, because an exact `source` filter and “list rows without
  embeddings” want an index, not a key scan
- ❌ Bad, because KV is eventually consistent — a create followed by a
  fetch can miss

### R2

- ✅ Good, because objects are durable and cheap at any size this
  product will reach
- ❌ Bad, because a memory is a queryable document, not a blob. Fetch
  by id works; `source` and “has embedding” do not

### One SQLite Durable Object

- ✅ Good, because it is also SQLite, colocated with compute, and
  strongly consistent
- ❌ Bad, because it adds a Worker-plus-object pair for a store that is
  not collaborative, realtime, or per-session
- ❌ Bad, because [ADR-0004](0004-rest-as-domain-surface.md) already
  declined Durable Objects until a later decision needs them

### Vectorize as the only store

- ✅ Good, because search would not have to join two products
- ❌ Bad, because un-embedded memories must still fetch and delete, and
  Vectorize is a ranking index, not a document store
- ❌ Bad, because it couples the row store to the still-open embeddings
  decision

### External Postgres (Hyperdrive, Neon, or back to Supabase)

- ✅ Good, because the recovered schema and `jsonb` habits would
  transfer
- ❌ Bad, because it is the second backend
  [ADR-0003](0003-host-on-cloudflare.md) already rejected
- ❌ Bad, because one-person ops would again split dashboards, secrets,
  and bills
