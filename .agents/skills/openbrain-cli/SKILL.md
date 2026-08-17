---
name: openbrain-cli
description: Store and recall personal memories with the Open Brain CLI (`openbrain`) — a thin client of the Open Brain REST API. Use whenever the user wants to remember, save, persist, or recall context, decisions, notes, facts, or preferences across sessions or projects — e.g. "remember that...", "save this decision", "note this for later", "what did we decide about", "do we have any notes on", "search my memories", "recall what we did for X". Also use proactively to search for relevant past memories before starting a new task, and to record durable decisions, ADRs, or resolved context so future sessions can find them.
---

# Open Brain CLI

`openbrain` is a thin command-line client of the Open Brain REST API — a personal
memory store. It stores free-text memories (optionally tagged with a `source`
and structured `metadata`) and searches them semantically. It is **not** a
database for the current project's code; it is the user's long-term,
cross-project memory that survives session resets.

The CLI makes exactly one HTTP call per command, prints the API's JSON response
**verbatim** to stdout (plus a trailing newline) on success, and exits non-zero
with a message on stderr on any failure. Parse stdout as JSON; treat a non-zero
exit as a hard failure (do not proceed as if it succeeded).

## Prerequisites

The `openbrain` binary must be on `PATH`, and the API key + REST root must be
configured. The user normally sets these once in their shell profile:

```bash
export OPENBRAIN_API_KEY=<key>
export OPENBRAIN_BASE_URL=<rest-root>      # the versioned root, origin + /v1
```

A `--api-key` / `--base-url` flag overrides the env var for a single call. If
either is missing the CLI exits non-zero before any request with
`openbrain: Missing required ...` — in that case, **stop and ask the user to set
`OPENBRAIN_API_KEY` / `OPENBRAIN_BASE_URL`**; do not invent values.

If `openbrain` is not found at all, tell the user it needs to be installed
(`npm link` from the `packages/openbrain-cli` workspace, or built and run via
`node …/dist/bin.js`).

Never print, log, or echo the API key or the `x-api-key` header.

## Commands

All four commands return JSON on stdout (exit 0) or a message on stderr (exit
non-zero). Fields shown as optional are omitted from the request body when not
supplied — do not pass `null`.

### `create` — store a memory

```bash
openbrain create --content "<text>" [--source "<label>"] [--metadata '<json>']
```

- `--content` (required in practice): the memory text. If omitted it is
  forwarded and the API rejects it, so always provide it.
- `--source`: a short label for where/why this was saved, e.g. the project name,
  `adr`, `decision`, `session`. Helps filter later.
- `--metadata`: a **JSON object string** (e.g. `'{"kind":"adr","id":"0007"}'`).
  It is parsed locally, so invalid JSON is a local error (no request is sent).
  Non-object JSON (`[]`, `42`) is forwarded and the API rejects it — pass an
  object.

Success returns `{"memory":{...}}`; the created memory's `id` (a UUID) is in
`memory.id`. Capture it if you may need to fetch or delete later.

### `search` — recall memories by meaning

```bash
openbrain search --query "<text>" [--limit <n>] [--threshold <n>] [--source "<label>"]
```

- `--query`: natural-language search. Always provide it.
- `--limit`: max results (a number). Defaults to 10 at the API.
- `--threshold`: similarity floor, a number in `[0, 1]` (higher = stricter).
- `--source`: restrict to memories saved with that source label.

Success returns `{"matches":[{...memory fields..., "similarity": <0..1>}]}`,
already ranked by descending similarity.

### `fetch` / `delete` — by id

```bash
openbrain fetch   --id <uuid>
openbrain delete  --id <uuid>
```

`--id` is required (it is a path parameter; the URL can't be formed without it).
A non-UUID id is forwarded as one URL-encoded segment and the API returns
`` `id` must be a valid UUID v4. `` — you'll usually only have valid ids from a
prior `create`/`search`.

## How to use it well

- **Recall before you start.** When a task touches something the user has worked
  on before, run a `search` for the relevant terms first — a past memory may hold
  the decision, constraint, or gotcha that saves a wrong turn. Show the user what
  you found if it's relevant.
- **Record durable decisions.** After a decision is made (an architecture call, a
  resolved ambiguity, a "we're doing X not Y"), save it with `create` so a future
  session (or another agent) can find it. Use `--source` to group (e.g. the
  repo name) and `--metadata` for structured lookups (e.g. `{"kind":"decision"}`).
- **Don't store ephemera.** Don't memorize things that are obvious from the repo,
  the current conversation, or that will be stale in an hour. Memory is for what
  should survive across sessions and projects.
- **Quote the user's intent in `--content`.** A memory like "Decided to host on
  Cloudflare (ADR-0003) because of edge latency; Workers AI for embeddings" is
  far more retrievable than "cloudflare decision".
- **Parse, don't eyeball.** On success, `stdout` is exactly the API JSON + `\n`.
  Parse it as JSON. On any non-zero exit, read `stderr` for the cause and surface
  it to the user rather than guessing.

## Quick reference

```bash
# save
openbrain create --content "Decided X over Y because Z" --source myproj --metadata '{"kind":"decision"}'

# recall
openbrain search --query "how do we host" --limit 5
openbrain search --query "auth approach" --source myproj --threshold 0.5

# by id
openbrain fetch  --id 11111111-1111-4111-8111-111111111111
openbrain delete --id 11111111-1111-4111-8111-111111111111

# help (local, no key needed)
openbrain --help
openbrain <command> --help
```

## Notes

- This is a **thin client**: it does no embedding, storage, or second auth. It
  only calls the four REST routes above with `x-api-key`. If a request fails with
  `Unauthorized.`, the key is wrong; if it fails with a 404/405, `--base-url` is
  wrong (it must be the versioned root, `origin + /v1`).
- Config and behavior live in `docs/specs/features/cli.md`; the REST contract in
  `docs/specs/features/rest-api.md`. Read those if you need the exact wire shapes.
