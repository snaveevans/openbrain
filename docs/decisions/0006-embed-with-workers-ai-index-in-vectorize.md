# Embed with Workers AI and index in Vectorize

- Status: accepted
- Date: 2026-08-14

## Context and Problem Statement

Create must embed `content` before it returns 201, and search must embed
the query and rank stored memories by meaning
([create-memory](../specs/features/create-memory.md),
[search-memories](../specs/features/search-memories.md)). Documents now
live in D1 ([ADR-0005](0005-store-memories-in-d1.md)). That record
explicitly left the vector itself and the embedding vendor open.

The recovered store did both jobs in one place: OpenAI
`text-embedding-3-small` (1536 dimensions, overrideable) wrote a
`pgvector` column on the memory row, and `match_memories` ranked with
`1 - cosine distance`. D1 has no vector type and no `sqlite-vec`. The
host is Cloudflare ([ADR-0003](0003-host-on-cloudflare.md)); a second
paid backend must still earn its keep. Similarity stays a query-time
number in `[0, 1]`
([memory-model](../specs/cross-cutting/memory-model.md)). Keyword search
is out.

Workers AI hosts more than one embedder. The index choice and the
model choice are one decision because Vectorize dimensions are fixed
at create time: picking a model picks the index shape.

## Decision Drivers

- Stay on the existing Cloudflare account — a second paid AI or vector
  vendor must earn its keep
- Create fails closed if embed fails; search fails closed if the query
  cannot be embedded
- Rank by meaning, not keyword; an exact `source` filter must still
  narrow the eligible set
- Un-embedded memories stay fetchable and never appear in search
- Quality on a personal store: English notes, occasional other
  languages, notes longer than a tweet
- One-person ops: no extra dashboard just to embed or rank
- Do not put the memory document in the index
  ([ADR-0005](0005-store-memories-in-d1.md) already rejected Vectorize
  as the only store)
- Do not change the HTTP contract (`threshold`, `limit` 1–25 default
  10, `source`)

## Considered Options

- Workers AI `@cf/google/embeddinggemma-300m` + Vectorize
- Workers AI `@cf/baai/bge-base-en-v1.5` + Vectorize
- Workers AI `@cf/baai/bge-m3` + Vectorize
- Keep OpenAI `text-embedding-3-small` + Vectorize
- Workers AI + vectors in D1
- Pinecone / Qdrant / another hosted vector DB
- External Postgres + `pgvector` (Hyperdrive, Neon, or back to
  Supabase)

## Decision Outcome

Chosen option: **Workers AI `@cf/google/embeddinggemma-300m` to embed,
and Cloudflare Vectorize to index those vectors**, because both already
sit on the account that hosts the Worker, the model is the strongest
on-platform embedder that still fits a 768-dimension index, and
Vectorize stays an index rather than a document store.

Workers AI is the only embedder for create and for search queries.
Create embeds the memory as a *document*; search embeds the query as a
*query*. That split is required by this model — omitting the task
prefixes degrades ranking. Vectorize holds the dense vector and enough
sidecar to filter (`source`) and join back to the D1 row (`id`). The
memory document does not live in the index. Cosine is the index metric
so a hit score is already in `[-1, 1]` and maps onto the spec’s
`[0, 1]` similarity without inventing a new scale.

The REST Worker talks to an embedder *port*, not to Workers AI by
name. That is for tests and for a future swap being an adapter, not a
rewrite of create and search. It is not a license to point the port at
another model at runtime.

A vector is only comparable to other vectors from the **same model,
same task prefixes, same dimensionality**. Same width is not the same
space: a 768-d Gemma query against a 768-d BGE document is noise.
Vectorize also freezes dimensions when the index is created. Changing
the model is therefore a new ADR, a new index, and a re-embed of every
row — never an env flip that writes new vectors next to old ones.

### Positive Consequences

- Create and search stay inside one Cloudflare account — no
  `EMBEDDING_API_KEY`, no second vector bill
- The recovered split (document vs ranking index) is restored without
  bringing Postgres back
- `source` can be an indexed metadata filter on the query, so search
  does not have to over-fetch and drop locally
- Fetch and delete stay D1 operations; delete also drops the Vectorize
  id. Search hydrates hits from D1
- 768 dimensions match the older BGE-base pairing, so the index is
  the size Cloudflare already documents, with a newer multilingual
  model and a 2048-token window (4× `bge-base`)
- An embedder port keeps create/search and tests off the vendor SDK.
  Switching later is a new adapter plus a re-embed, not a rewrite and
  not a config flip — which is the right amount of friction

### Negative Consequences

- Two writes on create, two deletes on delete. Vectorize is
  eventually consistent (typically a few seconds). A 201 does not
  guarantee the new memory is searchable on the next request
- Approximate scores are the Vectorize default. High-precision scoring
  costs latency. Callers must not treat `similarity` as a lab-grade
  cosine
- This model needs distinct query vs document prefixes. Workers AI’s
  binding only takes `text`, so the prefixes are our job. Getting them
  wrong is a silent quality bug, not a 500
- 2048 tokens is better than BGE-base’s 512 and worse than `bge-m3`’s
  8192. Very long notes still need a truncate-or-reject rule at
  implement time
- Vendor concentration deepens: site, compute, rows, embeddings, and
  the index fail together
- There is no in-database dump of the vectors comparable to the old
  `pgvector` column. Time Travel restores D1, not the index

---

## Pros and Cons of the Options

### Workers AI `@cf/google/embeddinggemma-300m` + Vectorize

- ✅ Good, because embed and rank stay on the paid Cloudflare plan
  already running the Worker — the capability
  [ADR-0003](0003-host-on-cloudflare.md) named as a driver, now chosen
  on its own merits
- ✅ Good, because 768 dimensions fit Vectorize (cap 1536) and match
  the index size of the older documented pairing
- ✅ Good, because it is multilingual (100+ languages), 2048-token,
  and at release the highest-ranking text-only multilingual embedder
  under 500M on MTEB — better than picking Cloudflare’s tutorial
  default
- ✅ Good, because Vectorize `id` is meant to point at a document
  elsewhere — here, the D1 row
- ❌ Bad, because query/document prefixes are mandatory for retrieval
  quality and are not applied by the Workers AI API
- ❌ Bad, because the index is eventually consistent and is a second
  product next to D1

### Workers AI `@cf/baai/bge-base-en-v1.5` + Vectorize

- ✅ Good, because it is the pairing Cloudflare’s Vectorize tutorial
  uses, so examples copy cleanly
- ✅ Good, because 768 dimensions and a small English model are cheap
  and enough for short English notes
- ❌ Bad, because it is English-first and 512 tokens — a 2023 default,
  not the best model Workers AI now hosts
- ❌ Bad, because the only reason to prefer it over EmbeddingGemma is
  familiarity of the docs, which is not a driver

### Workers AI `@cf/baai/bge-m3` + Vectorize

- ✅ Good, because 1024 dimensions and an 8192-token window handle
  long notes, and the model is multilingual
- ✅ Good, because dense + sparse + multi-vector in one model is
  attractive if we ever add hybrid search
- ❌ Bad, because Vectorize only stores a dense vector — the sparse
  and ColBERT heads are unused cost
- ❌ Bad, because 1024 dimensions is a larger, more expensive index
  for a personal store whose `limit` is already 25
- ❌ Bad, because token price is higher than the 768-dim models and
  the extra window is unused until notes regularly exceed 2k tokens

### Keep OpenAI `text-embedding-3-small` + Vectorize

- ✅ Good, because it is the recovered embedder; existing notes (if
  any are ever imported) would not need a new model
- ✅ Good, because 1536 dimensions sit on the Vectorize cap and the
  quality is a known quantity
- ❌ Bad, because it reintroduces `EMBEDDING_API_KEY` and a second
  vendor after [ADR-0003](0003-host-on-cloudflare.md) rejected a
  second backend that adds no capability
- ❌ Bad, because create and search fail when OpenAI is down even if
  Cloudflare is up

### Workers AI + vectors in D1

- ✅ Good, because create is one write and search cannot drift from
  the row
- ❌ Bad, because D1 has no vector type and no `sqlite-vec`. Ranking
  would be a Worker-side scan of every embedding — fine for tens of
  rows, a product lie at thousands
- ❌ Bad, because it spends the D1 row budget on floats the document
  does not need, after [ADR-0005](0005-store-memories-in-d1.md)
  already accepted a 2 MB ceiling

### Pinecone / Qdrant / another hosted vector DB

- ✅ Good, because a dedicated vector product is immediately
  consistent on some hosts and has richer hybrid search
- ❌ Bad, because it is a third dashboard, a third secret, and a
  third bill for a one-person store
- ❌ Bad, because Vectorize already covers nearest-neighbor plus a
  `source` filter at this scale (one tenant, `limit` ≤ 25)

### External Postgres + `pgvector`

- ✅ Good, because the recovered column, IVFFlat index, and
  `match_memories` SQL would transfer
- ❌ Bad, because [ADR-0003](0003-host-on-cloudflare.md) and
  [ADR-0005](0005-store-memories-in-d1.md) already rejected a second
  backend for the row; hanging search off that same rejected store
  does not make it cheaper
