# AGENTS.md

Orientation for AI agents working in this repo. Read this first; it points to
everything else.

## What this is

**Open Brain** — a personal memory store exposed to agents over MCP. The ops
platform is Cloudflare ([ADR-0003](docs/decisions/0003-host-on-cloudflare.md)).
Identity, storage, and search are not decided yet.

Do not implement the rewrite until the relevant ADRs and feature specs exist.

## Where to look

- **Why** anything is built a certain way → [`docs/decisions/`](docs/decisions/) (ADRs, MADR format)
- **What a feature is supposed to do** → [`docs/specs/`](docs/specs/) (intent ledger; index at `docs/specs/SPECS.md`)
- **How we document** → [`docs/README.md`](docs/README.md)

## Prose skills

Project skills live in [`.agents/skills/`](.agents/skills/). Load the matching
skill before doing the work:

| Skill | Use when |
| ----- | -------- |
| `adr-author` | Recording, capturing, or superseding a hard-to-reverse decision |
| `adr-review` | Reviewing an ADR without editing it |
| `spec-author` | Drafting, documenting, or revising a feature spec |
| `spec-implement` | Implementing one delivery-plan slice from a ready spec |

Specs own behavior. ADRs own decisions. Implementation mechanism belongs in
neither unless a spec's Observable Contract needs it.

## Current tree

```
docs/                     Layered docs (see docs/README.md)
packages/openbrain-mcp    Local/stdio MCP client package
```

## Working rules

- One concern per branch. Specs/ADRs can land before the code they unlock.
- Check a spec box only when the behavior is implemented **and** covered by a
  test on `main`.
- Do not invent product policy. If a cross-cutting spec does not exist yet, ask.
- Keep secrets out of git and out of logs. `.env` and `.env.local` are ignored.
- Time estimates from training data are stale. Prefer the correct solution over
  a shortcut unless the user asks for a dirty pass.

## After a feature slice merges

Update the matching spec if observable behavior changed.
