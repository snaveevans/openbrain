#!/usr/bin/env bash
# Create the Open Brain MCP Worker Cloudflare resources if they are missing.
# Safe to run on every deploy: existing KV namespaces are left alone.
#
# Mirrors scripts/ensure-cloudflare.sh: the namespace ids are hardcoded in both
# this script and packages/openbrain-mcp/wrangler.jsonc, and this script
# verifies they agree. If a namespace is ever recreated with a different id,
# update both files together (the script fails loud on mismatch).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="${ROOT}/packages/openbrain-mcp"

# `wrangler kv namespace list` prints a JSON array on stdout (no --json flag in
# wrangler 4.x). stderr (telemetry/warnings) is not captured.
kv_list_all() {
  npx wrangler kv namespace list
}

ensure_kv() {
  local title="$1"
  local expected_id="$2"
  local kv_list kv_id

  echo "== KV ${title} =="
  kv_list="$(kv_list_all)"
  kv_id="$(jq -r --arg title "${title}" '.[] | select(.title == $title) | .id' <<<"${kv_list}")"
  if [[ -z "${kv_id}" ]]; then
    echo "Creating KV ${title}"
    npx wrangler kv namespace create "${title}"
    kv_list="$(kv_list_all)"
    kv_id="$(jq -r --arg title "${title}" '.[] | select(.title == $title) | .id' <<<"${kv_list}")"
  else
    echo "KV ${title} already exists"
  fi

  if [[ "${kv_id}" != "${expected_id}" ]]; then
    echo "::error::KV ${title} id is ${kv_id}; wrangler.jsonc expects ${expected_id}"
    echo "Update packages/openbrain-mcp/wrangler.jsonc and scripts/ensure-cloudflare-mcp.sh together."
    exit 1
  fi
}

cd "${MCP_DIR}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

# Token-lifecycle KV for the MCP Worker (ADR-0008 / oauth.md). Prod is bound in
# the top-level wrangler.jsonc; dev is bound only in the `dev` env (local
# `wrangler dev -e dev`), never deployed.
ensure_kv "openbrain-mcp-tokens" "ce4b23c2c52d4463a7d47a2e82efaf68"
ensure_kv "openbrain-mcp-tokens-dev" "b863849a71d44905b23577223f0aa5a7"

echo "MCP Cloudflare resources are present."
