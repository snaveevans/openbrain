---
name: spec-implement
description: Implement an Open Brain feature from its spec(s). Detects the target spec from recent spec changes, builds one delivery-plan slice, or implements only what changed in an updated spec. Use after a spec is in review or in-progress.
---

## Hard rule

If acceptance tests for this slice already exist, **make them pass**. Do **not** edit those test files or weaken assertions. If a test is wrong, stop and report — hand back to the human or `spec-author`.

## Find the target spec

Do NOT expect an argument. **Run this** and work out which spec to implement from
git state:

```bash
echo "── Uncommitted spec changes ──"
git status --porcelain -- 'docs/specs/**/*.md'
echo "── Spec files changed vs main ──"
git diff --name-only main -- 'docs/specs/**/*.md' 2>/dev/null
echo "── Recently committed specs ──"
git log --oneline -10 --name-only -- 'docs/specs/**/*.md' 2>/dev/null
```

Use the output to pick the target and the mode:

- A **new, untracked** spec file (or a spec with no implementing code yet) → **New** (full build for the slice).
- An **existing** spec with uncommitted edits or recent commits that changed it → **Diff** (implement only the delta).

Then pick the **target slice**: open the spec's **Delivery Plan** and choose the next slice (`Sn`) whose tagged criteria are still `[ ]`, respecting the plan's `Depends on` order. You implement **one slice per PR** — its scope is exactly the criteria tagged `Sn`. A single-slice spec has one slice (`S1`) = the whole thing.

Propose the spec file(s), the target slice, and the mode you inferred in one line and confirm with the user. If nothing relevant shows up, or several candidates are equally likely, ask which feature to implement.

---

## Pre-flight (both modes)

Preferred layout: `docs/specs/features/` (see `docs/specs/SPECS.md`). Read the feature spec before proceeding. Then verify:

1. **Status is `review` or `in-progress`, not `wip`/`draft`** — if draft/wip, stop and hand back to `spec-author` before writing any code.
2. **No blocking open flags** (`NOT SPECIFIED`, unresolved decisions that change behavior).
3. **Acceptance criteria exist** and are testable.
4. **Target slice criteria are clear** — criteria tagged `Sn` exist; if multi-criterion with no Delivery Plan/tags, stop and send back to `spec-author`.
5. **Repo conventions** — read `AGENTS.md` / README for architecture, commands, and layer rules. Those beat any default in this skill.

If pre-flight passes, summarize what will be built and confirm before writing code.

---

## New

Implement the **target slice** across every layer it touches. Dependency direction and layer names come from the **repo** (see `AGENTS.md`). If the repo uses inward-only layers, respect them.

Work through [layer-checklist.md](layer-checklist.md) as a **prompting aid**, adapted to this repo's actual paths.

**After each meaningful layer/chunk:** run the repo's lint/typecheck (from package scripts). Do not accumulate errors.

**After the slice:**

- Run the relevant test command(s) from the repo (prefer the acceptance tests for this slice).
- Regenerate committed API/docs artifacts only if the repo already has that convention.
- Finish with the project's standard pre-commit check if documented.

---

## Diff

Implement only the delta between the spec's last committed state and its current state.

**1. Get the spec diff**

```
git diff main -- "<detected-spec-path>" 2>/dev/null || git diff HEAD~1 -- "<detected-spec-path>" 2>/dev/null || echo "No diff found"
```

**2. Interpret the diff** — map each change to code impact (new AC → path; removed AC → delete/simplify; edge cases → logic; resolved flags → behavior). Confirm with the user before coding.

**3. Locate existing code** for this feature; read before editing.

**4. Implement only the delta.** No unrelated refactors.

**5. Verify** with lint/typecheck/tests as above. Still do not edit acceptance tests.

---

## Slicing

A large spec declares a **Delivery Plan** (`S1`…). Implement **one slice per PR**:

- Spec file stays whole — do not split it.
- Implement criteria tagged with the target slice; check off only those boxes in the same PR.
- Respect `Depends on`.
- **Status:** first shipped slice → `in-progress`; last box checked → `active`.

---

## Completion

When the slice's implementation is done:

- Check off boxes tagged with this slice (`- [ ]` → `- [x]`) only when behavior is implemented **and covered by a test**.
- Update `status` per SPECS.md conventions.
- Note unmet criteria and why.
- If behavior diverged from the spec, remind the user to revise via `spec-author`.
- Hand off to the `validation-gate` skill to rebase, review, risk-score, and
  open the PR. Do not open a bare PR after a spec slice unless the user asks.
