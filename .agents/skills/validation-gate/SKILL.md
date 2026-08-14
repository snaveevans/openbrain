---
name: validation-gate
description: Take finished branch work through rebase, adversarial review, tests, docs, risk score, evidence, and a clean PR. Use when asked to gate a change, run validation-gate, prepare a PR with risk, or hand off after implementation.
---

# Validation gate

Quality gate between "agent says done" and "human judges the PR."

Built on this repo's `pr-review`, `pr-respond`, and `pr` skills. The agent
commits and pushes its own branch. The human owns the **merge**. Risk on the
PR body tells the human how much time to spend.

## What this skill is not

- Not a replacement for `pr-review` or `pr-respond` — it **orchestrates** them
- Not a license to merge without explicit user approval
- Not a reason to skip Risk if you open a bare PR instead

## When to run

- After implementation, before or instead of a bare `pr`
- When the user says "gate this", "validation-gate", or "open the PR"
- As the verify→PR tail of `spec-implement` (after `test-review` on a spec slice)

## Pipeline

Run steps in order. Stop on a hard failure unless the user waives it. The PR
body is the audit trail.

### 0. Preconditions

```bash
git status
git branch --show-current
git fetch origin
```

- Must **not** be on `main`.
- **Commit intended work before rebasing.** Commit the branch autonomously;
  do not commit to `main`. Do not stash-and-rebase to skip this.
- No unrelated dirty files. If unrelated paths are dirty, include only
  intended paths or stop and ask.
- Capture **intent** in 2–4 lines from: user request, issue body, accepted
  spec slice, and recent session decisions. Intent drives review and
  evidence — not "whatever the diff happens to do."

State branch, base (`origin/main`), and intent in one short block before
continuing.

### 1. Rebase onto latest main

```bash
git fetch origin
git rebase origin/main
```

- Resolve conflicts yourself when mechanical.
- If resolution needs a **product** choice, stop and escalate.
- **Already-pushed branch:** rebase rewrites SHAs, so step 7 uses
  `git push --force-with-lease` on this feature branch only. Detect with
  `git rev-parse --abbrev-ref '@{u}' 2>/dev/null`. Never force-push `main`.

### 2. Fresh-context adversarial review

Invoke the `pr-review` skill on the **current branch diff** against `main`.

- Findings the skill would score 80+: **fix** when safe and mechanical.
- Findings that change product behavior, API contract, or auth: **do not
  silently fix** — add to **Escalations**.
- Re-run review after fixes if you changed code.

Keep branch-diff findings in-session and fold survivors into the PR body's
escalations.

### 3. Verify (local CI shape)

Run whatever the repo actually has, in this order if present:

```bash
npm run build
```

Then any workspace `lint`, `type-check`, and `test` scripts that exist
(`npm run lint`, `npm run type-check`, `npm test`, or per-package
equivalents). Do not invent a tool the package.json does not define.

Do not open a PR with a known-red branch.

### 4. Docs pass

Against the captured intent and the diff:

- Spec AC boxes for the slice this PR implements (`[ ]` → `[x]` only if
  tested on this branch and the box is allowed to flip in the same PR)
- `docs/specs/SPECS.md` if a spec was added or its status changed
- `docs/decisions/README.md` if an ADR was added
- No secrets, `.env`, or key material

When the diff implements or changes specified behavior, run the **spec
check** below. Fix violations or update the spec in this PR. Do not open
with a known contradiction.

#### Spec check

Inputs: the relevant feature spec(s), and `git diff origin/main...HEAD`.

Classify each meaningful change:

- **VIOLATION** — contradicts a specific spec line. Fix the code or edit
  the spec in this PR. Escalate if that is a product call.
- **GAP FILLED** — new observable behavior the spec does not cover. Add
  it to the spec in this PR, or escalate if the gap is a new feature.
- **IMPLEMENTATION DETAIL** — no observable behavior change. Leave the
  spec alone.

Skip this check for docs-only, chore, or ADR-only diffs that do not
change product behavior.

### 5. Score risk (hybrid)

Compute a **path-glob baseline** from
`git diff --name-only origin/main...HEAD`, apply **semantic elevations**,
then allow an **agent override** (up or down one level) with a one-line
reason. Human may bump again on the PR.

**Path-glob baseline** (highest matching floor wins):

| Level | Any matching path |
| ----- | ----------------- |
| **C** | `migrations/**`, irreversible schema / data backfill files |
| **H** | REST Worker / composition root (`**/worker.ts`, `**/wrangler.*`), shared contract package (`packages/**/common/**`, `packages/openbrain-common/**`), auth implementation, `.github/workflows/**` |
| **M** | other `packages/**` source (remote MCP, local MCP, CLI, API handlers that are not the composition root), a diff that mixes code + tests |
| **L** | `docs/**`, `*.md`-only, test-only, pure chore, generated types **with** matching source |

**Semantic elevations** (raise the baseline; never lower it):

| Raises to | Signal |
| --------- | ------ |
| **C**     | `API_KEY` / secret comparison, logging of credentials, irreversible data, security-sensitive crypto |
| **H**     | REST route or status/body contract change, MCP tool schema change, agent listed a product escalation |

Baseline = max(path-glob floor, semantic elevation).

**Override rules:**

- Never override **below C** if a C path-glob **or** a C semantic signal matched.
- Override **up** when intent is product-ambiguous, blast radius is unclear, or evidence is thin.
- Override **down** one level only when the diff is narrower than the baseline
  (e.g. a comment-only touch under `worker.ts`) — say why. Down-override is
  forbidden past C.

**Human validation budget** (copy onto the PR):

| Level | Budget |
| ----- | ------ |
| **L** | Glance evidence. Do not read the diff. |
| **M** | Evidence + escalations; spot-check 1–2 hot files. |
| **H** | Full review + local poke on auth/API/data paths. |
| **C** | Plan must have been human-approved; deep review required. |

### 6. Evidence pack

Attach proof that the change meets **intent**, not merely that tests passed.

Prefer, in order:

1. Named tests that exercise the behavior (file + test name)
2. HTTP traces or integration output for a REST contract path
3. Manual steps with expected results (last resort; keep short)

Thin evidence on an **H/C** change is itself an escalation: say what's missing.

### 7. Open or update the PR

Follow `.github/pull_request_template.md` and `AGENTS.md` → Opening a PR.
Prefer the `pr` skill for title, issue link, and `gh pr create`.

Fill **every** section that applies:

- Summary, Related, Risk, Evidence, Test plan, Spec/AC, Validation gate, Escalations

Push path:

- **New PR** (no upstream): `git push -u origin <branch>`, then `gh pr create`.
- **Update after rebase**: `git push --force-with-lease` on this feature
  branch only. Never force-push `main`.

**Gate:** Commit and push autonomously. Do not **merge** without explicit
user approval.

### 8. Babysit CI (optional)

After the PR exists and CI has run (when the repo has CI):

- Green → report URL + risk + what the human should do per budget.
- Red → invoke `pr-respond` for failing checks only.
- Re-score risk if the fix round materially grew scope.

Do not merge unless the user asks.

## Report shape

```text
Branch: …
Intent: …
Risk: L|M|H|C — reason
Evidence: …
Escalations: none | …
PR: url or "not opened — <reason>"
Human budget: <one line from the table>
Next: <what you need from the human, if anything>
```

## Relationship to other skills

| Skill | Role under this gate |
| ----- | -------------------- |
| `test-review` | Before this gate: tests vs spec + issue plan. Fold survivors into Evidence / Escalations |
| `pr-review` | Step 2 adversarial review |
| `pr-respond` | Step 8 CI / review thread handling |
| `pr` | Step 7 mechanics |
| `spec-implement` | May hand off here instead of a bare PR |
