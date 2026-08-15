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

function seeded(ids: Array<[string, string]> = [[FIXED_ID, "hello"]]) {
  const fakes = createDeps();
  for (const [id, content] of ids) {
    fakes.store.rows.set(id, document(id, content));
  }
  const getsBefore = fakes.store.gets;
  return { fakes, getsBefore };
}

function request(
  id: string,
  fakes: ReturnType<typeof createDeps>,
  init: RequestInit = {},
  bindings: { API_KEY?: string } = { API_KEY: KEY },
) {
  const headers = new Headers(init.headers);
  if (!headers.has(API_KEY_HEADER)) {
    headers.set(API_KEY_HEADER, KEY);
  }
  return createApp({
    create: fakes.deps,
    store: fakes.store,
  }).request(
    `/v1/memories/${id}`,
    {
      method: "GET",
      ...init,
      headers,
    },
    bindings,
  );
}

function assertReadOnly(
  fakes: ReturnType<typeof createDeps>,
  rowCount: number,
) {
  expect(fakes.store.rows.size).toBe(rowCount);
  expect(fakes.store.inserts).toBe(0);
  expect(fakes.store.deletes).toBe(0);
  expect(fakes.embedder.calls).toBe(0);
  expect(fakes.index.upserts).toBe(0);
  expect(fakes.index.deletes).toBe(0);
}

describe("GET /v1/memories/{id}", () => {
  it("returns the seeded memory as 200 { memory }", async () => {
    const { fakes } = seeded();
    const snapshot = structuredClone(fakes.store.rows.get(FIXED_ID));
    const res = await request(FIXED_ID, fakes);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    const body = (await res.json()) as {
      memory: MemoryDocument;
    };
    expect(Object.keys(body)).toEqual(["memory"]);
    expect(body.memory).toEqual(snapshot);
    expect(body.memory).not.toHaveProperty("similarity");
    expect(body.memory.embedding_model).toBe(TEST_MODEL);
    expect(body.memory.embedded_at).toBe(FIXED_NOW.toISOString());
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(fakes.store.rows.get(FIXED_ID)).toEqual(snapshot);
    assertReadOnly(fakes, 1);
  });

  it("returns 404 Memory not found for an unknown UUID v4", async () => {
    const { fakes, getsBefore } = seeded();
    const res = await request(SECOND_ID, fakes);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_MEMORY_NOT_FOUND,
    });
    expect(ERROR_MEMORY_NOT_FOUND).not.toBe("Not found.");
    expect(fakes.store.gets).toBe(getsBefore + 1);
    assertReadOnly(fakes, 1);
  });

  it("rejects paths that are not UUID v4 before lookup", async () => {
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
      const { fakes, getsBefore } = seeded();
      const res = await request(id, fakes);
      expect(res.status, id).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: ERROR_ID_UUID });
      expect(fakes.store.gets).toBe(getsBefore);
      assertReadOnly(fakes, 1);
    }
  });

  it("looks up the path string exactly and does not rewrite case", async () => {
    const { fakes } = seeded([[MIXED_ID, "cased"]]);
    const hit = await request(MIXED_ID, fakes);
    expect(hit.status).toBe(200);
    const body = (await hit.json()) as { memory: { id: string } };
    expect(body.memory.id).toBe(MIXED_ID);

    const miss = await request(MIXED_ID.toUpperCase(), fakes);
    expect(miss.status).toBe(404);
    await expect(miss.json()).resolves.toEqual({
      error: ERROR_MEMORY_NOT_FOUND,
    });
    expect(fakes.store.gets).toBe(2);
    assertReadOnly(fakes, 1);
  });

  it("returns 401 before UUID check when the key is missing", async () => {
    const { fakes, getsBefore } = seeded();
    const res = await createApp({
      create: fakes.deps,
      store: fakes.store,
    }).request("/v1/memories/not-a-uuid", { method: "GET" }, { API_KEY: KEY });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
    expect(fakes.store.gets).toBe(getsBefore);
    assertReadOnly(fakes, 1);
  });

  it("returns 401 for empty, whitespace, and wrong keys before read", async () => {
    for (const presented of ["", "   ", "nope"]) {
      const { fakes, getsBefore } = seeded();
      const res = await request(FIXED_ID, fakes, {
        headers: { [API_KEY_HEADER]: presented },
      });
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
      expect(fakes.store.gets).toBe(getsBefore);
      assertReadOnly(fakes, 1);
    }
  });

  it("returns 500 when the server key is missing and does not read", async () => {
    const { fakes, getsBefore } = seeded();
    const res = await request(FIXED_ID, fakes, {}, {});
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_API_KEY_NOT_CONFIGURED,
    });
    expect(fakes.store.gets).toBe(getsBefore);
    assertReadOnly(fakes, 1);
  });

  it("returns 500 when the server key is whitespace and does not read", async () => {
    const { fakes, getsBefore } = seeded();
    const res = await request(FIXED_ID, fakes, {}, { API_KEY: "   " });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_API_KEY_NOT_CONFIGURED,
    });
    expect(fakes.store.gets).toBe(getsBefore);
    assertReadOnly(fakes, 1);
  });

  it("does not accept the key from query, body, or Bearer", async () => {
    const { fakes, getsBefore } = seeded();
    const viaQuery = await createApp({
      create: fakes.deps,
      store: fakes.store,
    }).request(
      `/v1/memories/${FIXED_ID}?api_key=${KEY}`,
      { method: "GET" },
      { API_KEY: KEY },
    );
    const viaBearer = await createApp({
      create: fakes.deps,
      store: fakes.store,
    }).request(
      `/v1/memories/${FIXED_ID}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${KEY}` },
      },
      { API_KEY: KEY },
    );
    const viaBody = await createApp({
      create: fakes.deps,
      store: fakes.store,
    }).request(
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
    expect(fakes.store.gets).toBe(getsBefore);
    assertReadOnly(fakes, 1);
  });

  it("accepts a trimmed matching key", async () => {
    const { fakes } = seeded();
    const res = await request(FIXED_ID, fakes, {
      headers: { [API_KEY_HEADER]: `  ${KEY}  ` },
    });
    expect(res.status).toBe(200);
    assertReadOnly(fakes, 1);
  });

  it("returns 500 on store read failure and leaves the row", async () => {
    const { fakes } = seeded();
    const snapshot = structuredClone(fakes.store.rows.get(FIXED_ID));
    fakes.store.failNextGet = true;
    const res = await request(FIXED_ID, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toBe("store read failed");
    expect(body.error).not.toContain(KEY);
    expect(body.error).not.toContain("hello");
    expect(fakes.store.rows.get(FIXED_ID)).toEqual(snapshot);
    expect(fakes.store.inserts).toBe(0);
    expect(fakes.store.deletes).toBe(0);
    expect(fakes.embedder.calls).toBe(0);
    expect(fakes.index.upserts).toBe(0);
    expect(fakes.index.deletes).toBe(0);

    const retry = await request(FIXED_ID, fakes);
    expect(retry.status).toBe(200);
    const again = (await retry.json()) as { memory: MemoryDocument };
    expect(again.memory).toEqual(snapshot);
  });

  it("returns only the requested row when two are seeded", async () => {
    const { fakes } = seeded([
      [FIXED_ID, "one"],
      [SECOND_ID, "two"],
    ]);
    const a = await request(FIXED_ID, fakes);
    const b = await request(SECOND_ID, fakes);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const first = (await a.json()) as {
      memory: { id: string; content: string };
    };
    const second = (await b.json()) as {
      memory: { id: string; content: string };
    };
    expect(first.memory).toEqual(
      expect.objectContaining({ id: FIXED_ID, content: "one" }),
    );
    expect(second.memory).toEqual(
      expect.objectContaining({ id: SECOND_ID, content: "two" }),
    );
    assertReadOnly(fakes, 2);
  });

  it("returns 405 for the wrong method on a known fetch path", async () => {
    const { fakes } = seeded();
    const res = await request(FIXED_ID, fakes, { method: "PUT" });
    expect(res.status).toBe(405);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_METHOD_NOT_ALLOWED,
    });
    assertReadOnly(fakes, 1);
  });

  it("treats a trailing slash as the same fetch", async () => {
    const { fakes } = seeded();
    const res = await createApp({
      create: fakes.deps,
      store: fakes.store,
    }).request(
      `/v1/memories/${FIXED_ID}/`,
      { method: "GET", headers: { [API_KEY_HEADER]: KEY } },
      { API_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memory: { id: string } };
    expect(body.memory.id).toBe(FIXED_ID);
  });
});
