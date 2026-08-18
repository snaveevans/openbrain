import { type ErrorBody } from "@snaveevans/openbrain-common";
import type { Context } from "hono";

export const CACHE_CONTROL_NO_STORE = "no-store";

/** Health `service` for the MCP Worker (distinct from REST's `"openbrain"`). */
export const MCP_HEALTH_SERVICE = "openbrain-mcp";

export {
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  ERROR_UNAUTHORIZED,
} from "@snaveevans/openbrain-common";

/**
 * House error envelope `{ "error": string }` at `status`. Used for the
 * non-JSON-RPC responses on this Worker (400 OAuth errors, 401 gate, 404
 * unknown path, 405 wrong method, 500 fail-closed). JSON-RPC results use
 * `c.json` directly.
 */
export function jsonError(
  c: Context,
  status: 400 | 401 | 404 | 405 | 500,
  error: string,
): Response {
  const body: ErrorBody = { error };
  return c.json(body, status);
}
