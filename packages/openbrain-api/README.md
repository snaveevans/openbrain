# @snaveevans/openbrain-api

Cloudflare Worker that serves the Open Brain REST API
([ADR-0004](../../docs/decisions/0004-rest-as-domain-surface.md)).

Public origin: `https://openbrain.tylerevans.co`  
Versioned root `{api}`: `https://openbrain.tylerevans.co/v1`

## Local

```bash
cp .dev.vars.example .dev.vars
# edit API_KEY
npx wrangler d1 migrations apply openbrain --local
npm run dev
```

`npm run dev` is `wrangler dev -e dev`. D1 stays on the local SQLite
simulation. Vectorize is the remote `openbrain-memories-dev` index (same
768-d cosine shape as production, including a `source` metadata index).
Workers AI is remote — there is no local model. Bare `wrangler dev` (no
`-e dev`) still binds `openbrain-memories`; do not use it.

`env.dev` sets `workers_dev: false` and empty `routes` so an accidental
`wrangler deploy -e dev` cannot take over `openbrain.tylerevans.co`.
Production deploy is `wrangler deploy` with no environment and writes to
`openbrain-memories`.

## Testing

```bash
npm test                        # fake-based unit suite (the CI gate)
npm run type-check              # tsc --noEmit across workspaces
npm run test:integration        # real-bindings suite (NOT in CI; see below)
```

`npm test` runs the Node-side Vitest suite against `createApp()` with fake
store / embedder / index. It pins the HTTP contract but never runs the
Worker entry, D1 migrations, Workers AI, or Vectorize — so it stays hermetic
and fast on CI.

`npm run test:integration` boots the **real** production Worker under
`workerd` (via `wrangler`'s `createTestHarness`) against the `dev`
environment: local D1, the remote `openbrain-memories-dev` Vectorize index,
and remote Workers AI EmbeddingGemma. It is intentionally **excluded from
`npm test`** so the CI gate never needs Cloudflare credentials; a guard test
(`test/suite-isolation.test.ts`) keeps that separation enforced.

To run the integration suite:

```bash
# 1. Cloudflare account credentials (remote dev bindings) in the env
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...

# 2. A Worker API_KEY the harness can authenticate with
cp .dev.vars.example .dev.vars   # then edit API_KEY

# 3. Run it
npm run test:integration
```

Without `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` the suite **fails
hard before starting the server** with a clear message rather than a string
of cryptic 5xx failures. Each case wipes + re-migrates local D1 and deletes
the vectors it created from the remote dev index; a final case verifies no
vectors are left behind. See
[ADR-0007](../../docs/decisions/0007-integration-test-against-remote-dev-bindings.md)
for why this suite exists and the invariants it holds.

## Deploy

```bash
npx wrangler deploy --env=""
echo "$API_KEY" | npx wrangler secret put API_KEY
```

`API_KEY` is a Worker secret, not a committed var. After changing
`wrangler.jsonc`, run `npm run cf-typegen` if you want local runtime types
(`worker-configuration.d.ts` is generated and gitignored).

D1 (`openbrain`) and both Vectorize indexes (`openbrain-memories`,
`openbrain-memories-dev`) are created by `scripts/ensure-cloudflare.sh`.
That script is idempotent and is what deploy CI runs before
`wrangler deploy`.

## License

[MIT](../../LICENSE). Point clients at an instance you run. There is no
public Open Brain API.
