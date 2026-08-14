# REST as the domain surface

- Status: accepted
- Date: 2026-08-14

## Context and Problem Statement

Open Brain is being rebuilt on Cloudflare ([ADR-0003](0003-host-on-cloudflare.md)).
The pre-rewrite tree had two domain surfaces that drifted: an API-key HTTP
API for writes and local MCP, and a separate OAuth-gated hosted MCP for
`search` / `fetch`. A CLI was never specified.

The rewrite needs one place where memory behavior is defined, and a way to
add more front-ends without forking that behavior. A later step may add
OAuth so hosted agents (ChatGPT, Grok, and similar) can connect without a
shared secret. That step must not force a second store or a second
create/search/fetch/delete contract.

## Decision Drivers

- One observable contract for create, fetch, search, and delete
- Several front-ends (remote MCP, local MCP, CLI) without duplicated domain
  logic
- Remote MCP stays a stateless HTTPS request/response (no Durable Objects
  unless a later decision adopts stateful sessions)
- First auth is a shared API key
  ([authentication](../specs/cross-cutting/authentication.md)); OAuth must
  remain addable as a *gate*, not as a new API
- Shared TypeScript types so clients and the server cannot silently diverge
- Small one-person surface area: no extra runtime just to share types

## Considered Options

- **REST as the only domain surface; MCP and CLI are thin clients**
- **MCP as the domain surface; HTTP and CLI wrap MCP**
- **Each front-end talks to storage itself**, sharing only a memory model

## Decision Outcome

Chosen option: **REST is the only domain surface.** Remote MCP, local MCP,
and the CLI are thin clients of that API. A **common package** holds the
shared request/response types and the internal ports/interfaces the server
implements. Clients do not embed, store, or authorize on their own.

Remote MCP is a Cloudflare Worker that speaks MCP over stateless streamable
HTTP and calls REST (same “thin” rule as local MCP). It does not keep a
session in a Durable Object.

OAuth is **out of this decision**. When it arrives, it authenticates
callers *in front of the same REST API* (and any thin client that must
present a token). It does not become a parallel resource model, and it
does not require designing the first REST routes around an authorization
server.

### Positive Consequences

- Search, fetch, create, and delete are specified and tested once, on HTTP
- A new front-end is a new client, not a new backend
- OAuth can later sit in front of REST without rewriting the memory
  operations
- Local MCP, remote MCP, and the CLI can share the common request/response
  types

### Negative Consequences

- Thin remote MCP is an extra hop (or a service binding) compared to
  in-process tools
- HTTP must grow anything a client needs (including `fetch` and search
  `threshold`); clients must not invent fields the API lacks
- The common package is a shared dependency: a contract change ripples to
  every client in one PR, which is the point and also the coupling

---

## Pros and Cons of the Options

### REST as the only domain surface

- ✅ Good, because one contract can serve agents, a CLI, and a future OAuth
  client
- ✅ Good, because it matches the existing local MCP (already an HTTP
  client)
- ✅ Good, because OAuth later wraps HTTP instead of replacing it
- ❌ Bad, because remote MCP is no longer the place domain rules live

### MCP as the domain surface

- ✅ Good, because hosted agents already speak MCP
- ❌ Bad, because a CLI and ordinary HTTP tools become MCP clients
- ❌ Bad, because OAuth-for-ChatGPT and API-key-for-the-operator still
  split how the same tools are reached

### Each front-end talks to storage

- ✅ Good, because there is no extra hop
- ❌ Bad, because every new front-end reimplements auth, validation, and
  errors
- ❌ Bad, because the recovered tree already drifted this way
