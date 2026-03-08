# MCP Architecture

## Goal

Run one hosted remote MCP endpoint on `Supabase Edge Functions` while `Supabase` remains the system of record for memory storage, semantic search, and OAuth/OIDC identity.

## V1 components

1. `Supabase`
   - stores memory rows and embeddings in `pgvector`
   - exposes SQL functions for semantic search and recent history
   - keeps `public.memories` behind `RLS`

2. `Supabase Edge Function`
   - exposes the remote MCP manifest and request handling over HTTPS
   - validates tool inputs and formats agent-friendly responses
   - generates embeddings for search queries
   - calls Supabase with the service role key
   - logs request id, subject, tool, status, and latency

3. `Supabase Auth`
   - provides `OAuth 2.1` with `PKCE`
   - publishes discovery metadata and `JWKS`
   - issues bearer tokens for a dedicated MCP client
   - can optionally use dynamic client registration for MCP-compatible clients

4. `MCP clients`
   - `ChatGPT`
   - `Claude`
   - MCP inspector and other compatible clients used for verification

## Hosted endpoint shape

The first release optimizes for one public hosted endpoint instead of a separate standalone server.

- entrypoint target: `supabase/functions/mcp/index.ts`
- transport: whatever MCP shape works cleanly in `Supabase Edge Functions`
- first priority: stable remote read access for real clients
- fallback only if needed: move the public MCP layer to a custom server while keeping Supabase and tool contracts the same

## Read path

### `search`

1. Client calls `search` with a query string.
2. The Edge Function verifies the bearer token and optionally enforces an allowed `client_id` list.
3. The Edge Function generates an embedding for the query.
4. The Edge Function calls `public.match_memories(...)` in Supabase.
5. Supabase returns matching memories plus similarity scores.
6. The Edge Function formats the result for agent use.

### `fetch`

1. Client calls `fetch` with a memory id.
2. The Edge Function verifies the bearer token and optionally enforces an allowed `client_id` list.
3. The Edge Function loads the memory from Supabase.
4. The Edge Function returns one explicit result or a clean not-found error.

### `recent_memories` helper

1. Client calls `recent_memories(limit)` if that helper is worth exposing.
2. The Edge Function verifies the bearer token and optionally enforces an allowed `client_id` list.
3. The Edge Function calls `public.recent_memories(limit)`.
4. Supabase returns the newest rows ordered by `created_at`.

## Security model

- keep `RLS` enabled on `public.memories`
- do not add anonymous public policies for V1
- keep the `SUPABASE_SERVICE_ROLE_KEY` only inside the Edge Function
- use `Supabase Auth`, not a shared static secret
- verify bearer tokens in the Edge Function using `JWKS`
- optionally allowlist approved OAuth `client_id` values for read access
- optionally allowlist your own user id or email in both the token hook and the Edge Function
- require `aal2` for operator-only access if you want MFA-backed sessions only
- keep secrets out of logs and out of git

## Minimal V1 tool contract

### `search`

Input:

- `query: string`
- `limit?: number`
- `threshold?: number`
- `source?: string`

Return:

- matching memories with similarity scores
- pagination and limit behavior that is stable for agents

### `fetch`

Input:

- `id: string`

Return:

- one memory with its text, source, metadata, and timestamps

### `recent_memories`

Input:

- `limit?: number`

Return:

- newest memories with `created_at` and embedding status

`recent_memories` is optional for V1 if real clients do not benefit from it.

## Deferred until after V1

### `save_memory`

Controlled write access comes after the hosted read path is working.

- use a separate post-V1 authorization model instead of custom OAuth scopes
- validate text length, source, and metadata size server-side
- keep insert-first, embed-second behavior
- add write audit logging before exposing it broadly

## Deployment on the current path

### Now

- `Supabase` project for storage and search
- `Supabase Edge Functions` for the public MCP endpoint
- `Supabase Auth` for login and token issuance
- MCP inspector plus `ChatGPT` and `Claude` for client validation

### Later

- controlled write access
- stronger rate limiting and request caps
- operational runbook and deeper observability
- custom standalone MCP layer only if `Edge Functions` prove too limiting

## Git boundary

Keep these in git:

- SQL migrations
- Edge Function code
- auth and deployment docs
- prompt templates and helper scripts

Keep these out of git:

- service role keys
- OAuth secrets and tenant-specific config
- real notes
- embeddings dumps
- database backups containing personal data
