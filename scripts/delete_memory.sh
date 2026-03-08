#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

: "${PROJECT_ID:?Set PROJECT_ID in .env}"
: "${API_KEY:?Set API_KEY in .env}"
: "${MEMORY_ID:?Set MEMORY_ID in .env or export it before running}"

curl --fail-with-body \
  --request POST \
  --url "https://${PROJECT_ID}.supabase.co/functions/v1/delete_memory" \
  --header "content-type: application/json" \
  --header "x-api-key: ${API_KEY}" \
  --data-binary @- <<EOF
{
  "id": "${MEMORY_ID}"
}
EOF
