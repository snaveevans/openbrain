# OAuth gate in front of hosted MCP

- Status: accepted
- Date: 2026-08-17

## Context and Problem Statement

Phase 2 ([#10](https://github.com/snaveevans/openbrain/issues/10)) puts Open
Brain inside the chat clients the operator uses daily. Research into the target
clients (Claude, ChatGPT, Grok, ChatMCP) found **no viable shared-secret path**:
none of the chat products let a connector send a custom `x-api-key` header, and
Claude/ChatGPT/Grok all require OAuth. The hosted-mcp spec as written
(`x-api-key` passthrough, bearer not accepted, no OAuth discovery served)
describes a Worker these clients cannot use.

At the same time, the existing REST/CLI authentication (shared `API_KEY` per the
authentication cross-cutting spec) is correct for the operator's own tooling and
must not change. [ADR-0004](0004-rest-as-domain-surface.md) anticipated exactly
this: OAuth would arrive as **a gate in front of** the same REST routes, not a
replacement for them.

The question is where the OAuth layer lives — and how much state it forces into
what has so far been a stateless system.

## Decision Drivers

- **Client reality is fixed.** Claude/ChatGPT/Grok require OAuth; ChatGPT
  additionally requires discovery metadata served at the _domain root_; Grok's
  connector form implies pre-registered, static client ids where ChatGPT expects
  to register itself dynamically. BYOK clients (ChatMCP) may have no interactive
  browser at all and need a non-interactive token.
- **Single tenant by design.** One operator, no user model, no consent UX beyond
  "prove you hold the API key." Whatever we build should be the _easiest
  possible_ OAuth that satisfies the clients — resist anything more.
- **The REST auth boundary stays clean.** The authentication cross-cutting spec
  says everything except health requires `x-api-key`. Bolting unauthenticated
  OAuth endpoints onto the REST Worker would erode that boundary exception by
  exception (per AGENTS.md: make context-sensitive boundaries structurally
  un-misusable, not a matter of remembering).
- **One-person ops; least new state.** The system has no server-side session
  today. OAuth does force state (authorization codes, refresh tokens, client
  registrations are not free to fabricate), so the decision is where the
  smallest sufficient amount of state lives.
- **The MCP hot path stays cheap.** Every tool call should validate its
  credential without a storage round-trip; token-lifecycle I/O belongs only on
  the (rare) issuance and refresh paths.

## Considered Options

- Keep `x-api-key` passthrough on the MCP Worker (status quo of the hosted-mcp
  spec)
- Add the OAuth authorization server and gate to the existing REST Worker
- Stand up a dedicated MCP Worker on its own hostname that acts as both the MCP
  endpoint and a minimal authorization server, holding token-lifecycle state in
  Workers KV
- Delegate authentication to an external identity provider (Cloudflare Access,
  Auth0, WorkOS, …)

## Decision Outcome

Chosen option: **a dedicated MCP Worker on its own hostname, acting as both MCP
endpoint and minimal OAuth authorization server, with token-lifecycle state in
Workers KV.**

The Worker owns its domain root, so ChatGPT's domain-root discovery requirement
is satisfied by construction rather than by carving unauthenticated exceptions
into the REST Worker. The REST Worker, the authentication cross-cutting spec,
and the CLI keep working exactly as before. The gate Worker is a privileged thin
client of REST ([ADR-0004](0004-rest-as-domain-surface.md)): it validates OAuth
tokens it minted itself and calls REST with the `API_KEY` it holds as a secret.
Possession of that key — proven interactively at the authorization page, or
used out-of-band to mint a long-lived token — is the single bridge into the
system; an OAuth client that cannot produce the key gets nothing.

State is bounded deliberately: access tokens are self-contained and validated
locally (stateless; nothing on the MCP hot path but a signature check), while
the irreducible state — one-time authorization codes, refresh tokens, dynamic
client registrations, non-interactive BYOK tokens — lives in one KV namespace.
Durable Objects are overkill for a single tenant and D1 is the wrong tool for
short-lived keyed records.

Self-contained access tokens over opaque stored ones are a consequence worth
naming: revoking an individual access token is not possible before expiry, so
access-token lifetime must stay short and rotation lives in the refresh path.

### Positive Consequences

- Target clients can connect through their native OAuth connector forms; BYOK
  clients use a minted bearer token — no custom headers anywhere.
- ChatGPT's discovery documents are served at the domain root with zero routing
  special cases; the REST Worker gains no new unauthenticated surface.
- Stateless MCP transport is preserved: the "no server-side session" property of
  the system survives OAuth, bounded to the token lifecycle.
- Local MCP (stdio) is confirmed descoped — all four targets are remote — so no
  second transport design competes with this one.
- Unlocks the oauth cross-cutting spec and the hosted-mcp revision
  ([#10](https://github.com/snaveevans/openbrain/issues/10)); mechanisms —
  endpoint shapes, grant types, token TTLs, KV layout, registration forms —
  live there, not here.

### Negative Consequences

- A second Worker deployment and hostname to own, and a first KV binding; the
  ops surface grows by exactly one Worker.
- An additional secret class (access-token signing material, static client
  registrations) must be provisioned and rotated alongside `API_KEY`.
- KV is eventually consistent: a freshly registered client or minted token may
  be briefly invisible on another edge. Acceptable for one tenant, but it is a
  real (if small) correctness shrug we did not have before.
- Access tokens are revocable only en masse (rotate signing material, flush
  KV). Single-tenancy makes that sledgehammer affordable; it would not scale.
- OAuth failure modes are now ours to debug (PKCE mismatches, redirect
  allowlist drift, refresh replay) — more moving parts than a header compare.

---

## Pros and Cons of the Options

### Keep `x-api-key` passthrough (status quo)

- ✅ Good, because it is already specified and matches the REST auth contract
  exactly.
- ❌ Bad, because Claude, ChatGPT, and Grok cannot send custom headers — the
  connector forms offer OAuth or nothing, so this option serves zero of the
  four target clients. It fails the issue's reason to exist.

### Co-locate the OAuth server on the REST Worker

- ✅ Good, because it avoids a second Worker, hostname, and deploy.
- ❌ Bad, because the REST Worker must then serve unauthenticated OAuth and
  discovery endpoints beneath an auth middleware that currently admits only
  health — the clean gate in the authentication spec erodes into a list of
  exceptions that every future REST change must remember to step around.
- ❌ Bad, because authorization-server code lands inside the domain API
  package, blurring the thin-client/domain-surface separation
  ([ADR-0004](0004-rest-as-domain-surface.md)) the MCP Worker exists to
  preserve.

### Dedicated MCP Worker + minimal AS + KV (chosen)

- ✅ Good, because the domain-root discovery requirement is satisfied
  structurally — the MCP Worker is the origin for its own hostname, so
  well-known documents live at its root with no routing exceptions.
- ✅ Good, because REST, the CLI, and the authentication cross-cutting spec are
  untouched; the change is additive in front of a stable boundary.
- ✅ Good, because KV is the smallest Cloudflare primitive that answers codes,
  refresh tokens, client registrations, and minted tokens, keeping MCP request
  handling stateless.
- ❌ Bad, because it adds a Worker, a hostname, a KV namespace, and a new
  secret class to operate (see Negative Consequences).

### External identity provider (Cloudflare Access, Auth0, WorkOS, …)

- ✅ Good, because OAuth edge cases (PKCE, token rotation, client registration)
  become someone else's problem.
- ❌ Bad, because it introduces an external dependency, a second console, and
  per-tenant identity configuration to serve exactly one human — the opposite
  of "easiest possible" for a single tenant, and a hard-to-walk-back coupling
  to a vendor's MCP-OAuth quirks.
- ❌ Bad, because the API key already exists as the root credential; an IdP
  adds an identity layer without adding an identity.
