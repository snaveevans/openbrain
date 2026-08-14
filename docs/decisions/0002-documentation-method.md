# Documentation method

- Status: accepted
- Date: 2026-08-14

## Context and Problem Statement

Open Brain had architecture notes and implementation checklists, but no durable
split between _why_ a choice was made, _what_ the product should do, and _how_
to operate it. The Cloudflare rewrite will create more of each kind of knowledge
at once. If those facts are mixed together — or copied into several files — the
docs will drift as soon as the first slice ships.

The documentation needs to serve operators, MCP-client integrators, and AI
agents from one in-repo system, without requiring a generated API site on day
one.

## Decision Drivers

- Documentation must not drift from the code — stale docs are worse than none
- One fact should have exactly one home; everything else links to it
- Must serve operators, implementers, and LLMs from a single entry point
- Low maintenance burden for a one-person project that is about to change platforms
- Product behavior and architecture decisions must stay separable

## Considered Options

- **Layered in-repo docs** — two typed homes organized by purpose
  (`decisions/` for _why_, `specs/` for _what_), fronted by `README.md`
  (humans) and `AGENTS.md` (agents)
- **Hand-written Markdown with no typed split** — keep adding notes under `docs/`
- **External docs site / wiki**

## Decision Outcome

Chosen option: **Layered in-repo docs**, because it defends the one-home-per-fact
rule without inventing a docs platform. Specs own intended behavior. ADRs own
hard-to-reverse choices. Operator runbooks and product roadmaps stay out of
`docs/` until they earn a typed home; until then they are issues or live next
to the code they describe.

Generated contracts can be added later if a public HTTP/OpenAPI surface appears.
Until then, MCP tool behavior lives in feature specs, not in a parallel API doc.

The method itself is documented in [`docs/README.md`](../README.md).

### Positive Consequences

- Agents and humans have one map for where to read and where to write
- Specs can be checked off as slices ship without rewriting architecture notes
- Future work can live in issues instead of rotting inside implementation plans

### Negative Consequences

- Hand-written docs still require discipline; the per-doc "Last reviewed" header
  is the only drift guard until generated contracts exist
- There is no in-repo home for operator runbooks or a product roadmap until those
  surfaces earn their own typed directory

---

## Pros and Cons of the Options

### Layered in-repo docs

- ✅ Good, because each fact has a typed home and a discoverable index
- ✅ Good, because it matches the spec/ADR skills we already use elsewhere
- ✅ Good, because everything stays in version control, reviewed alongside code
- ❌ Bad, because indexes and headers are manual

### Untyped Markdown notes

- ✅ Good, because there is no ceremony
- ❌ Bad, because plans, architecture, and leftover tasks collapse into one pile
- ❌ Bad, because agents cannot tell which file is authoritative

### External docs site

- ✅ Good, because it can look polished for public readers
- ❌ Bad, because it splits the source of truth away from the repo
- ❌ Bad, because the project does not yet have a public docs audience that
  justifies the extra system
