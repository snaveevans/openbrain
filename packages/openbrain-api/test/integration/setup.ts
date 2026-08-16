/**
 * Integration-suite setup (loaded once per fork before tests). Scoped to
 * `vitest.integration.config.ts` only — never the default CI suite.
 *
 * Workaround for a known undici + macOS issue: undici's HTTP/1.1 writer calls
 * `socket.setTypeOfService()` on every connection, and on this platform that
 * throws `EINVAL` (Node `net` `setsockopt` `IP_TOS`). The throw escapes undici
 * as an uncaught exception, which Vitest treats as a run-level failure — so
 * the suite could fail even when every test passes. Type-of-Service is an
 * optional QoS hint (it does not affect correctness), so neuter the call
 * before any remote binding connection is opened. This fixes the error at the
 * source instead of blanketing the suite with `dangerouslyIgnoreUnhandledErrors`.
 */
import { Socket } from "node:net";

type SetTypeOfService = (tos: number) => boolean;
const proto = Socket.prototype as unknown as {
  setTypeOfService: SetTypeOfService;
};
proto.setTypeOfService = function setTypeOfServiceNoop() {
  return true;
};
