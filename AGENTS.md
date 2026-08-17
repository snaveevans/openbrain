# AGENTS.md

Orientation for AI agents working in this repo. Read this first; it points to
everything else.

## What this is

**Open Brain** — a personal memory store. The ops platform is Cloudflare
([ADR-0003](docs/decisions/0003-host-on-cloudflare.md)). REST is the only
domain surface; remote MCP, local MCP, and the CLI are thin clients
([ADR-0004](docs/decisions/0004-rest-as-domain-surface.md)). Memory documents
live in D1 ([ADR-0005](docs/decisions/0005-store-memories-in-d1.md)). Embeddings
are Workers AI; vectors live in Vectorize
([ADR-0006](docs/decisions/0006-embed-with-workers-ai-index-in-vectorize.md)).
First auth is a shared API key. The
source is [MIT](LICENSE); the product is a single-tenant store you self-host,
not a public API.

Do not implement the rewrite until the relevant ADRs and feature specs exist.

## Where to look

- **Why** anything is built a certain way → [`docs/decisions/`](docs/decisions/) (ADRs, MADR format)
- **What a feature is supposed to do** → [`docs/specs/`](docs/specs/) (intent ledger; index at `docs/specs/SPECS.md`)
- **How we document** → [`docs/README.md`](docs/README.md)

## Prose skills

Project skills live in [`.agents/skills/`](.agents/skills/). Load the matching
skill before doing the work:

| Skill             | Use when                                                        |
| ----------------- | --------------------------------------------------------------- |
| `adr-author`      | Recording, capturing, or superseding a hard-to-reverse decision |
| `adr-review`      | Reviewing an ADR without editing it                             |
| `spec-author`     | Drafting, documenting, or revising a feature spec               |
| `test-author`     | Blind test plan, spec corner cases, issue-comment the plan      |
| `spec-implement`  | Implementing one slice from the spec and the issue test plan    |
| `test-review`     | Verdict: do the tests pin the spec and the issue plan?          |
| `validation-gate` | Rebase, review, risk-score, and open the PR                     |
| `pr`              | Thinner PR open when the gate is overkill                       |
| `pr-review`       | Adversarial review of a branch or PR                            |
| `pr-respond`      | Address review comments and red CI                              |

Specs own behavior. ADRs own decisions. Implementation mechanism belongs in
neither unless a spec's Observable Contract needs it.

## Current tree

```
docs/                       Layered docs (see docs/README.md)
packages/openbrain-common   Shared REST types and ports (not a runtime)
packages/openbrain-api      REST Worker (health, auth, create)
```

Intended packages (not all present yet): local MCP, remote MCP Worker, CLI.

## Working rules

- One concern per branch. Specs/ADRs can land before the code they unlock.
- Check a spec box only when the behavior is implemented **and** covered by a
  test on `main`.
- Do not invent product policy. If a cross-cutting spec does not exist yet, ask.
- Keep secrets out of git and out of logs. `.env` and `.env.local` are ignored.
- PRs must stay green on `npm run format:check`, `lint`, `type-check`, `build`,
  and `test` ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Merges to
  `main` also run `scripts/ensure-cloudflare.sh` and deploy the Worker.
- Time estimates from training data are stale. Prefer the correct solution over
  a shortcut unless the user asks for a dirty pass.

## External dependencies & testing

This system depends on paid, eventually-consistent Cloudflare services
(Workers AI, Vectorize, D1). The rules below apply to any code, test, or
script that touches them — and generalize to anything that depends on an
external service whose behavior you do not fully control.

- **Diagnose and measure before you tune.** When behavior is wrong or slow,
  write the smallest probe that pins _which layer_ is responsible before
  changing thresholds. Set every timeout, retry count, poll interval, and
  capacity limit from a measurement of the real thing — not an estimate — and
  record the measurement in a comment at the constant so the next reader can
  tell a measured value from a guess.
- **Fail loud, early, and actionable.** Gate every precondition (credentials,
  config, bindings, schema) up front with a message that names what is missing
  and how to fix it. One clear throw beats a cascade of cryptic downstream
  errors.
- **The CI gate is hermetic; live-cloud work is opt-in and guarded.** `npm
test` (the PR gate) must never need credentials or hit a paid external
  service. Anything that does runs through a separate command and is
  structurally prevented from joining the gate (e.g. an assertion that the two
  scripts stay separate).
- **Assert the invariant, not the timing, for eventually-consistent systems.**
  Poll until the observable condition holds and assert that it _eventually_
  does. On cap-hit, **fail** with a "did it ever happen?" probe — never silently
  pass, and never assert "within N ms" unless N is measured.
- **Pin the real external identity; fakes cannot catch vendor swaps.**
  Integration tests assert against the actual external identity (model id, index
  name, API version, binding target) _independently_ of the source constants, so
  a swap to a compatible-but-wrong dependency still fails. Unit tests with fakes
  cannot, by construction.
- **Namespace shared external state per-run and prove teardown.** Anything that
  mutates shared external state (a remote index, shared DB, bucket) writes under
  a per-run prefix and verifies cleanup; leftovers are a failure, not a warning.
- **Make context-sensitive config structurally un-misusable.** If a config is
  safe in only one context (dev bindings, a test env), prevent its use in the
  wrong context by construction — not by hoping humans remember a flag.
- **Read the installed API surface before coding against it.** Before
  integrating a library — especially fast-moving ones (wrangler, vitest, Hono)
  — read the version-specific types/docs actually installed, and fix
  deprecations from the migration guide, not from memory or copied old configs.
- **Treat paid external calls as a first-class cost concern.** Any test, script,
  or job that calls a paid external API declares its cost footprint and stays
  opt-in; poll/retry counts multiply cost. For billing decisions, ground every
  claim in the official source, flag where it is silent, and do not rely on
  alerts as a safety net — only a hard spend cap (prepaid credits / capped
  gateway) actually limits cost.

## Opening a PR

Use [`.github/pull_request_template.md`](.github/pull_request_template.md).
**Risk is required** (`L` / `M` / `H` / `C`) — it is how the human decides how
long to look. Prefer the `validation-gate` skill after implementation; it
rebases, runs `pr-review`, scores risk, and fills the template. A bare `pr`
still scores risk from the same rubric.

Human validation budget:

| Level | Budget                                                    |
| ----- | --------------------------------------------------------- |
| **L** | Glance evidence. Do not read the diff.                    |
| **M** | Evidence + escalations; spot-check 1–2 hot files.         |
| **H** | Full review + local poke on auth/API/data paths.          |
| **C** | Plan must have been human-approved; deep review required. |

Commit and push the feature branch autonomously. Do not merge without an
explicit ask.

## After a feature slice merges

`validation-gate` already checked the spec against the diff. If something
still drifted on `main`, fix it in a follow-up — do not leave a silent gap.
