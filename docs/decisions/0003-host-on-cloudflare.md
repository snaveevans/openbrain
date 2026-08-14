# Host Open Brain on Cloudflare

- Status: accepted
- Date: 2026-08-14

## Context and Problem Statement

Open Brain's hosted path currently runs on Supabase (Postgres, Auth, Edge
Functions) while the public site and the auth frontend already live on
Cloudflare. That split means two vendors, two dashboards, and two operational
stories for a one-person project — without a second platform buying anything the
first one does not already cover.

The rewrite needs a single ops home. The question is whether to stay on
Supabase, consolidate onto Cloudflare, or introduce a third host.

## Decision Drivers

- Familiarity — the operator already knows Cloudflare's products and workflow
- Existing spend — a Workers Paid plan is already on the card and carries higher
  limits than the free tier
- Existing footprint — the website and auth frontend are already on Cloudflare
- One-vendor ops — a second paid backend must earn its keep; dual-homing that
  adds no capability is a cost
- Platform fit — hosted MCP is a request/response edge workload
- On-platform AI and retrieval — Workers AI and Vectorize exist if later
  decisions want them, without adding another vendor

## Considered Options

- Stay on Supabase
- Host Open Brain on Cloudflare
- Move to another host (Fly, Railway, a VPS, …)

## Decision Outcome

Chosen option: **Host Open Brain on Cloudflare**, because the project is already
there and staying on Supabase does not add value. Familiarity, an existing paid
plan, and a single operational surface outweigh keeping a second backend.

This record does **not** choose storage, identity, or search products. Those are
follow-up decisions. Cloudflare being attractive because Vectorize and Workers
AI exist is a driver, not a commitment to use them.

### Positive Consequences

- DNS, TLS, edge compute, and later storage can live in one account
- Incremental MCP traffic rides a plan that is already paid for
- Later AI and retrieval choices can stay on-platform if they win on their own
  merits
- The auth frontend does not have to move in order for the backend to follow

### Negative Consequences

- Leaving Supabase means identity, relational data, and vectors must be
  re-decided; nothing in this ADR settles those
- Cloudflare primitives are their own shape: Workers are not quite Node, D1 is
  not quite SQLite, and so on. Code and mental models from the Node/Postgres
  world will not transfer cleanly
- Vendor concentration: site, compute, and (if later ADRs agree) data fail
  together
- Platform limits (CPU time, request size, storage semantics) become product
  constraints

---

## Pros and Cons of the Options

### Stay on Supabase

- ✅ Good, because the current backend already works (Postgres, `pgvector`, Auth,
  Edge Functions)
- ✅ Good, because relational data and SQL stay familiar
- ❌ Bad, because it keeps a second vendor next to an account we already operate
  and pay for
- ❌ Bad, because it does not add a capability Cloudflare is not already covering
  for this project

### Host Open Brain on Cloudflare

- ✅ Good, because the operator is already fluent there
- ✅ Good, because the paid plan and the public site are already in that account
- ✅ Good, because one dashboard and one secrets story fit a one-person project
- ✅ Good, because on-platform AI and vector search remain available without a
  third vendor
- ❌ Bad, because the runtime and data primitives are Cloudflare-shaped, not
  Node-and-Postgres-shaped
- ❌ Bad, because leaving Supabase throws identity and storage back open

### Move to another host

- ✅ Good, because a VPS or app host can run unmodified Node and a real Postgres
- ❌ Bad, because it introduces a third place to operate while two already exist
- ❌ Bad, because it spends familiarity and existing spend for no problem this
  project actually has
