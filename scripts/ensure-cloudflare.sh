#!/usr/bin/env bash
# Create Open Brain Cloudflare resources if they are missing.
# Safe to run on every deploy: existing D1 / Vectorize objects are left alone.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${ROOT}/packages/openbrain-api"

D1_NAME="openbrain"
D1_ID="08681607-7750-46fd-8de9-ebac3dec3380"
INDEX_DIMS="768"
INDEX_METRIC="cosine"
META_NAME="source"
META_TYPE="string"

ensure_vectorize() {
  local name="$1"
  local description="$2"
  local index_json

  echo "== Vectorize ${name} =="
  if index_json="$(npx wrangler vectorize get "${name}" --json 2>/dev/null)"; then
    echo "Index ${name} already exists"
  else
    echo "Creating index ${name}"
    npx wrangler vectorize create "${name}" \
      --dimensions="${INDEX_DIMS}" \
      --metric="${INDEX_METRIC}" \
      --description "${description}" \
      --json
    index_json="$(npx wrangler vectorize get "${name}" --json)"
  fi

  local dims metric
  dims="$(jq -r '.config.dimensions' <<<"${index_json}")"
  metric="$(jq -r '.config.metric' <<<"${index_json}")"
  if [[ "${dims}" != "${INDEX_DIMS}" || "${metric}" != "${INDEX_METRIC}" ]]; then
    echo "::error::Index ${name} is ${dims}-d ${metric}; expected ${INDEX_DIMS}-d ${INDEX_METRIC}"
    exit 1
  fi

  echo "== Vectorize ${name} metadata index ${META_NAME} =="
  local meta_json
  meta_json="$(npx wrangler vectorize list-metadata-index "${name}" --json)"
  if jq -e --arg name "${META_NAME}" 'any(.[]; .propertyName == $name)' <<<"${meta_json}" >/dev/null; then
    echo "Metadata index ${META_NAME} already exists on ${name}"
    return
  fi

  echo "Creating metadata index ${META_NAME} on ${name}"
  npx wrangler vectorize create-metadata-index "${name}" \
    --propertyName "${META_NAME}" \
    --type "${META_TYPE}" || true

  local attempt
  for attempt in 1 2 3 4 5 6; do
    meta_json="$(npx wrangler vectorize list-metadata-index "${name}" --json)"
    if jq -e --arg name "${META_NAME}" 'any(.[]; .propertyName == $name)' <<<"${meta_json}" >/dev/null; then
      echo "Metadata index ${META_NAME} is ready on ${name}"
      return
    fi
    sleep 5
  done
  echo "::warning::Metadata index ${META_NAME} on ${name} is still pending; Vectorize creates it asynchronously."
}

cd "${API_DIR}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

echo "== D1 ${D1_NAME} =="
d1_list="$(npx wrangler d1 list --json)"
d1_id="$(jq -r --arg name "${D1_NAME}" '.[] | select(.name == $name) | .uuid' <<<"${d1_list}")"
if [[ -z "${d1_id}" ]]; then
  echo "Creating D1 ${D1_NAME}"
  npx wrangler d1 create "${D1_NAME}" --location wnam
  d1_list="$(npx wrangler d1 list --json)"
  d1_id="$(jq -r --arg name "${D1_NAME}" '.[] | select(.name == $name) | .uuid' <<<"${d1_list}")"
else
  echo "D1 ${D1_NAME} already exists"
fi

if [[ "${d1_id}" != "${D1_ID}" ]]; then
  echo "::error::D1 ${D1_NAME} id is ${d1_id}; wrangler.jsonc expects ${D1_ID}"
  echo "Update packages/openbrain-api/wrangler.jsonc and scripts/ensure-cloudflare.sh together."
  exit 1
fi

ensure_vectorize \
  "openbrain-memories" \
  "Open Brain memory embeddings (EmbeddingGemma 300M, cosine)"
ensure_vectorize \
  "openbrain-memories-dev" \
  "Open Brain local-dev memory embeddings (EmbeddingGemma 300M, cosine)"

echo "Cloudflare resources are present."
