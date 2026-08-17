#!/usr/bin/env node
/**
 * OpenBrain CLI entrypoint. Wires `process.*` to {@link runCli} and a real
 * `fetchTransport`, then exits with the returned code. All testable logic
 * lives in `cli.ts` (`runCli`); this file has no behavior of its own.
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

process.exit(code);
