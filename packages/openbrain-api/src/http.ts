import type { Context } from "hono";

import type { ErrorBody } from "@snaveevans/openbrain-common";

export const CACHE_CONTROL_NO_STORE = "no-store";

export function jsonError(
  c: Context,
  status: 400 | 401 | 404 | 405 | 500,
  error: string,
): Response {
  const body: ErrorBody = { error };
  return c.json(body, status);
}
