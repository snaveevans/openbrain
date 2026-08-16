/**
 * Integration tests for the Open Brain REST Worker (issue #22, ADR-0007).
 *
 * Boots the real production Worker under workerd with remote dev bindings
 * (Vectorize `openbrain-memories-dev`, Workers AI EmbeddingGemma) and local
 * D1. Each P0 row below corresponds to a row in the issue's test plan:
 *
 *   P0.1 health         – GET /v1/health reaches the real Worker.
 *   P0.2 create->index  – POST then verify the vector landed in Vectorize.
 *   P0.3 search rank    – search returns the just-created id.
 *   P0.4 source filter  – two sources; filtering by one excludes the other.
 *   P0.5 delete cleanup – DELETE removes the D1 row AND the vector.
 *   P0.6 dev-vs-prod    – the dev Worker is bound to the dev index, not prod.
 *   P0.7 no leftovers    – after the run, no captured vector remains.
 *   P0.8 fail-hard      – missing Cloudflare creds throws before listen().
 *
 * Isolation: every vector is created under a per-run source prefix
 * `t:<runId>:<tag>` so concurrent runs and cross-case bleed cannot collide.
 * Vectors are deleted from the remote index in afterEach; P0.7 verifies the
 * final sweep. D1 is wiped + re-migrated per case.
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  bootHarness,
  resetAndMigrate,
  vectorExists,
  vectorGone,
  waitFor,
  type HarnessContext,
} from "./harness.js";

const RUN_ID = process.env.OPENBRAIN_RUN_ID ?? randomUUID();
const SOURCE_PREFIX = `t:${RUN_ID}`;
const source = (tag: string) => `${SOURCE_PREFIX}:${tag}`;

// The embedder model the dev Worker must use (ADR-0006 chose EmbeddingGemma).
// Hardcoded — not imported from src — so a Worker deployed bound to any other
// dimension-compatible embedder (e.g. @cf/baai/bge-base-en-v1.5, also 768-d)
// fails here. This is the vendor-path bug ADR-0007 says this suite exists to
// catch; `embedding_model` is the only observable signal (the fake suite uses
// TEST_MODEL and can't see it).
const EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";

// Lag-retry budget. A direct-binding diagnostic (upsert → getByIds, no
// Worker/AI) measured the openbrain-memories-dev index's eventual-
// consistency window at ~40–50s (vectors appear at +39s and +49s across two
// runs). That is abnormally slow for Vectorize and is being tracked as a
// separate dev-index concern; until it is addressed, the budget must sit
// above ~50s to avoid chronic flakiness. 60s covers the observed range with
// margin and still catches the ship-blocker (a vector that never appears) and
// a severe regression (latency ballooning past 60s). See ADR-0007 ruling 5.
const WAIT = { timeoutMs: 60_000, intervalMs: 5_000 } as const;

// Cumulative set of every vector id created across the whole run. P0.7
// asserts the remote index holds none of these once the suite is done, and
// afterEach deletes each case's slice.
const allCapturedIds = new Set<string>();
// Per-case ids; afterEach cleans exactly these (continue-on-failure).
let caseCapturedIds: string[] = [];

let ctx: HarnessContext | null = null;
const cleanupFailures: string[] = [];

beforeAll(async () => {
  ctx = await bootHarness();
});

beforeEach(async () => {
  if (!ctx) throw new Error("harness not booted");
  await resetAndMigrate(ctx);
  caseCapturedIds = [];
});

afterEach(async () => {
  // Per-case vector cleanup against the remote dev index. Reset() does not
  // touch remote bindings, so this is the only thing that removes vectors
  // between cases. Continue past per-id failures (the loop does not stop on
  // the first error) and collect them all; P0.7 reports the aggregate so a
  // leftover is a clear suite failure rather than a silent leak.
  const ids = caseCapturedIds;
  caseCapturedIds = [];
  if (!ctx) return;
  for (const id of ids) {
    try {
      await ctx.vectorize.deleteByIds([id]);
    } catch (error) {
      cleanupFailures.push(
        `${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
});

describe("openbrain integration (dev bindings)", () => {
  it("P0.1 GET /v1/health reaches the real Worker and reports the service", async () => {
    const res = await req("/v1/health", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, service: "openbrain" });
  });

  it("P0.2 POST /v1/memories writes a vector to the remote dev Vectorize", async () => {
    const createRes = await req("/v1/memories", {
      method: "POST",
      body: JSON.stringify({
        content: "The integration suite embeds this note about openbrain.",
        source: source("p02"),
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      memory: { id: string; embedding_model?: string };
    };
    const id = created.memory.id;
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    // Pin the real embedder model — the vendor-path signal ADR-0007 exists to
    // catch. A 768-d imposter model would otherwise ship green.
    expect(created.memory.embedding_model).toBe(EMBEDDING_MODEL);
    capture(id);

    await waitFor(() => vectorExists(ctx!.vectorize, id), {
      ...WAIT,
      label: `P0.2 vector upsert ${id}`,
    });
  });

  it("P0.3 POST /v1/memories/search ranks the just-created memory", async () => {
    const createRes = await req("/v1/memories", {
      method: "POST",
      body: JSON.stringify({
        content: "EmbeddingGemma turns this sentence into a vector.",
        source: source("p03"),
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { memory: { id: string } };
    const id = created.memory.id;
    capture(id);

    // Wait until the index can find the just-upserted vector via ANN search.
    await waitFor(
      async () => {
        const res = await req("/v1/memories/search", {
          method: "POST",
          body: JSON.stringify({
            query: "sentence into a vector",
            limit: 10,
            source: source("p03"),
          }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { matches: Array<{ id: string }> };
        return body.matches.some((m) => m.id === id);
      },
      { ...WAIT, label: `P0.3 search ranks ${id}` },
    );
  });

  it("P0.4 source filter: searching one source excludes the other", async () => {
    const a = await createMemory("alpha memory about sorting", source("p04-a"));
    const b = await createMemory("beta memory about hashing", source("p04-b"));
    capture(a.id, b.id);

    // B must actually be stored, else its absence from A's results would be
    // vacuous rather than proof of the filter.
    await waitFor(() => vectorExists(ctx!.vectorize, b.id), {
      ...WAIT,
      label: `P0.4 index B ${b.id}`,
    });

    // Wait until A is queryable through the ANN index under its own source
    // (getByIds storage can lag behind ANN queryability), and capture the
    // exact match set that contained A. Asserting on that same set avoids a
    // racy second search — ANN results can differ between back-to-back calls
    // while the just-upserted vector settles.
    const bodyA = await waitFor(
      async () => {
        const res = await req("/v1/memories/search", {
          method: "POST",
          body: JSON.stringify({
            query: "memory",
            limit: 25,
            source: source("p04-a"),
          }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { matches: Array<{ id: string }> };
        return body.matches.some((m) => m.id === a.id) ? body : null;
      },
      { ...WAIT, label: `P0.4 A queryable ${a.id}` },
    );

    // Correctness, not lag: the `source` metadata filter is set at upsert, so
    // if B (source p04-b) leaks through a p04-a filter it is a real bug.
    if (!bodyA) throw new Error("P0.4: waitFor returned without a match set");
    const idsA = new Set(bodyA.matches.map((m) => m.id));
    expect(idsA.has(a.id)).toBe(true);
    expect(idsA.has(b.id)).toBe(false);
  });

  it("P0.5 DELETE /v1/memories/:id removes the row and the vector", async () => {
    const created = await createMemory(
      "this memory is slated for deletion",
      source("p05"),
    );
    capture(created.id);

    await waitFor(() => vectorExists(ctx!.vectorize, created.id), {
      ...WAIT,
      label: `P0.5 index ${created.id}`,
    });

    const delRes = await req(`/v1/memories/${created.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const deleted = (await delRes.json()) as {
      memory: { id: string };
      deleted: boolean;
    };
    expect(deleted.deleted).toBe(true);
    expect(deleted.memory.id).toBe(created.id);

    // Row is gone.
    const getRes = await req(`/v1/memories/${created.id}`, { method: "GET" });
    expect(getRes.status).toBe(404);

    // Vector is gone (eventual consistency → retry).
    await waitFor(() => vectorGone(ctx!.vectorize, created.id), {
      ...WAIT,
      label: `P0.5 vector gone ${created.id}`,
    });

    // It was deleted by the endpoint, so don't let afterEach double-delete.
    release(created.id);
  });

  it("P0.6 the dev Worker is bound to the dev Vectorize index, not prod", async () => {
    const { config } = ctx!;
    expect(config.devIndexName).toBe("openbrain-memories-dev");
    expect(config.devRemote).toBe(true);
    expect(config.prodIndexName).toBe("openbrain-memories");
    expect(config.devIndexName).not.toBe(config.prodIndexName);
  });

  it("P0.7 after the run, no captured vector remains in the dev index", async () => {
    // All prior cases' afterEach have run by now. Surface any cleanup
    // failures recorded along the way (part a: continue-on-failure + report).
    if (cleanupFailures.length > 0) {
      throw new Error(
        `cleanup delete failures during run: ${cleanupFailures.join("; ")}`,
      );
    }

    // The remote index should hold none of the ids created this run (the
    // endpoint-deleted P0.5 id was released from cleanup, but it was already
    // verified gone by P0.5; everything else was afterEach-deleted). Retry
    // past delete lag; if any id never clears, waitFor throws with the list.
    const ids = [...allCapturedIds];
    if (ids.length === 0) return;
    await waitFor(
      async () => {
        const rows = await ctx!.vectorize.getByIds(ids);
        const present = (Array.isArray(rows) ? rows : [])
          .filter((r) => r && typeof r.id === "string")
          .map((r) => r.id);
        if (present.length === 0) return true;
        throw new Error(`leftover vectors: ${present.join(", ")}`);
      },
      { ...WAIT, label: `P0.7 no leftovers (${ids.length} ids)` },
    );
  });

  it("P0.8 missing Cloudflare credentials throws before the server starts", async () => {
    // We can only assert the gate's behavior without disturbing the live
    // harness: import the guard and run it in a stripped env, restoring after.
    const { assertCloudflareCreds } = await import("./harness.js");
    const saved = {
      token: process.env.CLOUDFLARE_API_TOKEN,
      account: process.env.CLOUDFLARE_ACCOUNT_ID,
    };
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    try {
      expect(() => assertCloudflareCreds()).toThrow(/Cloudflare credentials/);
    } finally {
      process.env.CLOUDFLARE_API_TOKEN = saved.token;
      process.env.CLOUDFLARE_ACCOUNT_ID = saved.account;
    }
  });
});

// --- helpers ---------------------------------------------------------------

type ReqInit = {
  method: string;
  body?: string;
  headers?: Record<string, string>;
};

/** Fetch against the live dev Worker with the harness API key injected. */
function req(
  path: string,
  init: ReqInit,
): ReturnType<HarnessContext["server"]["fetch"]> {
  if (!ctx) throw new Error("harness not booted");
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  headers["x-api-key"] = ctx.apiKey;
  if (init.body !== undefined && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  return ctx.server.fetch(path, {
    method: init.method,
    headers,
    body: init.body,
  });
}

async function createMemory(
  content: string,
  src: string,
): Promise<{ id: string }> {
  const res = await req("/v1/memories", {
    method: "POST",
    body: JSON.stringify({ content, source: src }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { memory: { id: string } };
  expect(typeof body.memory.id).toBe("string");
  return { id: body.memory.id };
}

/** Track ids created this case for afterEach cleanup + the final sweep. */
function capture(...ids: string[]): void {
  for (const id of ids) {
    caseCapturedIds.push(id);
    allCapturedIds.add(id);
  }
}

/** Remove an id from cleanup tracking (used when the endpoint already deleted it). */
function release(id: string): void {
  caseCapturedIds = caseCapturedIds.filter((x) => x !== id);
  // Keep it in allCapturedIds so P0.7 still verifies it is gone.
}
