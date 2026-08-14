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
| _(none yet — add authentication, authorization, validation, errors, and observability as the rewrite specifies them)_ | | |

## Feature Specs

| Spec | Area | Status |
| ---- | ---- | ------ |
| _(none yet — author these before implementing Cloudflare rewrite slices)_ | | |

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

**After a PR merges:** update the matching spec if observable behavior changed.

**Implementing a ready spec:** use the `spec-implement` skill. One slice per PR.

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
3. **Implement** — `spec-implement` builds one slice and checks off only that
   slice's boxes.

Keep architecture in ADRs and behavior in specs. Do not let implementation
mechanism leak into either unless the spec's Observable Contract needs it.
