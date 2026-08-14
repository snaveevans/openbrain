# V1 Implementation Plan

This plan follows `ROADMAP.md` and assumes V1 ends at secure hosted read access, not write support.

## Implementation assumptions

- `ROADMAP.md` is the source of truth for scope and build order.
- V1 ships on `Supabase Edge Functions`, not a standalone custom server.
- `Supabase Auth` is the V1 identity provider.
- `search` and `fetch` are required V1 tools.
- `recent_memories` ships only if it helps real clients.
- `save_memory` and all other write access are post-V1 behind a separate authz model.

## Current baseline

- `public.memories` exists in Supabase with `RLS` enabled.
- `pgvector` is installed and the SQL search helpers are present.
- no `RLS` policies are defined yet, so the Edge Function boundary still needs to be formalized
- No Edge Functions are deployed yet.
- No remote MCP transport exists yet.
- No `Supabase Auth` client configuration or token verification is wired to a live project yet.

## Workstreams

1. hosted MCP transport on `Supabase Edge Functions`
2. `Supabase Auth` and token/client enforcement
3. read tools and Supabase integration
4. observability, guardrails, and operator docs
5. client validation with `ChatGPT` and `Claude`

## Milestones

### Milestone 1 - Deployment baseline

Deliverables:

- confirm the V1 tool set: `search`, `fetch`, and ship-or-defer `recent_memories`
- document required env vars and secret handling
- define local dev and deploy steps for `Supabase Edge Functions`
- choose the MCP transport shape that works cleanly in the Edge runtime

Exit criteria:

- a developer can run the function locally
- a placeholder function can be deployed to Supabase
- the hosted endpoint is reachable over HTTPS

### Milestone 2 - Remote MCP skeleton

Deliverables:

- create `supabase/functions/mcp/index.ts`
- expose MCP manifest and request dispatch
- add a small data access layer that uses the service role key
- return stable responses for success, bad input, unsupported tool, and internal error

Exit criteria:

- MCP inspector or equivalent can reach the endpoint
- the dispatcher handles requests consistently in local and hosted environments

### Milestone 3 - OAuth and security

Deliverables:

- configure `Supabase Auth` `OAuth 2.1` with `PKCE`
- create a dedicated MCP OAuth client and capture its `client_id`
- switch the project to asymmetric JWT signing so `JWKS` verification works remotely
- publish the required auth discovery metadata
- verify bearer tokens in the Edge Function using `JWKS`
- optionally allowlist approved MCP `client_id` values in the Edge Function
- optionally allowlist one operator user id/email and require `aal2`
- verify the database access model so clients cannot bypass the MCP layer directly
- standardize `401` and `403` responses

Exit criteria:

- browser auth flow completes successfully
- valid access tokens from the MCP OAuth client are accepted
- missing, expired, invalid, or wrong-client tokens fail cleanly

### Milestone 4 - `search` end to end

Deliverables:

- implement `search(query, limit?, threshold?, source?)`
- generate query embeddings at runtime
- call `public.match_memories(...)`
- format matches for agent use
- clamp limits and thresholds to safe defaults

Exit criteria:

- seeded test queries return relevant ranked results
- empty matches return a clean zero-results response
- embedding or Supabase failures are diagnosable

### Milestone 5 - `fetch` and optional helper tool

Deliverables:

- implement `fetch(id)` for one memory by UUID
- return canonical fields for the requested memory
- add not-found and invalid-id handling
- ship `recent_memories(limit?)` only if client testing shows it is useful

Exit criteria:

- valid ids return exactly one memory
- unknown ids return a clean not-found result
- malformed ids fail validation before querying storage

### Milestone 6 - Observability and guardrails

Deliverables:

- log request id, subject, tool, status, and latency
- classify auth, validation, embedding, Supabase, and unknown failures
- add practical request caps and defensive input bounds
- document deploy, rollback, and common failure checks

Exit criteria:

- successful and failed requests are traceable in logs
- logs do not contain secrets or raw bearer tokens
- operators can distinguish auth failures from search failures quickly

### Milestone 7 - Real client validation

Deliverables:

- connect the production endpoint to `ChatGPT`
- connect the production endpoint to `Claude`
- verify both clients can authenticate and use the required read tools
- document any client-specific setup differences

Exit criteria:

- `ChatGPT` completes auth and runs `search`
- `Claude` completes auth and runs `search`
- at least one real-client `fetch` call succeeds

### Milestone 8 - Release hardening

Deliverables:

- finalize env and setup docs
- write release notes and known limitations
- capture rollback steps
- freeze post-V1 items into a separate backlog

Exit criteria:

- a new operator can deploy from docs
- the release checklist passes
- V1 scope remains read-first

## Non-goals for V1

- `save_memory` or any other write/delete tool
- Slack ingestion or other capture pipelines
- dashboards or admin UI
- bulk migration workflows
- direct client access to Supabase for search or fetch
- standalone custom MCP hosting unless the roadmap fallback criteria are triggered

## Release checklist

- `supabase/functions/mcp/index.ts` is deployed and reachable
- MCP manifest and request flow work from an inspector-compatible client
- `Supabase Auth` discovery metadata is published and correct
- `JWKS` token verification works in the Edge Function
- the dedicated MCP OAuth client is the only client allowed for shipped tools
- `search` works end to end against live Supabase data
- `fetch` works end to end against live Supabase data
- `recent_memories` is either validated or explicitly deferred
- logs capture request id, subject, tool, status, and latency
- logs exclude secrets and raw tokens
- `ChatGPT` connects and successfully calls `search`
- `Claude` connects and successfully calls `search`
- operator docs cover local run, deploy, auth setup, validation, and rollback

## Post-V1 backlog

- `save_memory` behind a separate post-V1 authorization model
- write audit logging
- server-side write validation
- broader rate limiting
- additional capture surfaces
- standalone MCP fallback only if the hosted path proves limiting
