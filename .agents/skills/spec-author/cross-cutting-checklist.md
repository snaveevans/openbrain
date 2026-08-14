# Cross-cutting checklist

Work through each concern. Prefer project cross-cutting specs under `docs/specs/cross-cutting/` when they exist; otherwise ask the user. Do not invent product policy.

---

## Authentication

See `docs/specs/cross-cutting/authentication.md`. First release is a shared
`API_KEY` via `x-api-key`, not OAuth.

- Is this feature reachable unauthenticated? If yes, document that explicitly.
- Confirm the feature does not treat the API key as a subject / owner id.
- How does a client handle 401 vs a 500 from a missing server `API_KEY`?

## Authorization

- Who may perform each action?
- Is access operator-only, client-allowlisted, or open to any authenticated subject?
- On denial: 403 vs 404 (existence leaking)?

## Validation

- Required vs optional fields; formats; ranges (query length, limit, UUID)
- Where validation runs (MCP/HTTP edge vs domain) — follow repo convention
- Field-level errors that a client can act on?

## Error handling

- Which failure modes are user-visible vs internal?
- Stable error codes/messages if the MCP or HTTP surface has that contract
- Partial failure / retries? Embedding failure vs storage failure?

## Loading & empty states

- Initial load, refresh, mutation in-flight (auth UI especially)
- Empty collections vs not-found (`search` with zero matches vs unknown `fetch` id)
- Optimistic UI or not?

## Observability

- Operation names / metrics / traces for new tools or endpoints
- Audit trail requirements
- PII constraints — never log raw tokens, service keys, or memory contents unless a spec explicitly allows it

## Compatibility & migration

- Breaking MCP tool, OAuth, or data changes?
- Backfill / dual-write needs during the Cloudflare rewrite?
