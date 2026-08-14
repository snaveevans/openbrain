import {
  API_KEY_HEADER,
  DEFAULT_SOURCE,
  ERROR_API_KEY_NOT_CONFIGURED,
  ERROR_BODY_NOT_OBJECT,
  ERROR_CONTENT_EMPTY,
  ERROR_CONTENT_TOO_LARGE,
  ERROR_INVALID_JSON,
  ERROR_MEMORY_TOO_LARGE,
  ERROR_METADATA_OBJECT,
  ERROR_UNAUTHORIZED,
} from "@snaveevans/openbrain-common";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CACHE_CONTROL_NO_STORE } from "../src/http.js";
import {
  MAX_EMBED_CONTENT_CHARS,
  MAX_MEMORY_ROW_BYTES,
} from "../src/limits.js";
import {
  DOCUMENT_PREFIX,
  QUERY_PREFIX,
  WorkersAiEmbedder,
} from "../src/workers-ai-embedder.js";
import {
  createDeps,
  FIXED_ID,
  FIXED_NOW,
  SECOND_ID,
  TEST_MODEL,
} from "./fakes.js";

const KEY = "test-api-key";

function request(
  body: unknown,
  fakes = createDeps(),
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
  return createApp({ create: fakes.deps }).request(
    "/v1/memories",
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

function assertIdle(fakes: ReturnType<typeof createDeps>) {
  expect(fakes.store.rows.size).toBe(0);
  expect(fakes.index.records.size).toBe(0);
  expect(fakes.index.upserts).toBe(0);
  expect(fakes.embedder.calls).toBe(0);
}

describe("POST /v1/memories", () => {
  it("creates one memory and returns it as 201 { memory }", async () => {
    const fakes = createDeps();
    const res = await request(
      { content: "  hello  ", source: "note", metadata: { k: 1 } },
      fakes,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    const body = (await res.json()) as {
      memory: Record<string, unknown>;
    };
    expect(body).toEqual({
      memory: {
        id: FIXED_ID,
        content: "hello",
        source: "note",
        metadata: { k: 1 },
        created_at: FIXED_NOW.toISOString(),
        updated_at: FIXED_NOW.toISOString(),
        embedding_model: TEST_MODEL,
        embedded_at: FIXED_NOW.toISOString(),
      },
    });
    expect(body.memory).not.toHaveProperty("similarity");
    expect(JSON.stringify(body)).not.toContain("0.1");
    expect(fakes.embedder.lastRole).toBe("document");
    expect(fakes.embedder.lastText).toBe("hello");
    expect(fakes.store.rows.get(FIXED_ID)?.content).toBe("hello");
    expect(fakes.store.rows.get(FIXED_ID)?.content).toBe(
      fakes.embedder.lastText,
    );
    expect(fakes.index.records.get(FIXED_ID)?.source).toBe("note");
    expect(fakes.index.records.get(FIXED_ID)?.values).toEqual([0.1, 0.2, 0.3]);
  });

  it("defaults omitted source to manual and omitted metadata to {}", async () => {
    const res = await request({ content: "x" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      memory: { source: string; metadata: object };
    };
    expect(body.memory.source).toBe(DEFAULT_SOURCE);
    expect(body.memory.metadata).toEqual({});
  });

  it("treats empty and whitespace-only source as omitted", async () => {
    for (const source of ["", "   "]) {
      const res = await request({ content: "x", source });
      const body = (await res.json()) as { memory: { source: string } };
      expect(res.status).toBe(201);
      expect(body.memory.source).toBe(DEFAULT_SOURCE);
    }
  });

  it("stores provided metadata objects", async () => {
    const res = await request({
      content: "note",
      metadata: { tag: "v1" },
    });
    const body = (await res.json()) as { memory: { metadata: object } };
    expect(res.status).toBe(201);
    expect(body.memory.metadata).toEqual({ tag: "v1" });
  });

  it("rejects empty or whitespace-only content and stores nothing", async () => {
    for (const content of [undefined, "", "   ", "\n\t"]) {
      const fakes = createDeps();
      const res = await request(
        content === undefined ? {} : { content },
        fakes,
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: ERROR_CONTENT_EMPTY });
      assertIdle(fakes);
    }
  });

  it("rejects non-string content and stores nothing", async () => {
    for (const content of [null, 1, true, [], {}]) {
      const fakes = createDeps();
      const res = await request({ content }, fakes);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: ERROR_CONTENT_EMPTY });
      assertIdle(fakes);
    }
  });

  it("rejects metadata that is not an object", async () => {
    for (const metadata of [null, [], "nope", 1]) {
      const fakes = createDeps();
      const res = await request({ content: "note", metadata }, fakes);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: ERROR_METADATA_OBJECT,
      });
      assertIdle(fakes);
    }
  });

  it("rejects a valid JSON body that is not an object", async () => {
    for (const body of [[], "x", 42]) {
      const fakes = createDeps();
      const res = await request(body, fakes);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: ERROR_BODY_NOT_OBJECT,
      });
      assertIdle(fakes);
    }
  });

  it("rejects invalid JSON", async () => {
    for (const body of ["{", ""]) {
      const fakes = createDeps();
      const res = await request(undefined, fakes, {
        method: "POST",
        headers: {
          [API_KEY_HEADER]: KEY,
          "content-type": "application/json",
        },
        body,
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: ERROR_INVALID_JSON });
      assertIdle(fakes);
    }
  });

  it("rejects content larger than the embedder window", async () => {
    const fakes = createDeps();
    const res = await request(
      { content: "n".repeat(MAX_EMBED_CONTENT_CHARS + 1) },
      fakes,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_CONTENT_TOO_LARGE,
    });
    assertIdle(fakes);
  });

  it("rejects a document larger than the store row ceiling", async () => {
    const fakes = createDeps();
    const pad = "x".repeat(MAX_MEMORY_ROW_BYTES);
    const res = await request({ content: "ok", metadata: { pad } }, fakes);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_MEMORY_TOO_LARGE,
    });
    assertIdle(fakes);
  });

  it("ignores attacker-supplied server fields", async () => {
    const res = await request({
      content: "note",
      id: "attacker-id",
      embedding_model: "attacker-model",
      created_at: "1999-01-01T00:00:00.000Z",
      updated_at: "1999-01-01T00:00:00.000Z",
      embedded_at: "1999-01-01T00:00:00.000Z",
      similarity: 0.99,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { memory: Record<string, unknown> };
    expect(body.memory.id).toBe(FIXED_ID);
    expect(body.memory.embedding_model).toBe(TEST_MODEL);
    expect(body.memory.created_at).toBe(FIXED_NOW.toISOString());
    expect(body.memory.updated_at).toBe(FIXED_NOW.toISOString());
    expect(body.memory.embedded_at).toBe(FIXED_NOW.toISOString());
    expect(body.memory).not.toHaveProperty("similarity");
  });

  it("assigns a new id to each create", async () => {
    let n = 0;
    const ids = [FIXED_ID, SECOND_ID];
    const fakes = createDeps({ id: () => ids[n++] ?? "overflow" });
    const first = await request({ content: "one" }, fakes);
    const second = await request({ content: "two" }, fakes);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()) as { memory: { id: string } };
    const b = (await second.json()) as { memory: { id: string } };
    expect(a.memory.id).toBe(FIXED_ID);
    expect(b.memory.id).toBe(SECOND_ID);
    expect(fakes.store.rows.size).toBe(2);
    expect(fakes.index.records.size).toBe(2);
  });

  it("accepts a trimmed matching key", async () => {
    const fakes = createDeps();
    const res = await request({ content: "note" }, fakes, {
      headers: { [API_KEY_HEADER]: `  ${KEY}  ` },
    });
    expect(res.status).toBe(201);
    expect(fakes.store.rows.size).toBe(1);
  });

  it("returns 401 before parse when the key is missing", async () => {
    const fakes = createDeps();
    const res = await createApp({ create: fakes.deps }).request(
      "/v1/memories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
      { API_KEY: KEY },
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
    assertIdle(fakes);
  });

  it("returns 401 for empty, whitespace, and wrong keys before parse", async () => {
    for (const presented of ["", "   ", "nope"]) {
      const fakes = createDeps();
      const res = await createApp({ create: fakes.deps }).request(
        "/v1/memories",
        {
          method: "POST",
          headers: {
            [API_KEY_HEADER]: presented,
            "content-type": "application/json",
          },
          body: JSON.stringify({ content: "   " }),
        },
        { API_KEY: KEY },
      );
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
      assertIdle(fakes);
    }
  });

  it("returns 500 when the server key is missing and writes nothing", async () => {
    const fakes = createDeps();
    const res = await createApp({ create: fakes.deps }).request(
      "/v1/memories",
      {
        method: "POST",
        headers: {
          [API_KEY_HEADER]: KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ content: "note" }),
      },
      {},
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_API_KEY_NOT_CONFIGURED,
    });
    assertIdle(fakes);
  });

  it("does not accept the key from query, body, or Bearer", async () => {
    const fakes = createDeps();
    const viaQuery = await createApp({ create: fakes.deps }).request(
      `/v1/memories?api_key=${KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "note" }),
      },
      { API_KEY: KEY },
    );
    const viaBearer = await createApp({ create: fakes.deps }).request(
      "/v1/memories",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ content: "note" }),
      },
      { API_KEY: KEY },
    );
    const viaBody = await createApp({ create: fakes.deps }).request(
      "/v1/memories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "note", "x-api-key": KEY }),
      },
      { API_KEY: KEY },
    );
    expect(viaQuery.status).toBe(401);
    expect(viaBearer.status).toBe(401);
    expect(viaBody.status).toBe(401);
    assertIdle(fakes);
  });

  it("returns 500 and stores nothing when embed fails", async () => {
    const fakes = createDeps();
    fakes.embedder.failNext = true;
    const res = await request({ content: "secret-note" }, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toBe("embed failed");
    expect(body.error).not.toContain(KEY);
    expect(body.error).not.toContain("secret-note");
    expect(fakes.store.rows.size).toBe(0);
    expect(fakes.index.records.size).toBe(0);
    expect(fakes.index.upserts).toBe(0);
  });

  it("returns 500 and stores nothing when the embedder returns an empty vector", async () => {
    const fakes = createDeps();
    fakes.embedder.emptyNext = true;
    const res = await request({ content: "note" }, fakes);
    expect(res.status).toBe(500);
    expect(fakes.store.rows.size).toBe(0);
    expect(fakes.index.records.size).toBe(0);
  });

  it("returns 500 and deletes the vector when the store write fails", async () => {
    const fakes = createDeps();
    fakes.store.failNextInsert = true;
    const res = await request({ content: "note" }, fakes);
    expect(res.status).toBe(500);
    expect(fakes.store.rows.size).toBe(0);
    expect(fakes.index.records.size).toBe(0);
    expect(fakes.index.upserts).toBe(1);
    expect(fakes.index.deletes).toBe(1);
  });

  it("returns 500 and leaves no row when the index write fails", async () => {
    const fakes = createDeps();
    fakes.index.failNextUpsert = true;
    const res = await request({ content: "note" }, fakes);
    expect(res.status).toBe(500);
    expect(fakes.store.rows.size).toBe(0);
    expect(fakes.index.records.size).toBe(0);
    expect(fakes.embedder.calls).toBe(1);
  });

  it("does not store the API key on the memory", async () => {
    const fakes = createDeps();
    const res = await request({ content: "note" }, fakes);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text) as { memory: Record<string, unknown> };
    expect(body.memory).not.toHaveProperty("api_key");
    expect(JSON.stringify(fakes.store.rows.get(FIXED_ID))).not.toContain(KEY);
    expect(fakes.store.rows.get(FIXED_ID)).not.toHaveProperty("api_key");
  });
});

describe("WorkersAiEmbedder prefixes", () => {
  it("prepends the document prefix and reports the Gemma model", async () => {
    let seen: { model: string; text: string } | undefined;
    const ai: Ai = {
      async run(model, input) {
        seen = {
          model,
          text:
            typeof input.text === "string" ? input.text : (input.text[0] ?? ""),
        };
        return { data: [[0.4, 0.5]] };
      },
    };
    const result = await new WorkersAiEmbedder(ai).embed("hello", "document");
    expect(seen?.model).toBe("@cf/google/embeddinggemma-300m");
    expect(seen?.text).toBe(`${DOCUMENT_PREFIX}hello`);
    expect(result).toEqual({
      values: [0.4, 0.5],
      model: "@cf/google/embeddinggemma-300m",
    });
  });

  it("prepends the query prefix", async () => {
    let text = "";
    const ai: Ai = {
      async run(_model, input) {
        text =
          typeof input.text === "string" ? input.text : (input.text[0] ?? "");
        return { data: [[0.1]] };
      },
    };
    await new WorkersAiEmbedder(ai).embed("hello", "query");
    expect(text).toBe(`${QUERY_PREFIX}hello`);
  });

  it("rejects an empty embedding vector", async () => {
    const ai: Ai = {
      async run() {
        return { data: [[]] };
      },
    };
    await expect(
      new WorkersAiEmbedder(ai).embed("hello", "document"),
    ).rejects.toThrow("Embedding response did not include a vector.");
  });
});
