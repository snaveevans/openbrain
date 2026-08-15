import {
  API_KEY_HEADER,
  ERROR_API_KEY_NOT_CONFIGURED,
  ERROR_BODY_NOT_OBJECT,
  ERROR_CONTENT_TOO_LARGE,
  ERROR_INVALID_JSON,
  ERROR_LIMIT_NUMBER,
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  ERROR_QUERY_EMPTY,
  ERROR_QUERY_TOO_LARGE,
  ERROR_SOURCE_STRING,
  ERROR_THRESHOLD_RANGE,
  ERROR_UNAUTHORIZED,
  type MemoryDocument,
  type SearchHit,
} from "@snaveevans/openbrain-common";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CACHE_CONTROL_NO_STORE } from "../src/http.js";
import { MAX_EMBED_CONTENT_CHARS } from "../src/limits.js";
import { parseSearchBody, SEARCH_CANDIDATE_LIMIT } from "../src/search.js";
import {
  createDeps,
  FIXED_ID,
  FIXED_NOW,
  SECOND_ID,
  TEST_MODEL,
} from "./fakes.js";

const KEY = "test-api-key";
const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORPHAN_INDEX_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type Fakes = ReturnType<typeof createDeps>;

function document(
  id: string,
  content: string,
  source = "note",
): MemoryDocument {
  return {
    id,
    content,
    source,
    metadata: { k: 1 },
    created_at: FIXED_NOW.toISOString(),
    updated_at: FIXED_NOW.toISOString(),
    embedding_model: TEST_MODEL,
    embedded_at: FIXED_NOW.toISOString(),
  };
}

function seedPair(
  fakes: Fakes,
  id: string,
  content: string,
  score: number,
  source = "note",
) {
  fakes.store.rows.set(id, document(id, content, source));
  fakes.index.records.set(id, {
    values: [0.1, 0.2, 0.3],
    source,
    score,
  });
}

function snapshot(fakes: Fakes) {
  return {
    inserts: fakes.store.inserts,
    deletes: fakes.store.deletes,
    upserts: fakes.index.upserts,
    indexDeletes: fakes.index.deletes,
    rows: fakes.store.rows.size,
    vectors: fakes.index.records.size,
  };
}

function assertReadOnly(fakes: Fakes, before: ReturnType<typeof snapshot>) {
  expect(fakes.store.inserts).toBe(before.inserts);
  expect(fakes.store.deletes).toBe(before.deletes);
  expect(fakes.index.upserts).toBe(before.upserts);
  expect(fakes.index.deletes).toBe(before.indexDeletes);
  expect(fakes.store.rows.size).toBe(before.rows);
  expect(fakes.index.records.size).toBe(before.vectors);
}

function appFor(fakes: Fakes) {
  return createApp({
    create: fakes.deps,
    store: fakes.store,
    index: fakes.index,
  });
}

function search(
  body: unknown,
  fakes: Fakes,
  init: RequestInit = {},
  bindings: { API_KEY?: string } = { API_KEY: KEY },
) {
  const headers = new Headers(init.headers);
  if (!headers.has(API_KEY_HEADER)) {
    headers.set(API_KEY_HEADER, KEY);
  }
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return appFor(fakes).request(
    "/v1/memories/search",
    {
      method: "POST",
      ...init,
      headers,
      body:
        init.body !== undefined
          ? init.body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
    },
    bindings,
  );
}

function del(id: string, fakes: Fakes) {
  return appFor(fakes).request(
    `/v1/memories/${id}`,
    { method: "DELETE", headers: { [API_KEY_HEADER]: KEY } },
    { API_KEY: KEY },
  );
}

describe("POST /v1/memories/search", () => {
  it("ranks seeded hits by descending similarity and embeds as query", async () => {
    const fakes = createDeps();
    seedPair(fakes, ID_A, "alpha notes", 0.9);
    seedPair(fakes, ID_B, "beta notes", 0.6);
    seedPair(fakes, ID_C, "gamma notes", 0.3);
    const before = snapshot(fakes);

    const res = await search({ query: "  notes  " }, fakes);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    const body = (await res.json()) as { matches: SearchHit[] };
    expect(Object.keys(body)).toEqual(["matches"]);
    expect(body.matches.map((hit) => hit.similarity)).toEqual([0.9, 0.6, 0.3]);
    expect(body.matches.map((hit) => hit.id)).toEqual([ID_A, ID_B, ID_C]);
    expect(body.matches.map((hit) => hit.content)).toEqual([
      "alpha notes",
      "beta notes",
      "gamma notes",
    ]);
    for (const hit of body.matches) {
      expect(Object.keys(hit).sort()).toEqual([
        "content",
        "created_at",
        "embedded_at",
        "embedding_model",
        "id",
        "metadata",
        "similarity",
        "source",
        "updated_at",
      ]);
      expect(hit.embedding_model).toBe(TEST_MODEL);
      expect(hit.embedded_at).toBe(FIXED_NOW.toISOString());
      expect(hit.similarity).toBeGreaterThanOrEqual(0);
      expect(hit.similarity).toBeLessThanOrEqual(1);
    }
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(fakes.embedder.calls).toBe(1);
    expect(fakes.embedder.lastText).toBe("notes");
    expect(fakes.embedder.lastRole).toBe("query");
    assertReadOnly(fakes, before);
  });

  it("defaults omitted limit to 10 and clamps provided limits", async () => {
    const fakes = createDeps();
    for (let i = 0; i < 30; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      seedPair(fakes, id, `row ${i}`, 1 - i / 100);
    }

    const omitted = await search({ query: "notes" }, fakes);
    expect(omitted.status).toBe(200);
    const omittedBody = (await omitted.json()) as { matches: SearchHit[] };
    expect(omittedBody.matches).toHaveLength(10);
    expect(omittedBody.matches[0]?.similarity).toBe(1);
    expect(omittedBody.matches[9]?.similarity).toBeCloseTo(0.91);

    const two = await search({ query: "notes", limit: 2 }, fakes);
    expect(
      ((await two.json()) as { matches: SearchHit[] }).matches,
    ).toHaveLength(2);

    for (const limit of [0, -3]) {
      const res = await search({ query: "notes", limit }, fakes);
      expect(res.status).toBe(200);
      expect(
        ((await res.json()) as { matches: SearchHit[] }).matches,
      ).toHaveLength(1);
    }

    const float = await search({ query: "notes", limit: 2.9 }, fakes);
    expect(
      ((await float.json()) as { matches: SearchHit[] }).matches,
    ).toHaveLength(2);

    const huge = await search({ query: "notes", limit: 100 }, fakes);
    expect(
      ((await huge.json()) as { matches: SearchHit[] }).matches,
    ).toHaveLength(25);
  });

  it("clamps published similarity and does not stretch cosine", async () => {
    const fakes = createDeps();
    seedPair(fakes, ID_A, "high", 0.8);
    seedPair(fakes, ID_B, "neg", -0.2);
    seedPair(fakes, ID_C, "over", 1.2);

    const res = await search({ query: "notes" }, fakes);
    const body = (await res.json()) as { matches: SearchHit[] };
    expect(body.matches.map((hit) => [hit.id, hit.similarity])).toEqual([
      [ID_C, 1.0],
      [ID_A, 0.8],
      [ID_B, 0.0],
    ]);
    expect(body.matches.some((hit) => hit.similarity === 0.9)).toBe(false);

    const filtered = await search({ query: "notes", threshold: 0.7 }, fakes);
    const kept = (await filtered.json()) as { matches: SearchHit[] };
    expect(kept.matches.map((hit) => hit.id)).toEqual([ID_C, ID_A]);
    expect(kept.matches.map((hit) => hit.similarity)).toEqual([1.0, 0.8]);
  });

  it("drops below threshold before applying limit", async () => {
    const fakes = createDeps();
    seedPair(fakes, ID_A, "best", 0.95);
    seedPair(fakes, ID_B, "next", 0.9);
    seedPair(fakes, ID_C, "low", 0.4);
    seedPair(fakes, ID_D, "lower", 0.35);

    const first = await search(
      { query: "notes", threshold: 0.5, limit: 1 },
      fakes,
    );
    const firstBody = (await first.json()) as { matches: SearchHit[] };
    expect(firstBody.matches.map((hit) => hit.similarity)).toEqual([0.95]);
    expect(firstBody.matches[0]?.id).toBe(ID_A);

    const both = await search(
      { query: "notes", threshold: 0.5, limit: 10 },
      fakes,
    );
    expect(
      ((await both.json()) as { matches: SearchHit[] }).matches.map(
        (hit) => hit.similarity,
      ),
    ).toEqual([0.95, 0.9]);

    const equal = await search({ query: "notes", threshold: 0.9 }, fakes);
    expect(
      ((await equal.json()) as { matches: SearchHit[] }).matches.map(
        (hit) => hit.similarity,
      ),
    ).toEqual([0.95, 0.9]);

    const none = await search({ query: "notes", threshold: 0.99 }, fakes);
    expect(none.status).toBe(200);
    await expect(none.json()).resolves.toEqual({ matches: [] });
    expect(fakes.index.lastQuery?.limit).toBe(SEARCH_CANDIDATE_LIMIT);
  });

  it("filters source with an exact case-sensitive match", async () => {
    const fakes = createDeps();
    seedPair(fakes, ID_A, "lower", 0.9, "note");
    seedPair(fakes, ID_B, "upper", 0.99, "Note");

    const hit = await search({ query: "notes", source: "note" }, fakes);
    const body = (await hit.json()) as { matches: SearchHit[] };
    expect(body.matches.map((row) => row.id)).toEqual([ID_A]);
    expect(body.matches[0]?.source).toBe("note");
    expect(fakes.index.lastQuery?.source).toBe("note");

    const miss = await search({ query: "notes", source: "missing" }, fakes);
    expect(miss.status).toBe(200);
    await expect(miss.json()).resolves.toEqual({ matches: [] });
  });

  it("drops leftover documents and orphan index ids", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "healthy", 0.8);
    fakes.store.rows.set(SECOND_ID, document(SECOND_ID, "no vector"));
    fakes.index.records.set(ORPHAN_INDEX_ID, {
      values: [0.1],
      source: "note",
      score: 0.99,
    });

    const res = await search({ query: "notes" }, fakes);
    const body = (await res.json()) as { matches: SearchHit[] };
    expect(body.matches.map((hit) => hit.id)).toEqual([FIXED_ID]);
    expect(body.matches.some((hit) => hit.id === SECOND_ID)).toBe(false);
    expect(body.matches.some((hit) => hit.id === ORPHAN_INDEX_ID)).toBe(false);

    const orphans = createDeps();
    orphans.store.rows.set(SECOND_ID, document(SECOND_ID, "no vector"));
    orphans.index.records.set(ORPHAN_INDEX_ID, {
      values: [0.1],
      source: "note",
      score: 0.99,
    });
    const empty = await search({ query: "notes" }, orphans);
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ matches: [] });
  });

  it("returns 200 { matches: [] } for an empty store", async () => {
    const fakes = createDeps();
    const before = snapshot(fakes);
    const res = await search({ query: "x" }, fakes);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: unknown[] };
    expect(body).toEqual({ matches: [] });
    expect(body).not.toEqual({ error: ERROR_NOT_FOUND });
    expect(ERROR_NOT_FOUND).not.toBe("Memory not found.");
    expect(fakes.embedder.calls).toBe(1);
    expect(fakes.embedder.lastRole).toBe("query");
    assertReadOnly(fakes, before);
  });

  it("rejects invalid query, limit, threshold, source, and bodies with no work", async () => {
    const cases: Array<{ body: unknown; error: string }> = [
      { body: { query: "   " }, error: ERROR_QUERY_EMPTY },
      { body: { query: "" }, error: ERROR_QUERY_EMPTY },
      { body: {}, error: ERROR_QUERY_EMPTY },
      { body: { query: null }, error: ERROR_QUERY_EMPTY },
      { body: { query: 42 }, error: ERROR_QUERY_EMPTY },
      { body: { query: [] }, error: ERROR_QUERY_EMPTY },
      {
        body: { query: "x".repeat(MAX_EMBED_CONTENT_CHARS + 1) },
        error: ERROR_QUERY_TOO_LARGE,
      },
      { body: { query: "notes", limit: "10" }, error: ERROR_LIMIT_NUMBER },
      { body: { query: "notes", limit: null }, error: ERROR_LIMIT_NUMBER },
      { body: { query: "notes", limit: true }, error: ERROR_LIMIT_NUMBER },
      { body: { query: "notes", limit: [] }, error: ERROR_LIMIT_NUMBER },
      {
        body: { query: "notes", threshold: "0.5" },
        error: ERROR_THRESHOLD_RANGE,
      },
      {
        body: { query: "notes", threshold: -0.1 },
        error: ERROR_THRESHOLD_RANGE,
      },
      {
        body: { query: "notes", threshold: 1.1 },
        error: ERROR_THRESHOLD_RANGE,
      },
      {
        body: { query: "notes", threshold: null },
        error: ERROR_THRESHOLD_RANGE,
      },
      { body: { query: "notes", threshold: [] }, error: ERROR_THRESHOLD_RANGE },
      { body: { query: "notes", source: "" }, error: ERROR_SOURCE_STRING },
      { body: { query: "notes", source: "   " }, error: ERROR_SOURCE_STRING },
      { body: { query: "notes", source: null }, error: ERROR_SOURCE_STRING },
      { body: { query: "notes", source: 1 }, error: ERROR_SOURCE_STRING },
    ];

    for (const { body, error } of cases) {
      const fakes = createDeps();
      seedPair(fakes, FIXED_ID, "keep", 0.8);
      const before = snapshot(fakes);
      const res = await search(body, fakes);
      expect(res.status, JSON.stringify(body)).toBe(400);
      await expect(res.json()).resolves.toEqual({ error });
      expect(error).not.toBe(ERROR_CONTENT_TOO_LARGE);
      expect(fakes.embedder.calls).toBe(0);
      expect(fakes.index.queries).toBe(0);
      expect(fakes.store.getByIdsCalls).toBe(0);
      assertReadOnly(fakes, before);
    }

    expect(ERROR_QUERY_TOO_LARGE).not.toBe(ERROR_CONTENT_TOO_LARGE);

    expect(() =>
      parseSearchBody({ query: "notes", limit: Number.NaN }),
    ).toThrow(ERROR_LIMIT_NUMBER);
    expect(() =>
      parseSearchBody({ query: "notes", limit: Number.POSITIVE_INFINITY }),
    ).toThrow(ERROR_LIMIT_NUMBER);

    for (const raw of ["{", ""]) {
      const fakes = createDeps();
      seedPair(fakes, FIXED_ID, "keep", 0.8);
      const before = snapshot(fakes);
      const res = await search(undefined, fakes, { body: raw });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: ERROR_INVALID_JSON });
      expect(fakes.embedder.calls).toBe(0);
      assertReadOnly(fakes, before);
    }

    for (const body of [[], "x", 42]) {
      const fakes = createDeps();
      seedPair(fakes, FIXED_ID, "keep", 0.8);
      const before = snapshot(fakes);
      const res = await search(body, fakes);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: ERROR_BODY_NOT_OBJECT,
      });
      expect(fakes.embedder.calls).toBe(0);
      assertReadOnly(fakes, before);
    }
  });

  it("returns 401 before parse when the key is missing on invalid JSON", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    const res = await appFor(fakes).request(
      "/v1/memories/search",
      { method: "POST", body: "{" },
      { API_KEY: KEY },
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
    expect(fakes.embedder.calls).toBe(0);
    assertReadOnly(fakes, before);
  });

  it("returns 401 for empty, whitespace, and wrong keys before embed", async () => {
    for (const presented of ["", "   ", "nope"]) {
      const fakes = createDeps();
      seedPair(fakes, FIXED_ID, "keep", 0.8);
      const before = snapshot(fakes);
      const res = await search({ query: "" }, fakes, {
        headers: { [API_KEY_HEADER]: presented },
      });
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
      expect(fakes.embedder.calls).toBe(0);
      assertReadOnly(fakes, before);
    }
  });

  it("returns 500 when the server key is missing and does not search", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    const res = await search({ query: "notes" }, fakes, {}, {});
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_API_KEY_NOT_CONFIGURED,
    });
    expect(fakes.embedder.calls).toBe(0);
    assertReadOnly(fakes, before);
  });

  it("returns 500 when the server key is whitespace and does not search", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    const res = await search({ query: "notes" }, fakes, {}, { API_KEY: "   " });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_API_KEY_NOT_CONFIGURED,
    });
    expect(fakes.embedder.calls).toBe(0);
    assertReadOnly(fakes, before);
  });

  it("does not accept the key from query, body, or Bearer", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    const viaQuery = await appFor(fakes).request(
      `/v1/memories/search?api_key=${KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "notes" }),
      },
      { API_KEY: KEY },
    );
    const viaBearer = await appFor(fakes).request(
      "/v1/memories/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "notes" }),
      },
      { API_KEY: KEY },
    );
    const viaBody = await appFor(fakes).request(
      "/v1/memories/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "notes", "x-api-key": KEY }),
      },
      { API_KEY: KEY },
    );
    expect(viaQuery.status).toBe(401);
    expect(viaBearer.status).toBe(401);
    expect(viaBody.status).toBe(401);
    expect(fakes.embedder.calls).toBe(0);
    assertReadOnly(fakes, before);
  });

  it("accepts a trimmed matching key", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const res = await search({ query: "notes" }, fakes, {
      headers: { [API_KEY_HEADER]: `  ${KEY}  ` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: SearchHit[] };
    expect(body.matches).toHaveLength(1);
  });

  it("returns 500 when query embed fails and writes nothing", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    fakes.embedder.failNext = true;
    const res = await search({ query: "secret notes" }, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("matches");
    expect(typeof body.error).toBe("string");
    expect(body.error).toBe("embed failed");
    expect(String(body.error)).not.toContain(KEY);
    expect(String(body.error)).not.toContain("secret notes");
    expect(String(body.error)).not.toContain("keep");
    expect(fakes.embedder.calls).toBe(1);
    expect(fakes.index.queries).toBe(0);
    assertReadOnly(fakes, before);
  });

  it("returns 500 when query embed returns no values", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    fakes.embedder.emptyNext = true;
    const res = await search({ query: "notes" }, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("matches");
    expect(body.error).toBe("Embedding response did not include a vector.");
    expect(fakes.index.queries).toBe(0);
    assertReadOnly(fakes, before);
  });

  it("returns 500 when the index query fails", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    fakes.index.failNextQuery = true;
    const res = await search({ query: "notes" }, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("matches");
    expect(body.error).toBe("index query failed");
    expect(fakes.store.getByIdsCalls).toBe(0);
    assertReadOnly(fakes, before);
  });

  it("returns 500 when document hydrate fails", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    fakes.store.failNextGetByIds = true;
    const res = await search({ query: "notes" }, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("matches");
    expect(body.error).toBe("store hydrate failed");
    assertReadOnly(fakes, before);
  });

  it("does not return a deleted pair on a later search", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "gone", 0.9);
    seedPair(fakes, SECOND_ID, "stay", 0.4);
    const removed = await del(FIXED_ID, fakes);
    expect(removed.status).toBe(200);
    const res = await search({ query: "notes" }, fakes);
    const body = (await res.json()) as { matches: SearchHit[] };
    expect(body.matches.map((hit) => hit.id)).toEqual([SECOND_ID]);
    expect(body.matches.some((hit) => hit.id === FIXED_ID)).toBe(false);
  });

  it("does not create a row or vector across two searches", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    expect((await search({ query: "notes" }, fakes)).status).toBe(200);
    expect((await search({ query: "notes" }, fakes)).status).toBe(200);
    expect(fakes.embedder.calls).toBe(2);
    expect(fakes.embedder.lastRole).toBe("query");
    assertReadOnly(fakes, before);
  });

  it("returns 405 for the wrong method on the search path", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const before = snapshot(fakes);
    const res = await appFor(fakes).request(
      "/v1/memories/search",
      { method: "GET", headers: { [API_KEY_HEADER]: KEY } },
      { API_KEY: KEY },
    );
    expect(res.status).toBe(405);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_METHOD_NOT_ALLOWED,
    });
    expect(fakes.embedder.calls).toBe(0);
    assertReadOnly(fakes, before);
  });

  it("treats a trailing slash as the same search", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "keep", 0.8);
    const res = await appFor(fakes).request(
      "/v1/memories/search/",
      {
        method: "POST",
        headers: {
          [API_KEY_HEADER]: KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "notes" }),
      },
      { API_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: SearchHit[] };
    expect(body.matches).toHaveLength(1);
  });
});
