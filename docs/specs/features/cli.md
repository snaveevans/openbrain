---
audience: implementers · operators
purpose: thin CLI client of the REST API
source: this file
date: 2026-08-14
---

# CLI

**Status:** `active`
**Owner:** tyler
**Related Specs:** [rest-api](rest-api.md), [authentication](../cross-cutting/authentication.md), [memory-model](../cross-cutting/memory-model.md), [create-memory](create-memory.md), [fetch-memory](fetch-memory.md), [search-memories](search-memories.md), [delete-memory](delete-memory.md)

---

## Summary

A command-line client for operators. It is a **thin client of the REST
API** ([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)). It does
not speak MCP and does not touch storage. It is self-documenting: `--help`
on the tool and on each command is enough to use it.

## User Stories

- As an **operator**, I can **create, fetch, search, and delete from a shell** so that **I can seed and inspect the store without an agent**
- As an **operator**, I can **see HTTP errors as process failures** so that **scripts can branch on success**
- As an **operator or agent**, I can **read `--help` on the tool and each command** so that **I can use Open Brain without any other documentation**

## Acceptance Criteria

- [x] `S1` The package is named **OpenBrain CLI**. After install, the binary on `PATH` is `openbrain`
- [x] `S1` The CLI requires a REST base URL and API key from flags or `OPENBRAIN_BASE_URL` / `OPENBRAIN_API_KEY`; a flag overrides the matching env var when both are set
- [x] `S1` Missing key or base URL is a fatal error before any request
- [x] `S1` Commands exist for create, fetch, search, and delete, each calling only the matching REST route
- [x] `S1` Success prints the API's JSON response body **verbatim** to stdout, followed by a single trailing newline
- [x] `S1` Non-OK HTTP exits non-zero and prints the server `error` string on stderr; a non-OK response with no `error` body prints `Request failed with <status>`
- [x] `S1` Network failure (no HTTP response) exits non-zero with a local message on stderr and nothing on stdout
- [x] `S1` The CLI does not follow HTTP redirects
- [x] `S1` `--help`/`-h` on the top level and on every command prints usage precise enough for an agent to use the tool without other documentation
- [x] `S1` The CLI does not implement embedding, storage, or a second auth scheme

## Observable Contract

### Config (same names as local MCP)

| Flag | Env | Required |
| ---- | --- | -------- |
| `--api-key` | `OPENBRAIN_API_KEY` | yes |
| `--base-url` | `OPENBRAIN_BASE_URL` | yes |

Flags may be `--key value` or `--key=value`. A flag given without a value is
fatal: `Missing value for --<key>`. A flag overrides the matching env var when
both are set.

`--base-url` is the versioned REST root `{api}` from [rest-api](rest-api.md)
(origin plus `/v1`). Trailing slashes are stripped; that is the only mutation.
The value is used **verbatim** — the CLI does not detect a missing `/v1`, a
hosted-MCP URL, or any other shape. A wrong base URL fails at the API (e.g.
`404`/`405`) and is surfaced as a non-OK response.

The published package title is **OpenBrain CLI**. The installed command is
`openbrain` (not `openbrain-cli`).

### Commands

| Command | REST |
| ------- | ---- |
| `openbrain create --content … [--source …] [--metadata …]` | `POST {api}/memories` |
| `openbrain fetch --id <uuid>` | `GET {api}/memories/{id}` |
| `openbrain delete --id <uuid>` | `DELETE {api}/memories/{id}` |
| `openbrain search --query … [--limit …] [--threshold …] [--source …]` | `POST {api}/memories/search` |

### Arguments & local validation

The CLI is a thin client
([ADR-0004](../../decisions/0004-rest-as-domain-surface.md)): it does not
duplicate the API's domain validation. Its only local work is what is
structurally required to form a valid request. Everything else is forwarded
and the API's error is printed on stderr.

- `--metadata` is a JSON object string. It is JSON-parsed locally so it can be
  embedded as a structured value in the request body. **Invalid JSON is a local
  error** (exit non-zero, no request). Valid JSON that is not an object (`[]`,
  `42`) is **forwarded**; the API rejects it.
- `--limit` / `--threshold` are coerced to a number when finite, otherwise
  forwarded as the raw string. **Range and type-beyond-coercion are not
  validated locally** — the API clamps or rejects (e.g. `--limit Infinity` →
  API 400 `` `limit` must be a number when provided. ``).
- Missing `--content` (create) or `--query` (search) is **forwarded**; the API
  rejects the empty/missing field.
- Missing `--id` (fetch/delete) is a **local error** — `--id` is a path
  parameter, so the CLI cannot form the request URL without it. A _present but
  malformed_ `--id` (not a UUID) is **forwarded as a single URL-encoded path
  segment_, so any non-UUID value — including path-traversal strings like
  `../foo` — yields the API's 400 `` `id` must be a valid UUID v4. ``, never a
  wrong-route 404 or an escaped path. Valid UUIDs are hex and hyphens only, so
  encoding is a no-op on them; the server still sees the exact string.
- An unknown command is a **local error** (exit non-zero, usage on stderr, no
  request).

### Output

- **Success:** the API's JSON response body is written **verbatim** to stdout
  (byte-for-byte; no re-serialization, pretty-print, or key sort), followed by a
  single trailing `\n`. Exit 0.
- **API non-OK with `{ error }`:** the server's `error` string is printed on
  stderr. Exit non-zero. Nothing on stdout.
- **API non-OK without an `error` body** (3xx, proxy HTML, empty body):
  `Request failed with <status>` on stderr. Exit non-zero. Nothing on stdout.
- **Local errors** (missing key/base URL, `Missing value for --<key>`, unknown
  command, missing `--id`, invalid `--metadata` JSON): `openbrain: <message>` on
  stderr. Exit non-zero. Nothing on stdout.
- **Network failure** (DNS, connection refused, timeout, TLS — no HTTP
  response): `openbrain: <message>` on stderr. Exit non-zero. Nothing on stdout.

### Redirects

The CLI does **not** follow HTTP redirects. A 3xx is surfaced as a non-OK
response (above), never chased. Following would re-send `x-api-key` to the
redirect target — a cross-host key leak
([authentication](../cross-cutting/authentication.md)).

### Help

`openbrain --help` / `-h`, and `openbrain` with no args, print top-level usage
to **stdout** and exit 0: the four commands, the config flags and env vars, and
a pointer to per-command help. `openbrain <command> --help` / `-h` prints that
command's flags (required vs optional), value types, and at least one example
invocation to **stdout** and exits 0. Help is **local** — it needs no key, no
base URL, and makes no request. The text is precise enough that an agent reading
only the help output can construct correct invocations (exact flag names, which
are required, value formats such as "JSON object string" for `--metadata`, UUID
for `--id`, number for `--limit`/`--threshold`).

An **unknown command** is not help — it is a local error (see Edge Cases):
`openbrain: <message>` + usage on **stderr**, exit non-zero, no request. The
usage lets an agent self-correct; the non-zero exit signals failure.

## Delivery Plan

| Slice | Scope | Issue | Depends on |
| ----- | ----- | ----- | ---------- |
| `S1`  | OpenBrain CLI (`openbrain`) | #9 | #3 #5 #6 #7 #8 |

## Edge Cases & Error States

| Scenario | Expected Behavior |
| -------- | ----------------- |
| Unknown command | `openbrain: <message>` + usage on stderr, exit non-zero, no request |
| `--key` given without a value | `openbrain: Missing value for --<key>` on stderr, exit non-zero, no request |
| Missing `--api-key` / `--base-url` | `openbrain: <message>` on stderr, exit non-zero, no request |
| Both flag and env set | Flag wins |
| `--base-url` without `/v1`, or a hosted-MCP URL | Used verbatim; fails at the API (e.g. `404`/`405`), surfaced as non-OK |
| Missing `--id` (fetch/delete) | `openbrain: <message>` on stderr, exit non-zero, no request (path param — URL cannot be formed) |
| Malformed `--id` (not a UUID, incl. `../foo`) | Forwarded as one encoded segment; API 400 `` `id` must be a valid UUID v4. `` (never a wrong-route 404) |
| Missing `--content` / `--query` | Forwarded; API rejects (`` `content` must be a non-empty string. `` / `` `query` must be a non-empty string. ``) |
| `--limit` / `--threshold` unparseable (`abc`, `Infinity`) | Forwarded as raw string; API rejects (`` `limit` must be a number when provided. `` / `` `threshold` must be a number in [0, 1]. ``) |
| `--metadata` invalid JSON | `openbrain: <message>` on stderr, exit non-zero, no request |
| `--metadata` valid JSON but not an object (`[]`, `42`) | Forwarded; API 400 `` `metadata` must be a JSON object when provided. `` |
| API 404 on fetch/delete | Non-zero exit, `Memory not found.` (server string) on stderr |
| API 401 | Non-zero exit, `Unauthorized.` on stderr |
| API non-OK without `error` body (3xx, proxy) | `Request failed with <status>` on stderr, exit non-zero, nothing on stdout |
| Network failure (DNS/refused/timeout/TLS) | `openbrain: <message>` on stderr, exit non-zero, nothing on stdout |
| HTTP 3xx | Not followed; surfaced as non-OK (`x-api-key` is not re-sent) |

## Observability

**Request / tool telemetry:** None. Do not print or log the API key,
`x-api-key`, or request headers.

**Audit / domain events:** None.

## Out of Scope

- Interactive TUI
- MCP
- Bulk import / export
- Storing the API key in a config file (env/flags only for this slice)
- Man pages and shell completion (`--help` is the documentation surface)

## Open Questions

- None.
