# Open Brain Monorepo

Personal memory store exposed to agents over MCP.

> **New here? Pick your door.** This README is the human overview. If you're an
> AI agent, start with [`AGENTS.md`](AGENTS.md). For everything else, see the
> [documentation map](#documentation) below.

Open Brain is hosted on Cloudflare
([ADR-0003](docs/decisions/0003-host-on-cloudflare.md)). REST is the domain
surface; MCP and the CLI are thin clients
([ADR-0004](docs/decisions/0004-rest-as-domain-surface.md)). Memory documents
live in D1 ([ADR-0005](docs/decisions/0005-store-memories-in-d1.md)). Embeddings
are Workers AI; vectors live in Vectorize
([ADR-0006](docs/decisions/0006-embed-with-workers-ai-index-in-vectorize.md)).

## Packages

- `packages/openbrain-common` — shared REST types and ports (not a runtime)
- `packages/openbrain-api` — REST Worker at `https://openbrain.tylerevans.co`
- `packages/openbrain-mcp` — local stdio MCP client (to be retargeted at REST)

## Documentation

Docs are organized by **what you need**, not by who you are:

| You want to…                              | Read                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Understand what the product does          | [`docs/specs/SPECS.md`](docs/specs/SPECS.md)                                           |
| Understand _why_ something is built a way | [`docs/decisions/`](docs/decisions/) (ADRs)                                            |
| Understand how we document                | [`docs/README.md`](docs/README.md)                                                     |
| Orient an AI agent                        | [`AGENTS.md`](AGENTS.md)                                                               |
| Open or review a PR                       | [`.github/pull_request_template.md`](.github/pull_request_template.md) (Risk required) |

## Build

```bash
npm install
npm run format:check
npm run lint
npm run type-check
npm run build
npm test
```

PRs run those same gates in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
Merges to `main` also run [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):
`scripts/ensure-cloudflare.sh` creates the D1 database and Vectorize index if they
are missing, then deploys the Worker. Needs repo secrets
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

## License

[MIT](LICENSE). The source is open; run your own instance. This repo is not a
hosted multi-tenant service, and there is no public API to share.
