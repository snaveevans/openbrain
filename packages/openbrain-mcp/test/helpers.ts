import { sha256Hex } from "../src/gate.js";
import { FakeKV, FakeRest } from "./fakes.js";

export { sha256Hex };

/** The Worker's own upstream credential (never forwarded from the caller). */
export const API_KEY = "worker-own-key";
/** A caller-supplied key that must never reach REST. */
export const CALLER_KEY = "caller-key";
export const API_URL = "https://api.test/v1";
/** An operator-minted BYOK token seeded into KV. */
export const VALID_TOKEN = "valid-byok-token";

export function makeEnv(kv: FakeKV, extra: Record<string, string> = {}) {
  return { API_KEY, API_URL, TOKENS: kv, ...extra };
}

/** Seed KV so `token` is accepted by the gate (keyed by its SHA-256 hash). */
export async function seedToken(kv: FakeKV, token: string): Promise<void> {
  kv.set(await sha256Hex(token), "minted");
}

export interface CallOptions {
  bearer?: string;
  xApiKey?: string;
  id?: number | string;
}

/**
 * POST a JSON-RPC request to `/mcp` on `app` with the given bindings.
 * `bearer`/`xApiKey` set the corresponding request headers.
 */
/**
 * Build a `POST /mcp` JSON-RPC `RequestInit`. Tests pass it to
 * `app.request("/mcp", rpc(...), env)`. `bearer`/`xApiKey` set the request
 * headers.
 */
export function rpc(
  method: string,
  params: unknown,
  opts: CallOptions = {},
): RequestInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.bearer !== undefined)
    headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.xApiKey !== undefined) headers["x-api-key"] = opts.xApiKey;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: opts.id ?? 1,
    method,
    params,
  });
  return { method: "POST", headers, body };
}

export const SAMPLE_MEMORY = {
  id: "00000000-0000-4000-8000-000000000001",
  content: "hello world",
  source: "manual",
  metadata: {},
  created_at: "2026-08-14T12:00:00.000Z",
  updated_at: "2026-08-14T12:00:00.000Z",
  embedding_model: "test-embedder",
  embedded_at: "2026-08-14T12:00:00.000Z",
};

/** Expected memory-model block for {@link SAMPLE_MEMORY} (no similarity). */
export const SAMPLE_BLOCK = `id: 00000000-0000-4000-8000-000000000001
source: manual
created_at: 2026-08-14T12:00:00.000Z
updated_at: 2026-08-14T12:00:00.000Z
embedded_at: 2026-08-14T12:00:00.000Z
embedding_model: test-embedder
metadata: {}

hello world`;

export const SAMPLE_HIT = {
  ...SAMPLE_MEMORY,
  metadata: { tag: "x" },
  similarity: 0.8,
};

/** Expected memory-model block for {@link SAMPLE_HIT} (with similarity). */
export const SAMPLE_HIT_BLOCK = `id: 00000000-0000-4000-8000-000000000001
source: manual
created_at: 2026-08-14T12:00:00.000Z
updated_at: 2026-08-14T12:00:00.000Z
embedded_at: 2026-08-14T12:00:00.000Z
embedding_model: test-embedder
similarity: 0.8000
metadata: {"tag":"x"}

hello world`;

export { FakeRest, FakeKV };
