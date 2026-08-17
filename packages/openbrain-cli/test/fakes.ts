import type { HttpRequest, HttpResponse, HttpTransport } from "../src/http.js";

/**
 * Injectable HTTP transport for tests. Records every outgoing request and
 * returns a canned response, throws (network failure), or returns a 3xx.
 *
 * The fake is deliberately dumb: it does no routing, no auth, no validation —
 * it just plays back what the test queued and remembers what the CLI sent.
 * That keeps the CLI's behavior observable through the transport seam alone.
 */
export class FakeTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  private queue: FakeResponse[] = [];

  /** Queue a normal HTTP response to be returned on the next request. */
  respond(
    status: number,
    body: string,
    headers: Record<string, string> = {},
  ): this {
    this.queue.push({ kind: "response", status, body, headers });
    return this;
  }

  /** Queue a network failure: `request()` throws, simulating DNS/TLS/timeout. */
  throw(message: string): this {
    this.queue.push({ kind: "throw", message });
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error("FakeTransport: no queued response for request.");
    }
    if (next.kind === "throw") {
      throw new Error(next.message);
    }
    return { status: next.status, body: next.body };
  }

  /** Number of HTTP requests the CLI actually sent. */
  get requestCount(): number {
    return this.requests.length;
  }
}

type FakeResponse =
  | {
      kind: "response";
      status: number;
      body: string;
      headers: Record<string, string>;
    }
  | { kind: "throw"; message: string };

/** A sink that captures everything written, for assertions. */
export class CaptureSink {
  chunks: string[] = [];

  write(text: string): void {
    this.chunks.push(text);
  }

  /** All writes concatenated. */
  get text(): string {
    return this.chunks.join("");
  }
}
