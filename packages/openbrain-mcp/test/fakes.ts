import type {
  RestRequest,
  RestResponse,
  RestClient,
} from "../src/rest-client.js";

/**
 * Injectable REST client for tests. Records every upstream request and
 * returns a canned response or throws (network failure). Deliberately dumb:
 * no routing, no auth, no validation — it just plays back what the test
 * queued and remembers what the Worker sent. That keeps the Worker's behavior
 * observable through the REST seam alone.
 */
export class FakeRest implements RestClient {
  readonly requests: RestRequest[] = [];
  private queue: QueuedResponse[] = [];

  /** Queue a normal HTTP response (raw body) for the next request. */
  respond(status: number, body: string): this {
    this.queue.push({ kind: "response", status, body });
    return this;
  }

  /** Queue a normal HTTP response with a JSON body. */
  respondJson(status: number, json: unknown): this {
    return this.respond(status, JSON.stringify(json));
  }

  /** Queue a network failure: `request()` throws (DNS/TLS/timeout). */
  throw(message: string): this {
    this.queue.push({ kind: "throw", message });
    return this;
  }

  async request(req: RestRequest): Promise<RestResponse> {
    // Record before throwing, so a thrown request is still observable.
    this.requests.push(req);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error("FakeRest: no queued response for request.");
    }
    if (next.kind === "throw") {
      throw new Error(next.message);
    }
    return { status: next.status, body: next.body };
  }

  /** Number of upstream requests the Worker actually sent. */
  get requestCount(): number {
    return this.requests.length;
  }

  /** Most recent upstream request (or undefined). */
  get last(): RestRequest | undefined {
    return this.requests[this.requests.length - 1];
  }
}

type QueuedResponse =
  | { kind: "response"; status: number; body: string }
  | { kind: "throw"; message: string };

/**
 * Fake KV namespace. `get` returns the stored value for a key, `null` for an
 * unknown or expired key, or throws when `failNextGet` is set (fail-closed).
 * `put` stores a value with an optional `expirationTtl` (checked against the
 * fake clock); `delete` removes the key. The Worker hashes bearers/codes/
 * refresh tokens and looks them up by that hash, so tests seed with
 * `kv.set(sha256Hex(token), value)`.
 */
export class FakeKV implements KVNamespace {
  private readonly entries = new Map<string, string>();
  private readonly expiries = new Map<string, number>();
  failNextGet = false;
  failNextPut = false;
  failNextDelete = false;

  /** Seed a key (typically `sha256Hex(token)`) → stored value, no expiry. */
  set(key: string, value: string): this {
    this.entries.set(key, value);
    return this;
  }

  /** Set a key's expiry epoch-seconds (for TTL-based tests). */
  setExpiry(key: string, epochSeconds: number): this {
    this.expiries.set(key, epochSeconds);
    return this;
  }

  /** Whether a key currently exists (and is not expired). */
  has(key: string): boolean {
    if (!this.entries.has(key)) return false;
    const exp = this.expiries.get(key);
    return exp === undefined || exp > this.clockNow();
  }

  get(key: string): Promise<string | null> {
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("KV get failed");
    }
    if (!this.entries.has(key)) return Promise.resolve(null);
    const exp = this.expiries.get(key);
    if (exp !== undefined && exp <= this.clockNow()) {
      this.entries.delete(key);
      this.expiries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  put(
    key: string,
    value: string,
    options?: KVNamespacePutOptions,
  ): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("KV put failed");
    }
    this.entries.set(key, value);
    if (options?.expirationTtl && options.expirationTtl > 0) {
      this.expiries.set(key, this.clockNow() + options.expirationTtl);
    }
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("KV delete failed");
    }
    this.entries.delete(key);
    this.expiries.delete(key);
    return Promise.resolve();
  }

  /** Number of keys currently stored. */
  get size(): number {
    return this.entries.size;
  }

  /** Inspect stored keys (prefixed filter optional). */
  keys(prefix?: string): string[] {
    const all = [...this.entries.keys()];
    return prefix === undefined ? all : all.filter((k) => k.startsWith(prefix));
  }

  /** Override point for a fake clock; defaults to real `Date.now()`. */
  protected clockNow(): number {
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * `FakeKV` with an injectable clock. `now` sets the current epoch-seconds the
 * KV uses for TTL checks. Used by the JWT `exp` boundary test (P2) and any
 * test that needs deterministic expiry without waiting.
 */
export class FakeClockKV extends FakeKV {
  now = Math.floor(Date.now() / 1000);
  protected clockNow(): number {
    return this.now;
  }
  /** Advance the fake clock by `seconds`. */
  advance(seconds: number): this {
    this.now += seconds;
    return this;
  }
}
