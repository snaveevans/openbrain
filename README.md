# Open Brain Monorepo

This repo contains the Supabase backend, the npm MCP package, and the thin auth frontend.

## Packages

- `packages/openbrain-mcp` - npm MCP server package published as `@snaveevans/openbrain-mcp`
- `packages/openbrain-auth` - Cloudflare Pages auth frontend for the remote MCP OAuth flow

## Cloudflare Pages Auth Build

`packages/openbrain-auth` expects these build environment variables:

- `OPENBRAIN_AUTH_SUPABASE_URL`
- `OPENBRAIN_AUTH_SUPABASE_PUBLISHABLE_KEY`

Supabase Auth should also allowlist `https://auth.txe.app/login` for magic-link redirects and route the OAuth authorization UI to `https://auth.txe.app/oauth/consent`.

For local auth UI testing, `openbrain-auth` also supports `npm run dev --workspace openbrain-auth` on `http://127.0.0.1:3000`.
It will auto-read `packages/openbrain-auth/.env.local` if present.

## Build

```bash
npm install
npm run build
```
