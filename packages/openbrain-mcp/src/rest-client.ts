/**
 * REST client seam for the MCP Worker.
 *
 * The Worker is a thin client of the REST API (ADR-0004): it translates MCP
 * tool calls into HTTP and HTTP back into MCP content. It builds each upstream
 * request itself — including the Worker's **own** `x-api-key` (never a caller
 * credential) — and hands a fully-formed request to a `RestClient` that just
 * sends it. Production uses `fetchRestClient` (global `fetch`,
 * `redirect: "manual"` so a 3xx is terminal and the Worker's `API_KEY` never
 * follows a redirect to another host). Tests inject a `FakeRest` that records
 * the outgoing request and returns a canned response or throws (network
 * failure).
 *
 * This mirrors the CLI's `HttpTransport` seam.
 */

export interface RestRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface RestResponse {
  status: number;
  body: string;
}

export interface RestClient {
  request(req: RestRequest): Promise<RestResponse>;
}

/** Production transport. `redirect: "manual"` is load-bearing (see header). */
export function fetchRestClient(): RestClient {
  return {
    async request(req: RestRequest): Promise<RestResponse> {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        redirect: "manual",
      });
      return { status: res.status, body: await res.text() };
    },
  };
}
