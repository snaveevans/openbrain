# AGENTS.md

Orientation for AI agents working in this repo. Read this first; it points to
everything else.

## What this is

**Open Brain** — a personal memory store. The ops platform is Cloudflare
([ADR-0003](docs/decisions/0003-host-on-cloudflare.md)). REST is the only
domain surface; remote MCP, local MCP, and the CLI are thin clients
([ADR-0004](docs/decisions/0004-rest-as-domain-surface.md)). Storage and
search products are not decided yet. First auth is a shared API key.

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
| `validation-gate` | Rebase, review, risk-score, and open the PR |
| `pr` | Thinner PR open when the gate is overkill |
| `pr-review` | Adversarial review of a branch or PR |
| `pr-respond` | Address review comments and red CI |

Specs own behavior. ADRs own decisions. Implementation mechanism belongs in
neither unless a spec's Observable Contract needs it.

## Current tree

```
docs/                     Layered docs (see docs/README.md)
packages/openbrain-mcp    Existing local MCP client (will be retargeted at REST)
```

Intended packages (not all present yet): REST API, common contracts,
remote MCP Worker, local MCP, CLI.

## Working rules

- One concern per branch. Specs/ADRs can land before the code they unlock.
- Check a spec box only when the behavior is implemented **and** covered by a
  test on `main`.
- Do not invent product policy. If a cross-cutting spec does not exist yet, ask.
- Keep secrets out of git and out of logs. `.env` and `.env.local` are ignored.
- Time estimates from training data are stale. Prefer the correct solution over
  a shortcut unless the user asks for a dirty pass.

## Opening a PR

Use [`.github/pull_request_template.md`](.github/pull_request_template.md).
**Risk is required** (`L` / `M` / `H` / `C`) — it is how the human decides how
long to look. Prefer the `validation-gate` skill after implementation; it
rebases, runs `pr-review`, scores risk, and fills the template. A bare `pr`
still scores risk from the same rubric.

Human validation budget:

| Level | Budget |
| ----- | ------ |
| **L** | Glance evidence. Do not read the diff. |
| **M** | Evidence + escalations; spot-check 1–2 hot files. |
| **H** | Full review + local poke on auth/API/data paths. |
| **C** | Plan must have been human-approved; deep review required. |

Commit and push the feature branch autonomously. Do not merge without an
explicit ask.

## After a feature slice merges

`validation-gate` already checked the spec against the diff. If something
still drifted on `main`, fix it in a follow-up — do not leave a silent gap.
