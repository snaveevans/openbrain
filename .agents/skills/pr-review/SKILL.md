---
name: pr-review
description: Review a pull request or the current branch diff for bugs, AGENTS.md adherence, and architectural fit. Scores findings for confidence, reports only what survives, and posts an approved / changes-requested verdict on PR targets. Use when asked to review a PR, review a branch before opening one, or check a change before merge.
---

# PR review

Adapted from pineapple's `pr-review` (itself adapted from Anthropic's
`code-review` plugin). Reviews a **branch diff** as well as a PR, and
**posts a verdict comment** on PR targets.

## Identify, don't fix

This skill finds problems. It does not solve them. Do not edit files, write
patches, suggest diffs, or describe how to fix a finding. State what is
wrong and why it matters.

A finding is complete when a reader knows the defect and its consequence.
Do not add "…, so extract it into a helper."

## Pick the target

- A PR number or URL in the request → read that PR's diff and metadata
  (`gh pr diff`, `gh pr view`, GitHub MCP, or the API). Do not assume `gh`
  exists. If none is available, fall back to the branch diff and say so.
- Otherwise → review the current branch against `main`
  (`git diff main...HEAD`).

State which target you picked, and which access path, in one line before
starting.

## 1. Eligibility (PR targets only)

If the PR is closed, a draft, automated, or trivially safe, stop and say
why — and do not post. Skip this step for a branch diff.

A prior verdict comment is **not** a stop. Eligibility governs whether the
review *runs*; posting is step 7.

## 2. Check for prior review (PR targets only)

Find the **most recent** comment carrying the
`<!-- openbrain-pr-review -->` marker.

- **No marker** → full review against `main`.
- **Marker naming SHA `S`** → review `S..HEAD`.
  - Diff empty, or only lockfile / generated types → nothing reviewable.
    Say so in-session, post nothing, stop.
  - Otherwise → incremental review of `S..HEAD`, and carry forward any
    unresolved finding from the prior verdict.

Skip this step for a branch diff.

## 3. Gather context

Collect paths (not contents) of `AGENTS.md` and any package README the
change touches. Summarize the change in a few lines. On an incremental
review, summarize only `S..HEAD`.

## 4. Review the change

**Dependency-bump PR** (author `dependabot[bot]`, diff only
`package.json` / lockfile): skip the fan-out. Confirm the diff is confined
to manifests. If it touches source or config, fall through to a real
review. Otherwise note the version jump and approve.

**First review** — fan out these five in parallel. Each returns issues plus
why they were flagged.

1. **Conventions** — audit against `AGENTS.md` and the repo-specific
   targets below.
2. **Bugs** — read only the diff. Favor large problems over nitpicks.
3. **History** — `git blame` and history of the modified code.
4. **Prior review** — earlier PRs touching these files.
5. **Comments and docs** — nearby comments, the relevant spec in
   `docs/specs/`, and any ADR the change depends on.

**Incremental review** — one pass over `S..HEAD` against the same five
angles. Do not re-fan-out.

## 5. Score every finding

Independently score confidence 0–100:

- **0** — False positive under light scrutiny, or pre-existing.
- **25** — Might be real; could not verify. Stylistic issues `AGENTS.md`
  does not call out.
- **50** — Verified real, but a nitpick or rare in practice.
- **80** — Double-checked, likely hit in practice, and the PR's approach
  is insufficient. Or named directly in `AGENTS.md`.
- **100** — Confirmed, frequent, evidence supports it.

For `AGENTS.md` findings, confirm the file actually says that. **Drop
everything under 80.** A quiet review is a valid result.

## 6. Report in-session

If a `ReportFindings` tool is available, use it, ranked most-severe first,
and do not also print the findings as prose. Otherwise print them: file
and line, the defect, and why it matters. No fix, no patch.

## 7. Post the verdict (PR targets only)

- **Changes requested** — one or more findings scored 80+ (including
  unresolved carry-forwards).
- **Approved** — nothing survived scoring.

Post as a **plain PR comment**, not a formal GitHub review. Formal
`REQUEST_CHANGES` blocks merge until a human dismisses it, and GitHub
rejects an approval from the PR's own author.

Skip posting when: the target is a branch diff, the request said not to
post, step 1 stopped the review, or step 2 already has a verdict on the
current head SHA with nothing reviewable since.

```markdown
<!-- openbrain-pr-review -->

## Code review: changes requested

Reviewed `<full head SHA>` against `main`.

1. **`packages/…/file.ts:42`** — what is wrong, and the consequence.
2. ...

<sub>Covered: bugs, AGENTS.md adherence, architectural fit. Not covered:
lint, type-check, and tests (run those locally / in CI), test coverage,
and general security posture.</sub>
```

On approval, use `## Code review: approved`, drop the findings list, and
say in one line what you looked at.

Every posted comment must carry:

- The head SHA it reviewed
- The `<!-- openbrain-pr-review -->` marker
- The scope caveat

### Edit by ID — never blind-edit

Use the comment id from step 2. Prefer `PATCH` on that comment. **Do not
use `gh pr comment --edit-last`.** Agent and maintainer share one GitHub
account in this repo.

If there is no edit path: post a new comment **only when the verdict or
findings differ**. Open with `Supersedes the verdict on <old head SHA>.`

## What not to flag

Do not flag things the repo already fails locally or in CI when those
scripts exist:

- Type errors, formatting, import mistakes
- Missing `npm run build` failures that are already red

Also skip: pre-existing issues, pedantic nitpicks, missing coverage unless
`AGENTS.md` requires it, findings on untouched lines, intentional behavior
that is the point of the PR.

## Repo-specific review targets

Lint cannot make these calls. This is where the review earns its keep.

- **REST is the domain surface (ADR-0004)** — remote MCP, local MCP, and
  the CLI are thin clients. Flag a client that embeds, stores, authorizes
  on its own, or invents fields the REST contract lacks.
- **Auth is the shared API key** — `x-api-key` only
  ([authentication](../../../docs/specs/cross-cutting/authentication.md)).
  Flag Bearer/query/body keys, a missing-config that fails open, logging
  the key, or treating the key as an owner id.
- **Single-tenant store** — flag partitioning memories by the API key.
- **Specs vs ADRs** — flag product policy invented in code with no spec,
  or implementation mechanism stuffed into an ADR.
- **Secrets** — flag committed `.env`, keys, or tokens.
- **Scope discipline** — one concern per branch. ~40 files or ~800 net
  lines is a signal to split. Flag an unrelated refactor riding along.
- **Docs sync** — a feature slice should tick only its own spec boxes
  when tested; a new spec or ADR should be indexed.
