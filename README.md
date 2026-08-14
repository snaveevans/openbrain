# Open Brain Monorepo

Personal memory store exposed to agents over MCP.

> **New here? Pick your door.** This README is the human overview. If you're an
> AI agent, start with [`AGENTS.md`](AGENTS.md). For everything else, see the
> [documentation map](#documentation) below.

Open Brain is hosted on Cloudflare ([ADR-0003](docs/decisions/0003-host-on-cloudflare.md)).
Identity, storage, and search are still open follow-up decisions.

## Packages

- `packages/openbrain-mcp` - npm MCP server package published as `@snaveevans/openbrain-mcp`

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
