> **Audience:** everyone · **Purpose:** how Open Brain documents itself · **Source of truth:** this file · **Last reviewed:** 2026-08-14

# Documentation

How Open Brain documents itself, and where each kind of knowledge lives. The
guiding rule:

> **Each fact has one home; everything else links to it.** Where a fact can be
> derived from code, the docs are generated from code so they cannot drift.

This keeps documentation trustworthy for both humans and the AI agents that read
this repo.

## The doc types

| Type            | Lives in                 | Source of truth | Primarily serves      |
| --------------- | ------------------------ | --------------- | --------------------- |
| Front door      | `README.md`, `AGENTS.md` | hand-written    | newcomers · AI agents |
| Decisions (ADR) | `docs/decisions/`        | hand-written    | engineers (the _why_) |
| Specs           | `docs/specs/`            | hand-written    | everyone (the _what_) |

### Who reads what

- **MCP client / integrator** → feature specs for tool behavior; later a generated
  contract if we add one.
- **Engineer deciding how to build** → `docs/decisions/` for the _why_.
- **Anyone asking what the product does** → `docs/specs/SPECS.md`.
- **AI agent** → `AGENTS.md` is the hub; everything else is linked from there.

## Conventions

**Every doc starts with a header** so a reader (or model) instantly knows what
it is and whether to trust it:

```markdown
> **Audience:** operators · **Purpose:** how to run locally ·
> **Source of truth:** this file · **Last reviewed:** 2026-08-14
```

For generated docs, "Source of truth" names the code; for hand-written docs it
says `this file`. Update **Last reviewed** when you touch a hand-written doc.

**Indexes are maintained by hand.** `docs/decisions/README.md` keeps the ADR
index; `docs/specs/SPECS.md` keeps the spec index; the root `README.md` keeps
the doc map. When you add a doc, add the link.

**Prose over cleverness.** Short sentences, concrete examples, real values.
Assume the reader is competent but new to _this_ project.

**Future work lives in the issue tracker, not the repo.** The codebase reflects
the product's _current state_ and the _decisions_ behind it (ADRs). Planned,
proposed, or deferred work is tracked as **GitHub issues**, not as in-repo TODO
lists. Specs describe intended behavior for work that is being specified or
built; they are not a backlog dump. This extends the one-home-per-fact method of
[ADR-0002](decisions/0002-documentation-method.md).

## Adding a new doc

1. Put it under the right type directory above.
2. Add the header block.
3. Link it from the root `README.md` doc map (and `AGENTS.md` if agents need it).
4. If it documents a significant, hard-to-reverse choice, write an ADR instead
   of (or alongside) the doc — see [`docs/decisions/README.md`](decisions/README.md).
5. If it documents product behavior, write a spec — see [`docs/specs/SPECS.md`](specs/SPECS.md).
