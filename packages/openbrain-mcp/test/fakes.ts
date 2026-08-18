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
 * Fake KV namespace for the BYOK gate. `get` returns the stored value for a
 * key, `null` for an unknown key, or throws when `failNextGet` is set
 * (fail-closed). The Worker hashes the bearer and looks it up by that hash,
 * so tests seed with `kv.set(sha256Hex(token), value)`.
 */
export class FakeKV implements KVNamespace {
  private readonly entries = new Map<string, string>();
  failNextGet = false;

  /** Seed a key (typically `sha256Hex(token)`) → stored value. */
  set(key: string, value: string): this {
    this.entries.set(key, value);
    return this;
  }

  get(key: string): Promise<string | null> {
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("KV get failed");
    }
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  // Unused on the S1 hot path; declared to satisfy KVNamespace.
  put(): Promise<void> {
    return Promise.resolve();
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }
}
