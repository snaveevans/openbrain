# Integration-test the production Worker path against remote dev bindings

- Status: accepted
- Date: 2026-08-15

## Context and Problem Statement

The REST Worker is covered by a Node-side Vitest suite against `createApp()` with
fake store, embedder, and index (the REST Worker follow-ups, #4–#8). That pins
the HTTP contract, but it never runs the Worker entry, the D1 migrations, Workers
AI `@cf/google/embeddinggemma-300m`, or Vectorize ranking. A bug in the real
embed/rank path — a wrong task prefix, a migration that doesn't apply, a binding
misconfiguration, a Vectorize metadata filter that doesn't narrow as expected —
would ship green.

The integration suite ([#22](https://github.com/snaveevans/openbrain/issues/22))
exists to close that gap: boot the production Worker build locally and exercise
the real embed + rank path. The question this record captures is *what to bind*
for that suite — local mocks, the real remote dev resources, or production — and
the guardrails that make the choice safe.

The binding split (local workerd + local D1 + remote dev Vectorize/AI) was
already specified in [#22](https://github.com/snaveevans/openbrain/issues/22);
this record captures the *why* and the guarantees, not the harness mechanism.

## Decision Drivers

- **Real-path confidence:** the suite must exercise the actual embedder, the
  actual Vectorize index, and the actual migrations — the things the fake suite
  deliberately cannot reach.
- **No faithful local simulation:** Vectorize's behavior (ANN approximation,
  eventual consistency, `source` metadata indexing) and EmbeddingGemma have no
  local equivalent; mocking them hides the failures the suite exists to catch.
- **Production safety:** production `openbrain-memories` and production D1 must
  never be read or written by a test.
- **Hermetic gate preservation:** the default `npm test` / PR CI path must stay
  hermetic, fast, and free; fake-based tests remain the green gate.
- **One-person ops:** reuse the dev resources already created by
  `scripts/ensure-cloudflare.sh` (`openbrain-memories-dev`); no extra test
  infrastructure to maintain.

## Considered Options

- Real remote dev bindings (Vectorize + Workers AI) with local D1
- Local mocks/fakes for Vectorize and Workers AI in the integration suite
- Test against production with an isolated namespace

## Decision Outcome

Chosen option: **Real remote dev bindings (Vectorize + Workers AI) with local D1**,
because the suite's entire purpose is to verify the real embed/rank path, and a
local mock of Vectorize or EmbeddingGemma would re-introduce exactly the
blindness the suite exists to remove. Local D1 is used because it can be wiped
and re-migrated per case, giving document isolation a remote shared index cannot.

Through the `dev` environment the suite binds the **remote
`openbrain-memories-dev`** Vectorize index and **remote Workers AI**
EmbeddingGemma — the same shape as production (768-d cosine, `source` metadata
index; [ADR-0006](0006-embed-with-workers-ai-index-in-vectorize.md)) but a
separate index that production never touches. D1 stays local SQLite, reset and
re-migrated per case.

**Hard guarantees:**

- Production `openbrain-memories` is never read or written. Only
  `openbrain-memories-dev`.
- Production D1 is never touched. Only local SQLite.
- The suite is **not** on the default `npm test` / PR CI path. The fake-based
  suite remains the hermetic green gate; this suite is invoked explicitly.

### Positive Consequences

- The real embed + rank + Vectorize path, the D1 migrations, and the Worker boot
  are exercised end-to-end before they reach production.
- Bugs specific to the vendor path (task-prefix errors, metadata-filter quirks,
  binding misconfiguration, migration drift) become visible.
- Local D1 reset gives cheap per-case isolation for the document store.

### Negative Consequences

- The suite is **non-hermetic**: it depends on remote dev Vectorize and Workers
  AI availability and on a logged-in Wrangler session. It cannot be the green
  gate, which is why it stays off PR CI.
- It **bills** Workers AI and Vectorize per run and is slower than the fake
  suite (real embed round-trips plus Vectorize eventual consistency).
- Vectorize is eventually consistent
  ([ADR-0006](0006-embed-with-workers-ai-index-in-vectorize.md)); search-after-create
  and absent-after-delete must be lag-aware, and lag is a source of test flakiness.
- The remote dev index is **shared** across runs, so the suite must scope its
  own vectors and clean them up.
- Because it is off the hermetic CI gate, regressions in the real path are not
  caught on every PR — the accepted cost of keeping the gate hermetic. Promoting
  the suite to a required CI gate (a separate job with the account secret) was
  considered and **deferred**; it is tracked on
  [#22](https://github.com/snaveevans/openbrain/issues/22) as out of scope for
  this slice.

The harness mechanism — the `createTestHarness({ env: "dev" })` call, local D1
reset and re-migration, the lag-retry budget, the per-run isolation strategy, and
post-case cleanup — lives on
[#22](https://github.com/snaveevans/openbrain/issues/22), not in this record or
in a spec. [ADR-0002](0002-documentation-method.md) keeps test-harness mechanism
out of specs (specs own caller-visible behavior); the issue owns the plan.

## Pros and Cons of the Options

### Real remote dev bindings (Vectorize + Workers AI) with local D1

- ✅ Good, because it verifies the actual embedder, index, and migrations — the
  gap the suite exists to close
- ✅ Good, because `openbrain-memories-dev` already exists and mirrors
  production's shape, with no extra infra to stand up
- ✅ Good, because local D1 reset gives per-case document isolation
- ❌ Bad, because it is non-hermetic, bills, and is subject to Vectorize
  eventual consistency (a flakiness surface)
- ❌ Bad, because a shared remote index requires per-run isolation and cleanup

### Local mocks/fakes for Vectorize and Workers AI in the integration suite

- ✅ Good, because it would be hermetic, free, and fast
- ❌ Bad, because a local Vectorize mock cannot reproduce ANN approximation,
  eventual consistency, or `source` metadata filtering — the very behaviors most
  likely to break in the real path
- ❌ Bad, because it duplicates what the existing fake-based unit suite already
  does at the HTTP layer, adding no new confidence

### Test against production with an isolated namespace

- ✅ Good, because it offers maximal fidelity — the exact index and embedder
  production uses
- ❌ Bad, because it risks production data and vectors even with isolation; a
  test bug or a missed filter could read or pollute `openbrain-memories`
- ❌ Bad, because it couples test runs to production health and availability
