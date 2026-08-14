import {
  API_KEY_HEADER,
  DEFAULT_SOURCE,
  ERROR_CONTENT_EMPTY,
  ERROR_INVALID_JSON,
  ERROR_METADATA_OBJECT,
  ERROR_UNAUTHORIZED,
} from "@snaveevans/openbrain-common";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  DOCUMENT_PREFIX,
  QUERY_PREFIX,
  WorkersAiEmbedder,
} from "../src/workers-ai-embedder.js";
import { createDeps, FIXED_ID, FIXED_NOW, TEST_MODEL } from "./fakes.js";

const KEY = "test-api-key";

function request(body: unknown, deps = createDeps(), init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has(API_KEY_HEADER)) {
    headers.set(API_KEY_HEADER, KEY);
  }
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return createApp({ create: deps.deps }).request(
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
    { API_KEY: KEY },
  );
}

describe("POST /v1/memories", () => {
  it("creates one memory and returns it as 201 { memory }", async () => {
    const fakes = createDeps();
    const res = await request({ content: "  a note  ", source: "cli" }, fakes);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      memory: {
        id: FIXED_ID,
        content: "a note",
        source: "cli",
        metadata: {},
        created_at: FIXED_NOW.toISOString(),
        updated_at: FIXED_NOW.toISOString(),
        embedding_model: TEST_MODEL,
        embedded_at: FIXED_NOW.toISOString(),
      },
    });
    expect(fakes.embedder.lastRole).toBe("document");
    expect(fakes.embedder.lastText).toBe("a note");
    expect(fakes.store.rows.get(FIXED_ID)?.content).toBe("a note");
    expect(fakes.index.records.get(FIXED_ID)?.source).toBe("cli");
  });

  it("defaults omitted source to manual and omitted metadata to {}", async () => {
    const res = await request({ content: "note" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      memory: { source: string; metadata: object };
    };
    expect(body.memory.source).toBe(DEFAULT_SOURCE);
    expect(body.memory.metadata).toEqual({});
  });

  it("treats empty source as omitted", async () => {
    const res = await request({ content: "note", source: "   " });
    const body = (await res.json()) as { memory: { source: string } };
    expect(res.status).toBe(201);
    expect(body.memory.source).toBe(DEFAULT_SOURCE);
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
    const fakes = createDeps();
    const res = await request({ content: "   " }, fakes);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: ERROR_CONTENT_EMPTY });
    expect(fakes.store.rows.size).toBe(0);
    expect(fakes.index.records.size).toBe(0);
  });

  it("rejects metadata that is null or an array", async () => {
    for (const metadata of [null, []]) {
      const fakes = createDeps();
      const res = await request({ content: "note", metadata }, fakes);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: ERROR_METADATA_OBJECT,
      });
      expect(fakes.store.rows.size).toBe(0);
    }
  });

  it("rejects invalid JSON", async () => {
    const res = await request(undefined, createDeps(), {
      method: "POST",
      headers: {
        [API_KEY_HEADER]: KEY,
        "content-type": "application/json",
      },
      body: "{",
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: ERROR_INVALID_JSON });
  });

  it("returns 401 before creating when the key is missing", async () => {
    const fakes = createDeps();
    const res = await createApp({ create: fakes.deps }).request(
      "/v1/memories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "note" }),
      },
      { API_KEY: KEY },
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: ERROR_UNAUTHORIZED });
    expect(fakes.store.rows.size).toBe(0);
  });

  it("returns 500 and stores nothing when embed fails", async () => {
    const fakes = createDeps();
    fakes.embedder.failNext = true;
    const res = await request({ content: "note" }, fakes);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("embed failed");
    expect(fakes.store.rows.size).toBe(0);
    expect(fakes.index.records.size).toBe(0);
  });

  it("returns 500 when the store write fails after embed", async () => {
    const fakes = createDeps();
    fakes.store.failNextInsert = true;
    const res = await request({ content: "note" }, fakes);
    expect(res.status).toBe(500);
    expect(fakes.store.rows.size).toBe(0);
    expect(fakes.index.records.size).toBe(0);
  });

  it("returns 500 and rolls back the row when the index write fails", async () => {
    const fakes = createDeps();
    fakes.index.failNextUpsert = true;
    const res = await request({ content: "note" }, fakes);
    expect(res.status).toBe(500);
    expect(fakes.store.rows.size).toBe(0);
    expect(fakes.index.records.size).toBe(0);
  });

  it("does not store the API key on the memory", async () => {
    const res = await request({ content: "note" });
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).memory).not.toHaveProperty("api_key");
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
});
