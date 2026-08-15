import {
  API_KEY_HEADER,
  ERROR_API_KEY_NOT_CONFIGURED,
  ERROR_ID_UUID,
  ERROR_MEMORY_NOT_FOUND,
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_UNAUTHORIZED,
  type MemoryDocument,
} from "@snaveevans/openbrain-common";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CACHE_CONTROL_NO_STORE } from "../src/http.js";
import {
  createDeps,
  FIXED_ID,
  FIXED_NOW,
  SECOND_ID,
  TEST_MODEL,
} from "./fakes.js";

const KEY = "test-api-key";
const MIXED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_MIXED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Fakes = ReturnType<typeof createDeps>;

function document(id: string, content: string): MemoryDocument {
  return {
    id,
    content,
    source: "note",
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
  sides: { document?: boolean; index?: boolean } = {},
) {
  const includeDocument = sides.document ?? true;
  const includeIndex = sides.index ?? true;
  if (includeDocument) {
    fakes.store.rows.set(id, document(id, content));
  }
  if (includeIndex) {
    fakes.index.records.set(id, { values: [0.1, 0.2, 0.3], source: "note" });
  }
}

function both(ids: Array<[string, string]> = [[FIXED_ID, "hello"]]) {
  const fakes = createDeps();
  for (const [id, content] of ids) {
    seedPair(fakes, id, content);
  }
  return snapshot(fakes);
}

function snapshot(fakes: Fakes) {
  return {
    fakes,
    storeGets: fakes.store.gets,
    storeDeletes: fakes.store.deletes,
    indexDeletes: fakes.index.deletes,
    indexHas: fakes.index.hasCalls,
  };
}

function appFor(fakes: Fakes) {
  return createApp({
    create: fakes.deps,
    store: fakes.store,
    index: fakes.index,
  });
}

function del(
  id: string,
  fakes: Fakes,
  init: RequestInit = {},
  bindings: { API_KEY?: string } = { API_KEY: KEY },
) {
  const headers = new Headers(init.headers);
  if (!headers.has(API_KEY_HEADER)) {
    headers.set(API_KEY_HEADER, KEY);
  }
  return appFor(fakes).request(
    `/v1/memories/${id}`,
    {
      method: "DELETE",
      ...init,
      headers,
    },
    bindings,
  );
}

function get(id: string, fakes: Fakes) {
  return appFor(fakes).request(
    `/v1/memories/${id}`,
    { method: "GET", headers: { [API_KEY_HEADER]: KEY } },
    { API_KEY: KEY },
  );
}

function assertUntouched(
  fakes: Fakes,
  before: { storeGets: number; storeDeletes: number; indexDeletes: number },
) {
  expect(fakes.store.gets).toBe(before.storeGets);
  expect(fakes.store.deletes).toBe(before.storeDeletes);
  expect(fakes.index.deletes).toBe(before.indexDeletes);
  expect(fakes.index.hasCalls).toBe(0);
  expect(fakes.store.inserts).toBe(0);
  expect(fakes.embedder.calls).toBe(0);
  expect(fakes.index.upserts).toBe(0);
}

describe("DELETE /v1/memories/{id}", () => {
  it("removes both sides and returns 200 { memory, deleted: true }", async () => {
    const { fakes } = both();
    const snapshotRow = structuredClone(fakes.store.rows.get(FIXED_ID));
    const res = await del(FIXED_ID, fakes);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    const body = (await res.json()) as {
      memory: MemoryDocument;
      deleted: boolean;
    };
    expect(Object.keys(body).sort()).toEqual(["deleted", "memory"]);
    expect(body.deleted).toBe(true);
    expect(body.memory).toEqual(snapshotRow);
    expect(body.memory).not.toHaveProperty("similarity");
    expect(body.memory.embedding_model).toBe(TEST_MODEL);
    expect(body.memory.embedded_at).toBe(FIXED_NOW.toISOString());
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(fakes.store.rows.has(FIXED_ID)).toBe(false);
    expect(fakes.index.records.has(FIXED_ID)).toBe(false);
    expect(fakes.embedder.calls).toBe(0);
    expect(fakes.index.upserts).toBe(0);
    expect(fakes.store.inserts).toBe(0);

    const follow = await get(FIXED_ID, fakes);
    expect(follow.status).toBe(404);
    await expect(follow.json()).resolves.toEqual({
      error: ERROR_MEMORY_NOT_FOUND,
    });
  });

  it("returns 404 Memory not found when both sides are missing", async () => {
    const { fakes, storeGets, storeDeletes, indexDeletes } = both();
    const res = await del(SECOND_ID, fakes);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_MEMORY_NOT_FOUND,
    });
    expect(ERROR_MEMORY_NOT_FOUND).not.toBe("Not found.");
    expect(fakes.store.rows.size).toBe(1);
    expect(fakes.index.records.size).toBe(1);
    expect(fakes.store.rows.has(FIXED_ID)).toBe(true);
    expect(fakes.index.records.has(FIXED_ID)).toBe(true);
    expect(fakes.store.deletes).toBe(storeDeletes);
    expect(fakes.index.deletes).toBe(indexDeletes);
    expect(fakes.store.gets).toBe(storeGets + 1);
    expect(fakes.embedder.calls).toBe(0);
  });

  it("rejects paths that are not UUID v4 before any store work", async () => {
    const v4 = "00000000-0000-4000-8000-0000000000ab";
    const notV4 = [
      "not-a-uuid",
      "123",
      "00000000000040008000000000000001",
      `urn:uuid:${v4}`,
      `{${v4}}`,
      "00000000-0000-0000-0000-000000000000",
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "00000000-0000-1000-8000-000000000001",
      "00000000-0000-5000-8000-000000000001",
      "00000000-0000-4000-c000-000000000001",
    ];
    for (const id of notV4) {
      const before = both();
      const res = await del(id, before.fakes);
      expect(res.status, id).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: ERROR_ID_UUID });
      expect(before.fakes.store.rows.has(FIXED_ID)).toBe(true);
      expect(before.fakes.index.records.has(FIXED_ID)).toBe(true);
      assertUntouched(before.fakes, before);
    }
  });

  it("deletes the exact path string and does not rewrite case", async () => {
    const { fakes } = both([
      [MIXED_ID, "cased"],
      [OTHER_MIXED_ID, "other"],
    ]);
    const hit = await del(MIXED_ID, fakes);
    expect(hit.status).toBe(200);
    const body = (await hit.json()) as { memory: { id: string } };
    expect(body.memory.id).toBe(MIXED_ID);
    expect(fakes.store.rows.has(MIXED_ID)).toBe(false);
    expect(fakes.index.records.has(MIXED_ID)).toBe(false);

    const miss = await del(OTHER_MIXED_ID.toUpperCase(), fakes);
    expect(miss.status).toBe(404);
    await expect(miss.json()).resolves.toEqual({
      error: ERROR_MEMORY_NOT_FOUND,
    });
    expect(fakes.store.rows.has(OTHER_MIXED_ID)).toBe(true);
    expect(fakes.index.records.has(OTHER_MIXED_ID)).toBe(true);
  });

  it("returns 401 before UUID check when the key is missing", async () => {
    const before = both();
    const res = await appFor(before.fakes).request(
      "/v1/memories/not-a-uuid",
      { method: "DELETE" },
      { API_KEY: KEY },
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
    assertUntouched(before.fakes, before);
  });

  it("returns 401 for empty, whitespace, and wrong keys before delete", async () => {
    for (const presented of ["", "   ", "nope"]) {
      const before = both();
      const res = await del(FIXED_ID, before.fakes, {
        headers: { [API_KEY_HEADER]: presented },
      });
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
      expect(before.fakes.store.rows.has(FIXED_ID)).toBe(true);
      expect(before.fakes.index.records.has(FIXED_ID)).toBe(true);
      assertUntouched(before.fakes, before);
    }
  });

  it("returns 500 when the server key is missing and does not delete", async () => {
    const before = both();
    const res = await del(FIXED_ID, before.fakes, {}, {});
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_API_KEY_NOT_CONFIGURED,
    });
    expect(before.fakes.store.rows.has(FIXED_ID)).toBe(true);
    expect(before.fakes.index.records.has(FIXED_ID)).toBe(true);
    assertUntouched(before.fakes, before);
  });

  it("returns 500 when the server key is whitespace and does not delete", async () => {
    const before = both();
    const res = await del(FIXED_ID, before.fakes, {}, { API_KEY: "   " });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_API_KEY_NOT_CONFIGURED,
    });
    assertUntouched(before.fakes, before);
  });

  it("does not accept the key from query, body, or Bearer", async () => {
    const before = both();
    const viaQuery = await appFor(before.fakes).request(
      `/v1/memories/${FIXED_ID}?api_key=${KEY}`,
      { method: "DELETE" },
      { API_KEY: KEY },
    );
    const viaBearer = await appFor(before.fakes).request(
      `/v1/memories/${FIXED_ID}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${KEY}` },
      },
      { API_KEY: KEY },
    );
    const viaBody = await appFor(before.fakes).request(
      `/v1/memories/${FIXED_ID}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ "x-api-key": KEY }),
      },
      { API_KEY: KEY },
    );
    expect(viaQuery.status).toBe(401);
    expect(viaBearer.status).toBe(401);
    expect(viaBody.status).toBe(401);
    expect(before.fakes.store.rows.has(FIXED_ID)).toBe(true);
    expect(before.fakes.index.records.has(FIXED_ID)).toBe(true);
    assertUntouched(before.fakes, before);
  });

  it("accepts a trimmed matching key", async () => {
    const { fakes } = both();
    const res = await del(FIXED_ID, fakes, {
      headers: { [API_KEY_HEADER]: `  ${KEY}  ` },
    });
    expect(res.status).toBe(200);
    expect(fakes.store.rows.has(FIXED_ID)).toBe(false);
    expect(fakes.index.records.has(FIXED_ID)).toBe(false);
  });

  it("returns 500 and leaves both sides when document delete fails first", async () => {
    const { fakes } = both();
    const snapshotRow = structuredClone(fakes.store.rows.get(FIXED_ID));
    fakes.store.failNextDelete = true;
    const res = await del(FIXED_ID, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toBe("store delete failed");
    expect(body.error).not.toContain(KEY);
    expect(body.error).not.toContain("hello");
    expect(fakes.store.rows.get(FIXED_ID)).toEqual(snapshotRow);
    expect(fakes.index.records.has(FIXED_ID)).toBe(true);
    expect(fakes.index.deletes).toBe(0);
    expect(fakes.embedder.calls).toBe(0);
  });

  it("returns 500 and leaves the vector when index delete fails after the document is gone", async () => {
    const { fakes } = both();
    fakes.index.failNextDelete = true;
    const res = await del(FIXED_ID, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("index delete failed");
    expect(body.error).not.toContain(KEY);
    expect(fakes.store.rows.has(FIXED_ID)).toBe(false);
    expect(fakes.index.records.has(FIXED_ID)).toBe(true);
  });

  it("returns 500 and leaves the document when document delete fails after the index is already gone", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "leftover", { document: true, index: false });
    const snapshotRow = structuredClone(fakes.store.rows.get(FIXED_ID));
    fakes.store.failNextDelete = true;
    const res = await del(FIXED_ID, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("store delete failed");
    expect(fakes.store.rows.get(FIXED_ID)).toEqual(snapshotRow);
    expect(fakes.index.records.has(FIXED_ID)).toBe(false);
    expect(fakes.index.deletes).toBe(0);
  });

  it("retries a leftover document and returns 200 once both sides are gone", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "leftover", { document: true, index: false });
    const snapshotRow = structuredClone(fakes.store.rows.get(FIXED_ID));
    const res = await del(FIXED_ID, fakes);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      memory: MemoryDocument;
      deleted: true;
    };
    expect(body.deleted).toBe(true);
    expect(body.memory).toEqual(snapshotRow);
    expect(fakes.store.rows.has(FIXED_ID)).toBe(false);
    expect(fakes.index.records.has(FIXED_ID)).toBe(false);

    const follow = await get(FIXED_ID, fakes);
    expect(follow.status).toBe(404);
    await expect(follow.json()).resolves.toEqual({
      error: ERROR_MEMORY_NOT_FOUND,
    });
  });

  it("removes an orphan index entry without inventing a success envelope", async () => {
    const fakes = createDeps();
    seedPair(fakes, FIXED_ID, "ghost", { document: false, index: true });
    await del(FIXED_ID, fakes);
    expect(fakes.index.records.has(FIXED_ID)).toBe(false);
    expect(fakes.store.rows.has(FIXED_ID)).toBe(false);
    expect(fakes.store.deletes).toBe(0);
  });

  it("deletes only the requested pair when two are seeded", async () => {
    const { fakes } = both([
      [FIXED_ID, "one"],
      [SECOND_ID, "two"],
    ]);
    const res = await del(FIXED_ID, fakes);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memory: { id: string } };
    expect(body.memory.id).toBe(FIXED_ID);
    expect(fakes.store.rows.has(FIXED_ID)).toBe(false);
    expect(fakes.index.records.has(FIXED_ID)).toBe(false);
    expect(fakes.store.rows.get(SECOND_ID)?.content).toBe("two");
    expect(fakes.index.records.has(SECOND_ID)).toBe(true);
  });

  it("returns 404 on a second delete after both sides are gone", async () => {
    const { fakes } = both();
    const first = await del(FIXED_ID, fakes);
    expect(first.status).toBe(200);
    const storeDeletes = fakes.store.deletes;
    const indexDeletes = fakes.index.deletes;
    const second = await del(FIXED_ID, fakes);
    expect(second.status).toBe(404);
    await expect(second.json()).resolves.toEqual({
      error: ERROR_MEMORY_NOT_FOUND,
    });
    expect(fakes.store.deletes).toBe(storeDeletes);
    expect(fakes.index.deletes).toBe(indexDeletes);
  });

  it("returns 405 for the wrong method on a known delete path", async () => {
    const { fakes } = both();
    const res = await del(FIXED_ID, fakes, { method: "PUT" });
    expect(res.status).toBe(405);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_METHOD_NOT_ALLOWED,
    });
    expect(fakes.store.rows.has(FIXED_ID)).toBe(true);
    expect(fakes.index.records.has(FIXED_ID)).toBe(true);
  });

  it("treats a trailing slash as the same delete", async () => {
    const { fakes } = both();
    const res = await appFor(fakes).request(
      `/v1/memories/${FIXED_ID}/`,
      { method: "DELETE", headers: { [API_KEY_HEADER]: KEY } },
      { API_KEY: KEY },
    );
    expect(res.status).toBe(200);
    expect(fakes.store.rows.has(FIXED_ID)).toBe(false);
    expect(fakes.index.records.has(FIXED_ID)).toBe(false);
  });
});
