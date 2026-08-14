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
npx wrangler dev
```

## Deploy

```bash
npx wrangler deploy
echo "$API_KEY" | npx wrangler secret put API_KEY
```

`API_KEY` is a Worker secret, not a committed var. After changing
`wrangler.jsonc`, run `npm run cf-typegen` if you want local runtime types
(`worker-configuration.d.ts` is generated and gitignored).

D1 (`openbrain`) and Vectorize (`openbrain-memories`) are created by
`scripts/ensure-cloudflare.sh`. That script is idempotent and is what deploy CI
runs before `wrangler deploy`.

## License

[MIT](../../LICENSE). Point clients at an instance you run. There is no
public Open Brain API.
