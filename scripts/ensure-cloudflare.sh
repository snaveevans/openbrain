#!/usr/bin/env bash
# Create Open Brain Cloudflare resources if they are missing.
# Safe to run on every deploy: existing D1 / Vectorize objects are left alone.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${ROOT}/packages/openbrain-api"

D1_NAME="openbrain"
D1_ID="08681607-7750-46fd-8de9-ebac3dec3380"
INDEX_NAME="openbrain-memories"
INDEX_DIMS="768"
INDEX_METRIC="cosine"
META_NAME="source"
META_TYPE="string"

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

echo "== Vectorize ${INDEX_NAME} =="
if index_json="$(npx wrangler vectorize get "${INDEX_NAME}" --json 2>/dev/null)"; then
  echo "Index ${INDEX_NAME} already exists"
else
  echo "Creating index ${INDEX_NAME}"
  npx wrangler vectorize create "${INDEX_NAME}" \
    --dimensions="${INDEX_DIMS}" \
    --metric="${INDEX_METRIC}" \
    --description "Open Brain memory embeddings (EmbeddingGemma 300M, cosine)" \
    --json
  index_json="$(npx wrangler vectorize get "${INDEX_NAME}" --json)"
fi

dims="$(jq -r '.config.dimensions' <<<"${index_json}")"
metric="$(jq -r '.config.metric' <<<"${index_json}")"
if [[ "${dims}" != "${INDEX_DIMS}" || "${metric}" != "${INDEX_METRIC}" ]]; then
  echo "::error::Index ${INDEX_NAME} is ${dims}-d ${metric}; expected ${INDEX_DIMS}-d ${INDEX_METRIC}"
  exit 1
fi

echo "== Vectorize metadata index ${META_NAME} =="
meta_json="$(npx wrangler vectorize list-metadata-index "${INDEX_NAME}" --json)"
if jq -e --arg name "${META_NAME}" 'any(.[]; .propertyName == $name)' <<<"${meta_json}" >/dev/null; then
  echo "Metadata index ${META_NAME} already exists"
else
  echo "Creating metadata index ${META_NAME}"
  npx wrangler vectorize create-metadata-index "${INDEX_NAME}" \
    --propertyName "${META_NAME}" \
    --type "${META_TYPE}"
fi

echo "Cloudflare resources are present."
