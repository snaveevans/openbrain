import assert from "node:assert/strict";
import { test } from "node:test";

import {
  API_KEY_ENV,
  API_KEY_HEADER,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SOURCE,
  ERROR_API_KEY_NOT_CONFIGURED,
  ERROR_BODY_NOT_OBJECT,
  ERROR_CONTENT_EMPTY,
  ERROR_CONTENT_TOO_LARGE,
  ERROR_ID_UUID,
  ERROR_INVALID_JSON,
  ERROR_MEMORY_NOT_FOUND,
  ERROR_MEMORY_TOO_LARGE,
  ERROR_METADATA_OBJECT,
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  ERROR_QUERY_EMPTY,
  ERROR_UNAUTHORIZED,
  HEALTH_SERVICE,
  MAX_SEARCH_LIMIT,
  MIN_SEARCH_LIMIT,
  type CreateMemoryRequest,
  type CreateMemoryResponse,
  type DeleteMemoryResponse,
  type Embedder,
  type ErrorBody,
  type FetchMemoryResponse,
  type HealthResponse,
  type MemoryDocument,
  type MemoryStore,
  type SearchHit,
  type SearchMemoriesRequest,
  type SearchMemoriesResponse,
  type VectorIndex,
} from "./index.js";

test("search defaults match the search-memories spec", () => {
  assert.equal(DEFAULT_SOURCE, "manual");
  assert.equal(DEFAULT_SEARCH_LIMIT, 10);
  assert.equal(MIN_SEARCH_LIMIT, 1);
  assert.equal(MAX_SEARCH_LIMIT, 25);
});

test("auth and envelope constants match the specs", () => {
  assert.equal(API_KEY_HEADER, "x-api-key");
  assert.equal(API_KEY_ENV, "API_KEY");
  assert.equal(HEALTH_SERVICE, "openbrain");
  assert.equal(ERROR_UNAUTHORIZED, "Unauthorized.");
  assert.equal(
    ERROR_API_KEY_NOT_CONFIGURED,
    "API_KEY secret is not configured.",
  );
  assert.equal(ERROR_NOT_FOUND, "Not found.");
  assert.equal(ERROR_METHOD_NOT_ALLOWED, "Method not allowed.");
  assert.equal(ERROR_MEMORY_NOT_FOUND, "Memory not found.");
  assert.equal(ERROR_CONTENT_EMPTY, "`content` must be a non-empty string.");
  assert.equal(
    ERROR_METADATA_OBJECT,
    "`metadata` must be a JSON object when provided.",
  );
  assert.equal(ERROR_INVALID_JSON, "Request body must be valid JSON.");
  assert.equal(ERROR_BODY_NOT_OBJECT, "Request body must be a JSON object.");
  assert.equal(ERROR_CONTENT_TOO_LARGE, "`content` is too large.");
  assert.equal(ERROR_MEMORY_TOO_LARGE, "Memory is too large to store.");
  assert.equal(ERROR_ID_UUID, "`id` must be a valid UUID.");
  assert.equal(ERROR_QUERY_EMPTY, "`query` must be a non-empty string.");
});

test("HTTP envelopes type-check against the REST contract", () => {
  const health: HealthResponse = { ok: true, service: HEALTH_SERVICE };
  const error: ErrorBody = { error: ERROR_NOT_FOUND };
  const createReq: CreateMemoryRequest = { content: "note" };
  const memory: MemoryDocument = {
    id: "00000000-0000-4000-8000-000000000001",
    content: "note",
    source: DEFAULT_SOURCE,
    metadata: {},
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    embedding_model: "test-model",
    embedded_at: "2026-08-14T00:00:00.000Z",
  };
  const created: CreateMemoryResponse = { memory };
  const fetched: FetchMemoryResponse = { memory };
  const deleted: DeleteMemoryResponse = { memory, deleted: true };
  const searchReq: SearchMemoriesRequest = {
    query: "note",
    limit: 5,
    threshold: 0.2,
  };
  const hit: SearchHit = { ...memory, similarity: 0.91 };
  const searched: SearchMemoriesResponse = { matches: [hit] };

  assert.equal(health.service, "openbrain");
  assert.equal(error.error, "Not found.");
  assert.equal(createReq.content, "note");
  assert.equal(created.memory.id, memory.id);
  assert.equal(fetched.memory.content, "note");
  assert.equal(deleted.deleted, true);
  assert.equal(searchReq.query, "note");
  assert.equal(searched.matches[0]?.similarity, 0.91);
});

test("in-memory fakes satisfy the store, embedder, and index ports", async () => {
  const rows = new Map<string, MemoryDocument>();
  const vectors = new Map<string, { values: number[]; source: string }>();

  const store: MemoryStore = {
    async insert(document) {
      rows.set(document.id, document);
      return document;
    },
    async getById(id) {
      return rows.get(id) ?? null;
    },
    async deleteById(id) {
      const existing = rows.get(id) ?? null;
      if (existing) {
        rows.delete(id);
      }
      return existing;
    },
    async getByIds(ids) {
      return ids.flatMap((id) => {
        const row = rows.get(id);
        return row ? [row] : [];
      });
    },
  };

  const embedder: Embedder = {
    async embed(text, role) {
      const seed = role === "query" ? 1 : 2;
      return {
        values: [seed, text.length, 0],
        model: "test-model",
      };
    },
  };

  const index: VectorIndex = {
    async upsert(record) {
      vectors.set(record.id, { values: record.values, source: record.source });
    },
    async deleteById(id) {
      vectors.delete(id);
    },
    async query(input) {
      return [...vectors.entries()]
        .filter(
          ([, value]) =>
            input.source === undefined || value.source === input.source,
        )
        .slice(0, input.limit)
        .map(([id]) => ({ id, score: 0.5 }));
    },
  };

  const document: MemoryDocument = {
    id: "00000000-0000-4000-8000-000000000002",
    content: "portable types",
    source: "cli",
    metadata: { tag: "v1" },
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    embedding_model: "test-model",
    embedded_at: "2026-08-14T00:00:00.000Z",
  };

  const embedded = await embedder.embed(document.content, "document");
  await store.insert(document);
  await index.upsert({
    id: document.id,
    values: embedded.values,
    source: document.source,
  });

  assert.deepEqual(await store.getById(document.id), document);
  assert.equal((await store.getByIds([document.id, "missing"])).length, 1);
  assert.equal(
    (await index.query({ values: embedded.values, limit: 10 })).length,
    1,
  );

  await index.deleteById(document.id);
  assert.equal((await store.deleteById(document.id))?.id, document.id);
  assert.equal(await store.getById(document.id), null);
  assert.equal(
    (await index.query({ values: embedded.values, limit: 10 })).length,
    0,
  );
});
