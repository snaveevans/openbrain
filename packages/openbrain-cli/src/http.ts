/**
 * HTTP transport seam for the OpenBrain CLI.
 *
 * The CLI talks to the REST API through an `HttpTransport`. Production uses
 * `fetchTransport`, which wraps the global `fetch` with `redirect: "manual"`
 * so the CLI never follows HTTP redirects (a 3xx is surfaced as a non-OK
 * response — following would re-send `x-api-key` to the redirect target, a
 * cross-host key leak). Tests inject a `FakeTransport` that records the
 * outgoing request and returns a canned response, throws (network failure),
 * or returns a 3xx + `Location`.
 */

/** An outgoing HTTP request, as the CLI builds it. */
export interface HttpRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** An HTTP response, normalized for the CLI to consume. */
export interface HttpResponse {
  status: number;
  body: string;
}

/** Injectable transport so tests never touch the network. */
export interface HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse>;
}

/**
 * Production transport. `redirect: "manual"` is load-bearing: it makes 3xx a
 * terminal non-OK response instead of a followed hop, and keeps `x-api-key`
 * off any redirect target.
 */
export function fetchTransport(): HttpTransport {
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        redirect: "manual",
      });
      const body = await res.text();
      return { status: res.status, body };
    },
  };
}
