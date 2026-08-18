#!/usr/bin/env bash
# Mint an operator BYOK bearer token for the hosted MCP Worker (oauth.md).
#
# Generates a random ≥128-bit token, writes its SHA-256 hash to the
# openbrain-mcp-tokens KV namespace keyed by the hash (the raw token never
# touches KV — the gate at {mcp}/mcp looks up sha256(bearer)), and prints the
# token ONCE. The stored value is operator metadata {label, created_at}; the
# gate only checks for key existence, not the value. Revocation = delete the
# KV key.
#
# Run from the repo, authed to Cloudflare (CLOUDFLARE_API_TOKEN or wrangler
# login):
#   npm run mint:token -- --label chatmcp
#   npm run mint:token -- --label chatmcp --dry-run   # generate + show, no write
#
# KV is eventually consistent: a just-minted token may take ~1 min to be
# visible at every edge (oauth.md). If a fresh token 401s, wait and retry.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Prod token-lifecycle namespace id. Keep in sync with wrangler.jsonc and
# scripts/ensure-cloudflare-mcp.sh. (Dev minting is out of scope: local
# `wrangler dev -e dev` uses a separate namespace and usually local mode.)
NAMESPACE_ID="ce4b23c2c52d4463a7d47a2e82efaf68"
ENDPOINT="https://mcp.openbrain.tylerevans.co/mcp"

LABEL=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)
      [[ $# -ge 2 ]] || { echo "--label requires a value" >&2; exit 2; }
      LABEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,12p' "${SCRIPT_PATH}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "${LABEL}" ]]; then
  echo "Usage: npm run mint:token -- --label <name> [--dry-run]" >&2
  exit 2
fi

for cmd in openssl jq npx; do
  command -v "${cmd}" >/dev/null 2>&1 || { echo "${cmd} is required" >&2; exit 1; }
done

# Run from the package dir so wrangler resolves config + auth.
cd "${ROOT}"

# 256-bit random token (≥128-bit requirement), hex so it is safe in an
# Authorization header with no encoding. sha256(token) matches the Worker's
# sha256Hex (verified: openssl dgst == crypto.subtle SHA-256 of UTF-8 bytes).
TOKEN="$(openssl rand -hex 32)"
HASH="$(printf '%s' "$TOKEN" | openssl dgst -sha256 | awk '{print $NF}')"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
METADATA="$(jq -nc \
  --arg label "${LABEL}" \
  --arg created_at "${CREATED_AT}" \
  '{label: $label, created_at: $created_at}')"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "DRY RUN — nothing written to KV."
  echo "  label:       ${LABEL}"
  echo "  kv key:      ${HASH}   (sha256 of the token)"
  echo "  kv value:    ${METADATA}"
  echo "  would run:   npx wrangler kv key put \"${HASH}\" \"${METADATA}\" \\"
  echo "                 --namespace-id ${NAMESPACE_ID} --remote"
  echo "  token:       ${TOKEN}"
  exit 0
fi

npx wrangler kv key put "${HASH}" "${METADATA}" \
  --namespace-id "${NAMESPACE_ID}" --remote >/dev/null

cat <<EOF

✅ Minted BYOK bearer token (label: ${LABEL})

  token: ${TOKEN}

Save it now — it will not be shown again. KV stores only the SHA-256 hash.
Revoke:  npx wrangler kv key delete "${HASH}" --namespace-id ${NAMESPACE_ID} --remote

Use it as the bearer against the MCP endpoint:
  Authorization: Bearer ${TOKEN}
  URL:           ${ENDPOINT}
EOF
