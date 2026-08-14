# V1 Finish Tasks

These are the parts I could not complete from inside the repo because they require your local toolchain and your live Supabase project.

## Task 1 - Install the local toolchain and run the project

Overall objective: make the new Edge Function code runnable and testable on your machine.

Note:

- the deployed runtime is `Supabase Edge Functions`, so this code does not run as a plain Node server
- `Supabase CLI` is the core requirement for local serve/deploy
- standalone `Deno` is optional but recommended for running the included Deno tests

Steps:

1. Install the `Supabase CLI` and confirm `supabase --version` works.
2. Optionally install `Deno` if you want to run the included Deno tests directly.
3. From the repo root, create a real `.env` file from `.env.example` and fill in the secrets you already have.
4. Run `supabase start` to boot the local stack.
5. Run `supabase functions serve mcp --no-verify-jwt`.
6. Open `http://localhost:54321/functions/v1/mcp/health` and confirm the readiness payload appears.
7. If `Deno` is installed, run `deno test --config supabase/functions/deno.json --allow-env --allow-net supabase/functions/tests/mcp-test.ts`.
8. If `Deno` is not installed, at minimum do a manual smoke test against `/health` and the unauthenticated MCP endpoint.

Done when:

- local Supabase starts cleanly
- the `mcp` function serves locally
- the Deno test file passes, or equivalent smoke testing succeeds

## Task 2 - Apply the new database migration

Overall objective: add `fetch_memory` and tighten direct public database access so the MCP layer is the intended entrypoint.

Steps:

1. Review `supabase/migrations/20260308001000_add_fetch_memory_and_lock_down_read_rpcs.sql`.
2. Make sure the revocations are acceptable for your current usage.
3. Run your normal migration flow locally first.
4. Verify `public.fetch_memory(uuid)` exists after migration.
5. Verify `anon` and `authenticated` no longer have execute access to the read RPCs.
6. Verify `service_role` still has the permissions the Edge Function needs.
7. Apply the migration to the hosted Supabase project.

Done when:

- `fetch_memory` exists in Supabase
- public read RPC execution is locked down
- the service role can still execute the read path successfully

## Task 3 - Configure Supabase Auth for MCP

Overall objective: issue real bearer tokens from `Supabase Auth` that the MCP function can validate and optionally restrict to one MCP client.

Steps:

1. Enable `Supabase Auth` OAuth for the project and create a dedicated MCP client.
2. Switch JWT signing to `RS256` or `ES256` so third-party `JWKS` verification works.
3. Enable `Authorization Code + PKCE` for the MCP client.
4. Disable self-service signup unless you explicitly need it.
5. Decide whether to enable Dynamic Client Registration or keep a fixed MCP client; for one-user access, keep a fixed client.
6. Capture the MCP client id for `OAUTH_ALLOWED_CLIENT_IDS`.
7. Capture your own Supabase user id and/or email for `OAUTH_ALLOWED_SUBJECTS` or `OAUTH_ALLOWED_EMAILS`.
8. Decide whether to require MFA-backed sessions with `OAUTH_REQUIRE_AAL2=true`.
9. Confirm the issuer is `https://<project-ref>.supabase.co/auth/v1`.
10. Confirm OIDC discovery and JWKS are reachable from the project.
11. Update your `.env` values so they match the project.

Done when:

- you can obtain a real access token from `Supabase Auth`
- the project uses asymmetric JWT signing
- the issuer, `client_id`, and your own user identity values in `.env` match the project

## Task 4 - Set secrets and deploy the Edge Function

Overall objective: make the hosted MCP endpoint live on Supabase with your real secrets.

Steps:

1. Use `supabase link --project-ref <your-project-ref>` if the repo is not linked yet.
2. Set function secrets from your completed `.env` file.
3. Confirm `supabase/config.toml` still marks `functions.mcp.verify_jwt = false`.
4. Deploy the function with `supabase functions deploy mcp --no-verify-jwt`.
5. Hit `https://<project-ref>.supabase.co/functions/v1/mcp/health` and verify the response.
6. Hit the protected endpoint without a bearer token and confirm you get `401` plus a `WWW-Authenticate` challenge.
7. Hit `/.well-known/oauth-protected-resource` on the function and confirm it returns metadata.
8. Verify the function rejects tokens from unapproved OAuth clients if `OAUTH_ALLOWED_CLIENT_IDS` is set.
9. Verify the function rejects tokens from unapproved users or non-`aal2` sessions if those checks are enabled.

Done when:

- the deployed function responds over HTTPS
- the auth challenge and metadata routes are live
- the function sees all required secrets

## Task 5 - Seed representative memories with real embeddings

Overall objective: give the v1 server enough data to prove `search` and `fetch` are useful.

Steps:

1. Insert a small set of representative memories into `public.memories`.
2. Make sure each row has content that reflects the kinds of things you want the brain to retrieve.
3. Generate embeddings for those rows using the same model configured in `.env`.
4. Update each row with `embedding`, `embedding_model`, and `embedded_at`.
5. Confirm `match_memories` returns sensible results for a few known queries.
6. Capture 3-5 canonical test queries that should always work during validation.

Done when:

- `search` has meaningful data to retrieve
- `fetch` can retrieve real records by id
- you have a small regression query set for manual validation

## Task 6 - Validate with MCP inspector first

Overall objective: verify transport, discovery, auth, and tool behavior before trying client-specific integrations.

Steps:

1. Start with the hosted endpoint URL for the function root.
2. Use MCP inspector or another inspector-compatible client.
3. Confirm the client discovers or follows the auth challenge correctly.
4. Complete the OAuth flow in the browser.
5. Verify the tool list includes `search` and `fetch`.
6. Run your canonical `search` queries.
7. Run `fetch` with a known UUID.
8. Inspect the Edge Function logs and confirm request id, subject, tool, status, and latency are present.

Done when:

- inspector auth succeeds
- the tool list is visible
- `search` and `fetch` both work end to end

## Task 7 - Solve discovery and domain issues if a client needs them

Overall objective: make sure real clients can discover auth metadata cleanly, even if they are stricter than the inspector.

Steps:

1. Test whether your target client honors the `resource_metadata` value from the `WWW-Authenticate` header.
2. If it does, keep using the default Supabase function URL.
3. If it expects `/.well-known/*` at the origin root, place the function behind a custom domain, reverse proxy, or gateway.
4. Make sure the final public MCP base URL is stable and matches `MCP_PUBLIC_BASE_URL`.
5. Re-test the protected resource metadata and auth metadata URLs through the final public hostname.

Done when:

- your final public URL works with the client discovery behavior you actually see
- the function URL and metadata URLs are stable and consistent

## Task 8 - Connect ChatGPT and Claude

Overall objective: satisfy the roadmap success criteria with real clients.

Steps:

1. Add the hosted MCP URL to `ChatGPT`.
2. Complete its OAuth flow and verify it can list tools.
3. Run at least one successful `search` call from `ChatGPT`.
4. Repeat the process with `Claude`.
5. Run at least one successful `fetch` call from one of the real clients.
6. Note any client-specific setup quirks in your docs.

Done when:

- `ChatGPT` connects and uses `search`
- `Claude` connects and uses `search`
- at least one real client successfully uses `fetch`

## Task 9 - Final hardening before calling v1 done

Overall objective: close the operational gaps so the hosted read-only release is trustworthy.

Steps:

1. Review logs for auth failures, successful searches, and failed searches.
2. Decide whether `recent_memories` helps enough to add after the initial read-only rollout.
3. Add any practical request caps or input bounds you still want after observing live traffic.
4. Update the operator docs with the exact deploy, rollback, and troubleshooting steps you used.
5. Freeze post-v1 work into the backlog, especially the write-side authorization model for `save_memory`.

Done when:

- the release checklist in `docs/v1-implementation-plan.md` is fully satisfied
- the v1 scope is still read-first and controlled
