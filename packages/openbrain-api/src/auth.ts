import {
  API_KEY_HEADER,
  ERROR_API_KEY_NOT_CONFIGURED,
  ERROR_UNAUTHORIZED,
} from "@snaveevans/openbrain-common";
import type { Context, Next } from "hono";

import { jsonError } from "./http.js";

/**
 * Constant-time compare after SHA-256 so length is not leaked.
 * @see https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
 */
export async function secretsEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(providedHash);
  const b = new Uint8Array(expectedHash);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

function isHealthPath(c: Context): boolean {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, "") || "/";
  return path === "/v1/health";
}

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  if (isHealthPath(c)) {
    return next();
  }

  const configured = (c.env?.API_KEY ?? "").trim();
  if (configured.length === 0) {
    return jsonError(c, 500, ERROR_API_KEY_NOT_CONFIGURED);
  }

  const presented = (c.req.header(API_KEY_HEADER) ?? "").trim();
  if (presented.length === 0 || !(await secretsEqual(presented, configured))) {
    return jsonError(c, 401, ERROR_UNAUTHORIZED);
  }

  return next();
}
