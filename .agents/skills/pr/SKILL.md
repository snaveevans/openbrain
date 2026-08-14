---
name: pr
description: Open a pull request for the current branch with the repo template filled in, including a risk score. Use when asked to open a PR, create a pull request, or /pr. Prefer validation-gate when the user wants the full pre-PR gate.
---

# Open a PR

Open a pull request for the current work.

Prefer the `validation-gate` skill when the user wants rebase + review +
risk + evidence. This skill is the thinner path: fill the template honestly
and create the PR.

## Preconditions

1. Run `git status`, `git diff`, and `git log` against the base branch.
   Confirm we are **not** on `main`.
2. Prefer that local checks already passed (`npm run build` and any lint /
   type-check / test scripts that exist). If the user wants a draft or the
   suite was skipped, say so in the body.
3. Confirm one concern (see `AGENTS.md`).

## Issue number

Resolve the GitHub issue number from, in order:

1. Explicit number in the user request
2. Leading digits in the branch name (`feat/42-…` → `42`)
3. Commit footers (`Closes #N` / `Refs #N` / `Fixes #N`)
4. Ask the user if still unknown and an issue is likely

If there is no issue, omit the Related section.

## Link mode

- Default to **`Closes #N`** (or **`Fixes #N`** for a pure bugfix) when this
  PR fully resolves the issue.
- Use **`Refs #N`** when this is a partial slice, or the user said partial /
  slice / WIP.
- Never invent an issue number.

## PR contents

- **Title:** concise, imperative; optional `(#N)` suffix when linked.
- **Body:** fill `.github/pull_request_template.md`:
  - Summary (1–3 bullets from the actual diff)
  - Related (`Closes` / `Fixes` / `Refs` as decided)
  - **Risk** — level `L|M|H|C`, why, and human validation budget. Score from
    the hybrid rubric in the `validation-gate` skill even if that skill was
    not run.
  - **Evidence** — named tests, traces, or short manual steps
  - Test plan (concrete steps, not empty checkboxes only)
  - Spec / AC link when feature work touched `docs/specs/`
  - Validation gate checklist + escalations only when the gate was run

Push the branch if needed, then `gh pr create`. If updating an already-pushed
branch after a rebase, `git push --force-with-lease` on this feature branch
only. Never force-push `main`. Committing and pushing are autonomous; only
**merge** needs explicit approval.

Prefer a ready PR; use `--draft` only if the user asked or checks were skipped.

## Output

Return the PR URL.
