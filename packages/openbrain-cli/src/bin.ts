#!/usr/bin/env node
/**
 * OpenBrain CLI entrypoint. Wires `process.*` to {@link runCli} and a real
 * {@link fetchTransport}. All testable logic lives in `cli.ts` (`runCli`);
 * this file has no behavior of its own.
 *
 * It sets `process.exitCode` and returns rather than calling `process.exit()`.
 * `process.exit()` cuts the process off the instant it runs, dropping any
 * `stdout` data still buffered by the writable stream — so a success body
 * larger than the OS pipe buffer (e.g. a big `search` response piped to `jq`)
 * would be **truncated**. Letting the process exit naturally drains the
 * streams first, then exits with `exitCode`. The global `fetch` releases its
 * idle sockets, so the process still exits promptly (measured <0.4s end to
 * end for a 200 KB piped body); this is not a hang.
 */

import { runCli } from "./cli.js";
import { fetchTransport } from "./http.js";

const code = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: { write: (text) => void process.stdout.write(text) },
  stderr: { write: (text) => void process.stderr.write(text) },
  transport: fetchTransport(),
});

process.exitCode = code;
