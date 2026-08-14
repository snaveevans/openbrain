# Layer checklist (adapt to the repo)

Read `AGENTS.md` and architecture ADRs first. Use **this repo's** paths and layer names. Skip layers the slice does not touch and say why.

The sections below are a **generic inward-architecture prompt**. Rename folders to match the project as the Cloudflare rewrite lands.

---

## Shared / kernel

- [ ] Shared types, errors, Result helpers only if the repo has a shared package
- [ ] No upward imports into application/UI

## Domain / core

- [ ] Entities/value objects for new invariants (memory identity, query bounds)
- [ ] Domain events only if the project uses them
- [ ] Unit tests for pure domain rules
- [ ] Domain does not import infrastructure, Workers, or HTTP frameworks

## Application / use cases

- [ ] Use-case or service orchestration (`search`, `fetch`, auth exchange)
- [ ] Ports/interfaces for persistence and external IO when the repo uses that pattern
- [ ] Tests with fakes/mocks at the port boundary

## Infrastructure

- [ ] Persistence adapters, embeddings, queues, auth providers as needed
- [ ] Migrations if schema changes (use the project's migration tool)
- [ ] Config from the project's approved source (Worker bindings, `.dev.vars`) — never invent secrets

## API / MCP / interface adapters

- [ ] Request validation at the edge
- [ ] Route/handler or MCP tool wiring
- [ ] Map domain/app errors to transport errors consistently with existing helpers
- [ ] Update generated contracts **only if** the repo already generates them

## Composition root

- [ ] Wire dependencies in the single place the project already uses (Worker entry, package bin)
- [ ] No new global singletons unless that is the existing pattern

## Frontend / clients (if in slice)

- [ ] Follow existing auth-frontend or MCP-client patterns
- [ ] Loading / empty / error states
- [ ] Auth failure handling consistent with the app shell

## Verification (every layer chunk)

- [ ] Lint / typecheck commands from `package.json` (or language equivalent)
- [ ] Targeted tests for changed behavior **and** the issue plan's P0 / minimum confidence set
- [ ] Existing acceptance tests still green (without weakening them)
