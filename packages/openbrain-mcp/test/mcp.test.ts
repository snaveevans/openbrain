import {
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  ERROR_UNAUTHORIZED,
} from "@snaveevans/openbrain-common";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { MCP_PROTOCOL_VERSION } from "../src/jsonrpc.js";
import { CACHE_CONTROL_NO_STORE } from "../src/http.js";
import {
  API_KEY,
  API_URL,
  CALLER_KEY,
  makeEnv,
  rpc,
  SAMPLE_BLOCK,
  SAMPLE_HIT,
  SAMPLE_HIT_BLOCK,
  SAMPLE_MEMORY,
  seedToken,
  sha256Hex,
  VALID_TOKEN,
} from "./helpers.js";
import { FakeKV, FakeRest } from "./fakes.js";

/** App + env with a seeded valid BYOK token. `rest` is injectable. */
async function setup(rest = new FakeRest()) {
  const kv = new FakeKV();
  await seedToken(kv, VALID_TOKEN);
  return { app: createApp({ rest }), env: makeEnv(kv), rest, kv };
}

const asJson = (res: Response) =>
  res.json() as Promise<Record<string, unknown>>;

describe("BYOK bearer gate", () => {
  it("runs before domain work: no Authorization → 401, zero upstream", async () => {
    const { app, env, rest } = await setup();
    const res = await app.request(
      "/mcp",
      rpc("tools/call", { name: "search_memories", arguments: { query: "x" } }),
      env,
    );
    expect(res.status).toBe(401);
    expect(rest.requestCount).toBe(0);
  });

  it("does not accept x-api-key as a caller credential (no backdoor)", async () => {
    const { app, env, rest } = await setup();
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { xApiKey: CALLER_KEY },
      ),
      env,
    );
    expect(res.status).toBe(401);
    expect(rest.requestCount).toBe(0);
  });

  it("does not accept the raw API key as a Bearer token", async () => {
    const { app, env, rest } = await setup();
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: API_KEY },
      ),
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain(
      'error="invalid_token"',
    );
    expect(rest.requestCount).toBe(0);
  });

  it("does not accept a JWT as a bearer in S1 (KV-only — a JWT is a KV miss)", async () => {
    const { app, env, rest } = await setup();
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.signature-not-validated";
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: jwt },
      ),
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain(
      'error="invalid_token"',
    );
    expect(rest.requestCount).toBe(0);
  });

  it("fails closed: a KV error is 500 (never 200/202), zero upstream", async () => {
    const rest = new FakeRest();
    const kv = new FakeKV();
    await seedToken(kv, VALID_TOKEN);
    kv.failNextGet = true;
    const app = createApp({ rest });
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: VALID_TOKEN },
      ),
      makeEnv(kv),
    );
    expect(res.status).toBe(500);
    expect(rest.requestCount).toBe(0);
  });

  it("returns byte-identical 401 bodies for missing vs rejected; the challenge differs", async () => {
    const { app, env } = await setup();
    // (a) missing bearer — no error= in the challenge
    const missing = await app.request(
      "/mcp",
      rpc("tools/call", { name: "search_memories", arguments: { query: "x" } }),
      env,
    );
    expect(missing.status).toBe(401);
    const missingChallenge = missing.headers.get("WWW-Authenticate") ?? "";
    expect(missingChallenge).not.toContain("error=");
    expect(missingChallenge).toContain("resource_metadata=");
    const missingBody = await missing.text();

    // (b) rejected bearer (unknown opaque string) — error="invalid_token"
    const rejected = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: "unknown-opaque-token" },
      ),
      env,
    );
    expect(rejected.status).toBe(401);
    const rejectedChallenge = rejected.headers.get("WWW-Authenticate") ?? "";
    expect(rejectedChallenge).toContain('error="invalid_token"');
    expect(await rejected.text()).toBe(missingBody);
    // The body is the house envelope, generic — never says which check failed.
    expect(JSON.parse(missingBody)).toEqual({ error: ERROR_UNAUTHORIZED });
  });

  it("accepts an operator-minted token present in KV", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { matches: [] });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(rest.requestCount).toBe(1);
  });
});

describe("credential substitution", () => {
  it("calls REST with the Worker's own API key and never forwards the caller credential", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { matches: [] });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x" } },
        { bearer: VALID_TOKEN, xApiKey: CALLER_KEY },
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(rest.requestCount).toBe(1);
    const upstream = rest.last as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string | undefined;
    };
    expect(upstream.headers["x-api-key"]).toBe(API_KEY);
    expect(upstream.headers["authorization"]).toBeUndefined();
    expect(upstream.headers["Authorization"]).toBeUndefined();
    const serialized = [
      upstream.method,
      upstream.url,
      JSON.stringify(upstream.headers),
      upstream.body ?? "",
    ].join("\n");
    expect(serialized).not.toContain(CALLER_KEY);
  });
});

describe("tool → REST mapping", () => {
  it("search_memories → POST {api}/memories/search with the worker key + JSON body", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { matches: [] });
    const { app, env } = await setup(rest);
    await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "x", limit: 5 } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const upstream = rest.last as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string | undefined;
    };
    expect(upstream.method).toBe("POST");
    expect(upstream.url).toBe(`${API_URL}/memories/search`);
    expect(upstream.headers["content-type"]).toBe("application/json");
    expect(upstream.headers["x-api-key"]).toBe(API_KEY);
    expect(JSON.parse(upstream.body as string)).toEqual({
      query: "x",
      limit: 5,
    });
  });

  it("fetch → GET {api}/memories/{id} with the worker key, no body, no content-type", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { memory: SAMPLE_MEMORY });
    const { app, env } = await setup(rest);
    await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const upstream = rest.last as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string | undefined;
    };
    expect(upstream.method).toBe("GET");
    expect(upstream.url).toBe(`${API_URL}/memories/${SAMPLE_MEMORY.id}`);
    expect(upstream.headers["x-api-key"]).toBe(API_KEY);
    expect(upstream.headers["content-type"]).toBeUndefined();
    expect(upstream.body).toBeUndefined();
  });

  it("create_memory → POST {api}/memories with the worker key + JSON body", async () => {
    const rest = new FakeRest();
    rest.respondJson(201, { memory: SAMPLE_MEMORY });
    const { app, env } = await setup(rest);
    await app.request(
      "/mcp",
      rpc(
        "tools/call",
        {
          name: "create_memory",
          arguments: { content: "hello", source: "cli" },
        },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const upstream = rest.last as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string | undefined;
    };
    expect(upstream.method).toBe("POST");
    expect(upstream.url).toBe(`${API_URL}/memories`);
    expect(upstream.headers["content-type"]).toBe("application/json");
    expect(upstream.headers["x-api-key"]).toBe(API_KEY);
    expect(JSON.parse(upstream.body as string)).toEqual({
      content: "hello",
      source: "cli",
    });
  });

  it("delete_memory → DELETE {api}/memories/{id} with the worker key, no body", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { memory: SAMPLE_MEMORY, deleted: true });
    const { app, env } = await setup(rest);
    await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "delete_memory", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const upstream = rest.last as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string | undefined;
    };
    expect(upstream.method).toBe("DELETE");
    expect(upstream.url).toBe(`${API_URL}/memories/${SAMPLE_MEMORY.id}`);
    expect(upstream.headers["x-api-key"]).toBe(API_KEY);
    expect(upstream.headers["content-type"]).toBeUndefined();
    expect(upstream.body).toBeUndefined();
  });
});

describe("REST 404 is absence-as-data (not a tool failure)", () => {
  it("fetch 404 → 200, no isError, text 'Memory <id> was not found.'", async () => {
    const rest = new FakeRest();
    rest.respondJson(404, { error: "Memory not found." });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = await asJson(res);
    const result = body.result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe(
      `Memory ${SAMPLE_MEMORY.id} was not found.`,
    );
  });

  it("delete_memory 404 → same normal result", async () => {
    const rest = new FakeRest();
    rest.respondJson(404, { error: "Memory not found." });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "delete_memory", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = await asJson(res);
    const result = body.result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe(
      `Memory ${SAMPLE_MEMORY.id} was not found.`,
    );
  });
});

describe("tools/call envelope + error translation", () => {
  it("success → 200, { content: [{ type: 'text', text }] }, no isError, no-store", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { memory: SAMPLE_MEMORY });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    const body = await asJson(res);
    const result = body.result as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    expect(result.content[0].type).toBe("text");
    expect(result.isError).toBeUndefined();
  });

  it("REST 400 → 200 + isError: true with the server error string verbatim", async () => {
    const rest = new FakeRest();
    rest.respondJson(400, { error: "`content` must be a non-empty string." });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "create_memory", arguments: { content: "   " } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = await asJson(res);
    const result = body.result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "`content` must be a non-empty string.",
    );
  });

  it("REST 401 (worker's own key wrong) → 200 + isError: true with 'Unauthorized.'", async () => {
    const rest = new FakeRest();
    rest.respondJson(401, { error: "Unauthorized." });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const body = await asJson(res);
    const result = body.result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Unauthorized.");
  });

  it("REST 500 → 200 + isError: true with the server error string", async () => {
    const rest = new FakeRest();
    rest.respondJson(500, { error: "Internal error." });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const body = await asJson(res);
    const result = body.result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Internal error.");
  });

  it("REST unreachable (throws) → 200 + isError: true", async () => {
    const rest = new FakeRest();
    rest.throw("network down");
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = await asJson(res);
    const result = body.result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
  });
});

describe("agent-facing renderings", () => {
  it("fetch success → memory-model text (no similarity)", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { memory: SAMPLE_MEMORY });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const body = await asJson(res);
    expect(
      (body.result as { content: { text: string }[] }).content[0].text,
    ).toBe(SAMPLE_BLOCK);
  });

  it("create_memory success → memory-model text of the created memory", async () => {
    const rest = new FakeRest();
    rest.respondJson(201, { memory: SAMPLE_MEMORY });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "create_memory", arguments: { content: "hello world" } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const body = await asJson(res);
    expect(
      (body.result as { content: { text: string }[] }).content[0].text,
    ).toBe(SAMPLE_BLOCK);
  });

  it("delete_memory success → 'Memory <id> was deleted.' + blank line + memory-model text", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { memory: SAMPLE_MEMORY, deleted: true });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "delete_memory", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const body = await asJson(res);
    expect(
      (body.result as { content: { text: string }[] }).content[0].text,
    ).toBe(`Memory ${SAMPLE_MEMORY.id} was deleted.\n\n${SAMPLE_BLOCK}`);
  });

  it("search_memories non-empty → hits numbered from 1, separated by ---", async () => {
    const rest = new FakeRest();
    const second = {
      ...SAMPLE_HIT,
      id: "00000000-0000-4000-8000-000000000002",
      similarity: 0.5,
    };
    rest.respondJson(200, { matches: [SAMPLE_HIT, second] });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "hello" } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const body = await asJson(res);
    const text = (body.result as { content: { text: string }[] }).content[0]
      .text;
    const secondBlock = SAMPLE_HIT_BLOCK.replace(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ).replace("similarity: 0.8000", "similarity: 0.5000");
    expect(text).toBe(`1.\n${SAMPLE_HIT_BLOCK}\n---\n2.\n${secondBlock}`);
  });

  it("search_memories zero hits → 'No memories matched \"<query>\".'", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { matches: [] });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "search_memories", arguments: { query: "hello" } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const body = await asJson(res);
    expect(
      (body.result as { content: { text: string }[] }).content[0].text,
    ).toBe('No memories matched "hello".');
  });
});

describe("id URL-encoding", () => {
  it("encodes id as a single path segment; REST 400 → isError with the UUID message", async () => {
    const rest = new FakeRest();
    rest.respondJson(400, { error: "`id` must be a valid UUID v4." });
    const { app, env } = await setup(rest);
    const res = await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: "../foo" } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    const upstream = rest.last as { url: string };
    expect(upstream.url).toBe(`${API_URL}/memories/..%2Ffoo`);
    const body = await asJson(res);
    const result = body.result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("`id` must be a valid UUID v4.");
  });

  it("forwards a real UUID unchanged", async () => {
    const rest = new FakeRest();
    rest.respondJson(200, { memory: SAMPLE_MEMORY });
    const { app, env } = await setup(rest);
    await app.request(
      "/mcp",
      rpc(
        "tools/call",
        { name: "fetch", arguments: { id: SAMPLE_MEMORY.id } },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect((rest.last as { url: string }).url).toBe(
      `${API_URL}/memories/${SAMPLE_MEMORY.id}`,
    );
  });
});

describe("MCP method set (stateless)", () => {
  it("initialize → protocol version + tools capability (nothing else), no session id", async () => {
    const { app, env } = await setup();
    const res = await app.request(
      "/mcp",
      rpc(
        "initialize",
        {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
        { bearer: VALID_TOKEN },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = await asJson(res);
    const result = body.result as {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string };
    };
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(Object.keys(result.capabilities)).toEqual(["tools"]);
    expect(result.capabilities.tools).toEqual({});
    expect(result.serverInfo.name).toBe("openbrain-mcp");
    expect(res.headers.get("Mcp-Session-Id")).toBeNull();
  });

  it("ping → success with an empty result, no error", async () => {
    const { app, env } = await setup();
    const res = await app.request(
      "/mcp",
      rpc("ping", {}, { bearer: VALID_TOKEN }),
      env,
    );
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.result).toEqual({});
    expect(body.error).toBeUndefined();
    expect(res.headers.get("Mcp-Session-Id")).toBeNull();
  });
});

describe("POST-only /mcp + routing", () => {
  it("GET /mcp → 405 with the JSON error envelope, no SSE", async () => {
    const app = createApp();
    const res = await app.request(
      "/mcp",
      { method: "GET" },
      makeEnv(new FakeKV()),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type") ?? "").toMatch(/json/);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_METHOD_NOT_ALLOWED,
    });
  });

  it("PUT /mcp → 405 (one mechanism for all non-POST)", async () => {
    const app = createApp();
    const res = await app.request(
      "/mcp",
      { method: "PUT", body: "x" },
      makeEnv(new FakeKV()),
    );
    expect(res.status).toBe(405);
    await expect(res.json()).resolves.toEqual({
      error: ERROR_METHOD_NOT_ALLOWED,
    });
  });

  it("unknown non-MCP path → 404 { error: 'Not found.' }", async () => {
    const app = createApp();
    const res = await app.request(
      "/bogus",
      { method: "GET" },
      makeEnv(new FakeKV()),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: ERROR_NOT_FOUND });
  });
});

describe("tools/list", () => {
  it("advertises the four tools by exact name", async () => {
    const { app, env } = await setup();
    const res = await app.request(
      "/mcp",
      rpc("tools/list", {}, { bearer: VALID_TOKEN }),
      env,
    );
    const body = await asJson(res);
    const tools = (body.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      "search_memories",
      "fetch",
      "create_memory",
      "delete_memory",
    ]);
  });
});

describe("sha256Hex", () => {
  it("hashes to a stable 64-char hex", async () => {
    const hash = await sha256Hex(VALID_TOKEN);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Same input → same hash; different input → different hash.
    expect(await sha256Hex(VALID_TOKEN)).toBe(hash);
    expect(await sha256Hex("other")).not.toBe(hash);
  });
});
