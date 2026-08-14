# openbrain-auth

Thin Cloudflare Pages frontend for the Open Brain remote MCP auth flow.

## Routes

- `/login` - email magic-link sign in
- `/oauth/consent` - Supabase OAuth consent screen

## Build

```bash
OPENBRAIN_AUTH_SUPABASE_URL=https://<project>.supabase.co \
OPENBRAIN_AUTH_SUPABASE_PUBLISHABLE_KEY=<publishable-key> \
npm run build --workspace openbrain-auth
```

Cloudflare Pages settings:

- Build command: `npm run build --workspace openbrain-auth`
- Build output directory: `packages/openbrain-auth/dist`
- Wrangler config: `packages/openbrain-auth/wrangler.json`

Required build environment variables:

- `OPENBRAIN_AUTH_SUPABASE_URL`
- `OPENBRAIN_AUTH_SUPABASE_PUBLISHABLE_KEY`

## Local development

1. Copy `packages/openbrain-auth/.env.local.example` to `packages/openbrain-auth/.env.local` and fill in the Supabase values.
2. Make sure Supabase Auth allows your local login redirect URL, for example `http://127.0.0.1:3000/login`.
3. Start the local server:

```bash
npm run dev --workspace openbrain-auth
```

Local routes:

- `http://127.0.0.1:3000/login`
- `http://127.0.0.1:3000/oauth/consent`

Notes:

- The dev server serves the built static app from `dist` and watches TypeScript changes.
- `build` and `dev` automatically read `packages/openbrain-auth/.env.local` if present.
- For local magic-link testing, Supabase must allowlist your local `/login` URL.
- For full OAuth consent testing against Supabase locally, point your temporary authorization UI path to the local `/oauth/consent` URL or use a local tunnel.
- `wrangler.json` points Cloudflare at the built `dist` directory for deployment.

Supabase Auth prerequisites:

- Allowlist `https://auth.txe.app/login` as an auth redirect URL for magic links.
- Keep the email magic-link template using the Supabase-provided redirect target so the user returns to `/login?next=...`.
- Point the OAuth 2.1 authorization UI path at `https://auth.txe.app/oauth/consent`.
