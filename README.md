# Open Brain Monorepo

Personal memory store exposed to agents over MCP. This repo currently contains
the Supabase backend, the npm MCP package, and the thin auth frontend.

> **New here? Pick your door.** This README is the human overview. If you're an
> AI agent, start with [`AGENTS.md`](AGENTS.md). For everything else, see the
> [documentation map](#documentation) below.

## Packages

- `packages/openbrain-mcp` - npm MCP server package published as `@snaveevans/openbrain-mcp`
- `packages/openbrain-auth` - Cloudflare Pages auth frontend for the remote MCP OAuth flow

## Cloudflare Pages Auth Build

`packages/openbrain-auth` expects these build environment variables:

- `OPENBRAIN_AUTH_SUPABASE_URL`
- `OPENBRAIN_AUTH_SUPABASE_PUBLISHABLE_KEY`

Supabase Auth should also allowlist `https://auth.txe.app/login` for magic-link redirects and route the OAuth authorization UI to `https://auth.txe.app/oauth/consent`.

For local auth UI testing, `openbrain-auth` also supports `npm run dev --workspace openbrain-auth` on `http://127.0.0.1:3000`.
It will auto-read `packages/openbrain-auth/.env.local` if present.

## Documentation

Docs are organized by **what you need**, not by who you are:

| You want to…                              | Read                                         |
| ----------------------------------------- | -------------------------------------------- |
| Understand what the product does          | [`docs/specs/SPECS.md`](docs/specs/SPECS.md) |
| Understand _why_ something is built a way | [`docs/decisions/`](docs/decisions/) (ADRs)  |
| Understand how we document                | [`docs/README.md`](docs/README.md)           |
| Orient an AI agent                        | [`AGENTS.md`](AGENTS.md)                     |

## Build

```bash
npm install
npm run build
```
