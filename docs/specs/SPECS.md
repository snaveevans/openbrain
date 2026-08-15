> **Audience:** everyone · **Purpose:** authoritative map of all feature and cross-cutting specs · **Source of truth:** this file · **Last reviewed:** 2026-08-14

# Spec Index

The spec system captures product behavior and intent — what a feature is
supposed to do and why — so the objective record survives as code changes over
time. Feature and cross-cutting specs are the source of truth for product
behavior. Specs are not transport contracts and not decisions about _how_ we
built something (those live in `docs/decisions/`). They answer: **what should
this do, for whom, and under what conditions?**

See `templates/` for blank starting points.

## Cross-Cutting Specs

Concerns that apply to every feature. When writing a feature spec, reference the
relevant cross-cutting specs rather than re-describing the behavior.

| Spec | Concern | Status |
| ---- | ------- | ------ |
| [memory-model](cross-cutting/memory-model.md) | Canonical memory document and agent text format | `review` |
| [authentication](cross-cutting/authentication.md) | Shared `API_KEY` via `x-api-key` on every request | `review` |

Authorization, validation, errors, and observability are still unnamed as
cross-cutting specs. [ADR-0004](../decisions/0004-rest-as-domain-surface.md)
makes REST the domain surface; OAuth, if added later, is a gate in front of
that API.

## Feature Specs

| Spec | Area | Status |
| ---- | ---- | ------ |
| [rest-api](features/rest-api.md) | HTTP domain surface | `active` |
| [hosted-mcp](features/hosted-mcp.md) | Thin remote MCP client (Cloudflare) | `review` |
| [local-mcp](features/local-mcp.md) | Thin stdio MCP client | `review` |
| [cli](features/cli.md) | Thin CLI client | `review` |
| [search-memories](features/search-memories.md) | Semantic search | `in-progress` |
| [fetch-memory](features/fetch-memory.md) | Point lookup | `in-progress` |
| [create-memory](features/create-memory.md) | Create + embed | `active` |
| [delete-memory](features/delete-memory.md) | Hard delete | `active` |

Operation specs describe REST behavior. Client specs only map to those
routes. Boxes stay unchecked until a rewrite slice is implemented and tested
on `main`.

v1 (API + CLI) is epic [#11](https://github.com/snaveevans/openbrain/issues/11).
MCP clients are phase 2 ([#10](https://github.com/snaveevans/openbrain/issues/10)).

## Directory Structure

```
docs/specs/
  SPECS.md                        ← this file
  templates/
    feature-spec.template.md      ← blank feature spec
    cross-cutting.template.md     ← blank cross-cutting spec
  cross-cutting/
    [concern].md
  features/
    [feature-name].md
```

## Workflow

**Starting a new feature:** copy `templates/feature-spec.template.md` into
`features/`, fill it out before writing code, then link it here. Prefer the
`spec-author` skill in `.agents/skills/spec-author/`.

**After a PR merges:** the spec should already match — `validation-gate`
checks the diff against the spec before the PR opens. If something still
drifted, fix it in a follow-up.

**Implementing a ready spec:** use the `spec-implement` skill. One slice per PR.
Open the PR with `validation-gate` so Risk and Evidence are filled.

## Spec lifecycle & acceptance criteria

A spec's **`status`** tracks its lifecycle: `draft` (being written) → `wip`
(incomplete, not yet ready to implement) → `review` (complete, ready to
implement, no slice shipped yet) → `in-progress` (at least one slice shipped but
boxes remain) → `active` (fully implemented and live on `main` — no `[ ]`
remain); `deprecated` when retired. A single-slice feature can go straight from
`review` to `active`; `in-progress` is the natural state of a multi-slice spec
mid-delivery.

The **acceptance-criteria checkboxes are the live implementation checklist.** A
box is checked (`- [x]`) **only when its behavior is implemented and covered by
a test on `main`** — not when code is merely written. Each box carries exactly
one **slice tag** (`` `S1` ``…) tying it to the spec's Delivery Plan. The spec
advances to `active` once every box is checked.

**Large specs are implemented in slices, planned in the spec itself.** Every
feature spec carries a **Delivery Plan** — a table of the slices it ships in
(`| Slice | Scope | Issue | Depends on |`), each slice an independently
reviewable increment normally tracked as a GitHub issue. Each acceptance
criterion carries **exactly one slice tag** (`` `S1` ``…) matching the plan. A
slice is **done** when its tagged boxes are all `[x]` with tests; its PR checks
off **only** its own boxes and includes that spec edit.

A feature that fits one PR uses a one-line plan ("Single slice — the whole
feature (`S1`)") and tags every box `S1`.

## Agent loop

The prose skills in `.agents/skills/` are the local loop for this repo:

1. **Decide** — `adr-author` / `adr-review` when the choice is architectural.
2. **Specify** — `spec-author` writes observable criteria into a feature spec.
3. **Test-plan** — `test-author` hunts spec gaps, records corner cases, and
   posts the prioritized plan on the GitHub issue.
4. **Implement** — `spec-implement` builds one slice from the spec **and**
   that issue plan, and checks off only that slice's boxes.
5. **Test-review** — `test-review` checks the tests against the spec and the
   plan before `validation-gate` opens the PR.

Keep architecture in ADRs and behavior in specs. Do not let implementation
mechanism leak into either unless the spec's Observable Contract needs it.
