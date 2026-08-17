/**
 * OpenBrain CLI — thin client of the REST API.
 *
 * {@link runCli} is the testable core: it takes already-stubbed `argv`/`env`,
 * {@link Sink}s, and an injectable {@link HttpTransport}, and returns an exit
 * code. The bin entrypoint (`src/bin.ts`) wires `process.*` and a real
 * `fetchTransport`; tests inject a `FakeTransport` and capture sinks.
 *
 * The CLI is a thin client (ADR-0004): it does not duplicate the API's domain
 * validation. Its only local work is what is structurally required to form a
 * valid request — `--metadata` JSON-parse, missing `--id` (path param),
 * unknown command, valueless flag, missing config. Everything else is
 * forwarded and the API's error is printed on stderr.
 */

import { API_KEY_HEADER } from "@snaveevans/openbrain-common";

import type { HttpTransport } from "./http.js";

/** Minimal write target so tests don't need Node streams. */
export interface Sink {
  write(text: string): void;
}

/** Everything {@link runCli} needs from the outside world. */
export interface RunCliOptions {
  /** Args after the program name (i.e. `process.argv.slice(2)`). */
  argv: string[];
  /** Environment, read for `OPENBRAIN_API_KEY` / `OPENBRAIN_BASE_URL`. */
  env: Record<string, string | undefined>;
  stdout: Sink;
  stderr: Sink;
  transport: HttpTransport;
}

/** Flags that consume the next token (or `--key=value`) as their value. */
const VALUE_FLAGS = new Set([
  "api-key",
  "base-url",
  "content",
  "source",
  "metadata",
  "id",
  "query",
  "limit",
  "threshold",
]);

const KNOWN_COMMANDS = ["create", "fetch", "delete", "search"] as const;
type Command = (typeof KNOWN_COMMANDS)[number];

interface ParsedArgs {
  help: boolean;
  command: string | undefined;
  flags: Record<string, string>;
  /** `Missing value for --<key>` if a value flag had no value. */
  valuelessError: string | undefined;
}

function parseArgs(tokens: string[]): ParsedArgs {
  let help = false;
  let command: string | undefined;
  const flags: Record<string, string> = {};
  let valuelessError: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) {
      continue;
    }

    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }

    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      let key: string;
      let inlineValue: string | undefined;
      if (eq >= 0) {
        key = token.slice(0, eq);
        inlineValue = token.slice(eq + 1);
      } else {
        key = token;
      }
      const name = key.slice(2);

      if (VALUE_FLAGS.has(name)) {
        if (inlineValue !== undefined) {
          flags[name] = inlineValue;
        } else {
          const next = tokens[i + 1];
          if (next === undefined) {
            valuelessError = `Missing value for ${key}`;
          } else {
            flags[name] = next;
            i++;
          }
        }
      }
      // Unknown flags are silently ignored (the spec defines only an unknown
      // *command* as an error). We do not consume a following token for an
      // unknown flag, since its arity is unknown.
      continue;
    }

    // Positional: the first one is the command; extras are ignored.
    if (command === undefined) {
      command = token;
    }
  }

  return { help, command, flags, valuelessError };
}

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
}

function resolveConfig(
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): ResolvedConfig | string {
  // A flag overrides the matching env var when both are set. An empty value
  // (flag or env) is treated as missing — either way the value is fatal.
  const keyRaw = flags["api-key"] ?? env.OPENBRAIN_API_KEY;
  const apiKey = keyRaw && keyRaw.length > 0 ? keyRaw : undefined;
  if (apiKey === undefined) {
    return "Missing required --api-key (set --api-key or OPENBRAIN_API_KEY).";
  }

  const urlRaw = flags["base-url"] ?? env.OPENBRAIN_BASE_URL;
  // Trailing slashes are stripped — the only mutation. Verbatim otherwise.
  const baseUrl =
    urlRaw && urlRaw.length > 0 ? urlRaw.replace(/\/+$/, "") : undefined;
  if (baseUrl === undefined) {
    return "Missing required --base-url (set --base-url or OPENBRAIN_BASE_URL).";
  }

  return { apiKey, baseUrl };
}

/** A built request handed to the transport. */
interface BuiltRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Outcome of building a command's request. */
type BuildResult =
  { kind: "ok"; request: BuiltRequest } | { kind: "error"; message: string };

function jsonHeaders(apiKey: string): Record<string, string> {
  return { [API_KEY_HEADER]: apiKey, "content-type": "application/json" };
}

function plainHeaders(apiKey: string): Record<string, string> {
  return { [API_KEY_HEADER]: apiKey };
}

function buildCreate(
  flags: Record<string, string>,
  config: ResolvedConfig,
): BuildResult {
  const body: Record<string, unknown> = {};

  const content = flags["content"];
  if (content !== undefined) {
    body.content = content;
  }
  // Missing --content is forwarded (omitted); the API rejects it.

  const source = flags["source"];
  if (source !== undefined) {
    body.source = source;
  }

  const metadataRaw = flags["metadata"];
  if (metadataRaw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(metadataRaw);
    } catch {
      return { kind: "error", message: "--metadata is not valid JSON." };
    }
    // Valid JSON of any type is forwarded; the API rejects non-objects.
    body.metadata = parsed;
  }

  return {
    kind: "ok",
    request: {
      method: "POST",
      url: `${config.baseUrl}/memories`,
      headers: jsonHeaders(config.apiKey),
      body: JSON.stringify(body),
    },
  };
}

function buildFetchOrDelete(
  command: "fetch" | "delete",
  flags: Record<string, string>,
  config: ResolvedConfig,
): BuildResult {
  const id = flags["id"];
  if (id === undefined) {
    // --id is a path param: the URL cannot be formed without it.
    return { kind: "error", message: "Missing required --id." };
  }
  // A present (even malformed) id is forwarded as one URL-encoded segment so
  // path-traversal strings like "../foo" can never escape /memories/.
  const segment = encodeURIComponent(id);
  return {
    kind: "ok",
    request: {
      method: command === "fetch" ? "GET" : "DELETE",
      url: `${config.baseUrl}/memories/${segment}`,
      headers: plainHeaders(config.apiKey),
      body: undefined,
    },
  };
}

function coerceNumber(raw: string): number | string {
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function buildSearch(
  flags: Record<string, string>,
  config: ResolvedConfig,
): BuildResult {
  const body: Record<string, unknown> = {};

  const query = flags["query"];
  if (query !== undefined) {
    body.query = query;
  }
  // Missing --query is forwarded (omitted); the API rejects it.

  const source = flags["source"];
  if (source !== undefined) {
    body.source = source;
  }

  const limit = flags["limit"];
  if (limit !== undefined) {
    body.limit = coerceNumber(limit);
  }

  const threshold = flags["threshold"];
  if (threshold !== undefined) {
    body.threshold = coerceNumber(threshold);
  }

  return {
    kind: "ok",
    request: {
      method: "POST",
      url: `${config.baseUrl}/memories/search`,
      headers: jsonHeaders(config.apiKey),
      body: JSON.stringify(body),
    },
  };
}

function buildRequest(
  command: Command,
  flags: Record<string, string>,
  config: ResolvedConfig,
): BuildResult {
  switch (command) {
    case "create":
      return buildCreate(flags, config);
    case "fetch":
      return buildFetchOrDelete("fetch", flags, config);
    case "delete":
      return buildFetchOrDelete("delete", flags, config);
    case "search":
      return buildSearch(flags, config);
  }
}

/** Entry point for tests and the bin. Returns the process exit code. */
export async function runCli({
  argv,
  env,
  stdout,
  stderr,
  transport,
}: RunCliOptions): Promise<number> {
  const { help, command, flags, valuelessError } = parseArgs(argv);

  // Help wins: it is local — no key, no base URL, no request. If a known
  // command precedes --help, show that command's help; else top-level.
  if (help) {
    stdout.write(commandHelp(command) + "\n");
    return 0;
  }

  // A valueless flag is a local error: no request.
  if (valuelessError !== undefined) {
    stderr.write(`openbrain: ${valuelessError}\n`);
    return 1;
  }

  // No command: nothing to do. Print top-level usage and succeed (mirrors the
  // bare no-args case). This is help, not an error.
  if (command === undefined) {
    stdout.write(topLevelHelp() + "\n");
    return 0;
  }

  if (!isKnownCommand(command)) {
    stderr.write(`openbrain: Unknown command '${command}'.\n\n`);
    stderr.write(topLevelHelp() + "\n");
    return 1;
  }

  // Config must resolve before any request. Missing key/base URL is fatal.
  const config = resolveConfig(flags, env);
  if (typeof config === "string") {
    stderr.write(`openbrain: ${config}\n`);
    return 1;
  }

  const built = buildRequest(command, flags, config);
  if (built.kind === "error") {
    stderr.write(`openbrain: ${built.message}\n`);
    return 1;
  }

  let status: number;
  let resBody: string;
  try {
    const res = await transport.request(built.request);
    status = res.status;
    resBody = res.body;
  } catch (error) {
    // Network failure (DNS, connection refused, timeout, TLS): no HTTP
    // response. Local message on stderr, nothing on stdout.
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`openbrain: ${message}\n`);
    return 1;
  }

  // OK (2xx): print the API body verbatim + a single trailing newline.
  if (status >= 200 && status < 300) {
    stdout.write(resBody + "\n");
    return 0;
  }

  // Non-OK: the server error string on stderr if the body is `{ error }`,
  // otherwise a local `Request failed with <status>`. Nothing on stdout.
  let parsed: unknown;
  try {
    parsed = JSON.parse(resBody);
  } catch {
    parsed = undefined;
  }
  const serverError =
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    typeof (parsed as { error?: unknown }).error === "string"
      ? (parsed as { error: string }).error
      : undefined;
  stderr.write((serverError ?? `Request failed with ${status}`) + "\n");
  return 1;
}

function isKnownCommand(command: string): command is Command {
  return (KNOWN_COMMANDS as readonly string[]).includes(command);
}

function commandHelp(command: string | undefined): string {
  switch (command) {
    case "create":
      return CREATE_HELP;
    case "fetch":
      return FETCH_HELP;
    case "delete":
      return DELETE_HELP;
    case "search":
      return SEARCH_HELP;
    default:
      return topLevelHelp();
  }
}

const CONFIG_FLAGS = `Config (required; a flag overrides the matching env var):
  --api-key <key>     API key            env OPENBRAIN_API_KEY
  --base-url <url>    REST root {api}    env OPENBRAIN_BASE_URL
                      (origin + /v1; trailing slashes are stripped, otherwise verbatim)`;

function topLevelHelp(): string {
  return `OpenBrain CLI — thin client of the REST API

Usage:
  openbrain <command> [flags]
  openbrain --help | -h
  openbrain <command> --help | -h

Commands:
  create   Create a memory        POST {api}/memories
  fetch    Fetch a memory by id   GET {api}/memories/{id}
  delete   Delete a memory by id  DELETE {api}/memories/{id}
  search   Search memories        POST {api}/memories/search

${CONFIG_FLAGS}

Run \`openbrain <command> --help\` for that command's flags and an example.`;
}

const CREATE_HELP = `openbrain create — create a memory (POST {api}/memories)

Usage:
  openbrain create --content <text> [--source <text>] [--metadata <json>] [config flags]

Flags:
  --content <text>    required  memory content
  --source <text>     optional  source label (the API defaults to "manual")
  --metadata <json>   optional  JSON object string, e.g. '{"tag":"x"}'
  --api-key <key>     optional  override OPENBRAIN_API_KEY
  --base-url <url>    optional  override OPENBRAIN_BASE_URL

Example:
  openbrain create --content "hello world" --source cli --metadata '{"tag":"x"}'`;

const FETCH_HELP = `openbrain fetch — fetch a memory by id (GET {api}/memories/{id})

Usage:
  openbrain fetch --id <uuid> [config flags]

Flags:
  --id <uuid>         required  memory id (UUID v4); URL-encoded as one segment
  --api-key <key>     optional  override OPENBRAIN_API_KEY
  --base-url <url>    optional  override OPENBRAIN_BASE_URL

Example:
  openbrain fetch --id 11111111-1111-4111-8111-111111111111`;

const DELETE_HELP = `openbrain delete — delete a memory by id (DELETE {api}/memories/{id})

Usage:
  openbrain delete --id <uuid> [config flags]

Flags:
  --id <uuid>         required  memory id (UUID v4); URL-encoded as one segment
  --api-key <key>     optional  override OPENBRAIN_API_KEY
  --base-url <url>    optional  override OPENBRAIN_BASE_URL

Example:
  openbrain delete --id 11111111-1111-4111-8111-111111111111`;

const SEARCH_HELP = `openbrain search — search memories (POST {api}/memories/search)

Usage:
  openbrain search --query <text> [--limit <n>] [--threshold <n>] [--source <text>] [config flags]

Flags:
  --query <text>      required  search query
  --limit <n>         optional  max results (number)
  --threshold <n>     optional  similarity threshold, a number in [0, 1]
  --source <text>     optional  source filter
  --api-key <key>     optional  override OPENBRAIN_API_KEY
  --base-url <url>    optional  override OPENBRAIN_BASE_URL

Example:
  openbrain search --query "hello" --limit 5 --threshold 0.5`;
