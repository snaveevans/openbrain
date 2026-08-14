---
name: spec-implement
description: Implement an Open Brain feature from its spec(s) and the GitHub issue test plan. Detects the target spec from recent spec changes, loads the `<!-- openbrain-test-author -->` comment, builds one delivery-plan slice, or implements only what changed in an updated spec. Use after a spec is in review or in-progress and after test-author has posted the plan. Do not use when the user only wants a test plan (test-author) or a coverage verdict (test-review).
---

## Hard rules

1. **Existing tests stay honest.** Make them pass. Do **not** weaken assertions. You **may add** tests for new acceptance criteria and for the issue plan. If an existing test contradicts the spec (wrong status, reused error string, missing leftover spy the spec now requires), stop and report — hand back to the human, `spec-author`, or `test-author`. Do not quiet the test to match the code.
2. **Spec is behavior; the issue plan is what to assert.** Do not invent product policy. If the plan and the spec disagree, stop — do not pick a winner.

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

## Load the issue test plan

Resolve the GitHub issue from, in order:

1. Explicit number in the user request
2. The Delivery Plan `Issue` cell for the target slice
3. Leading digits in the branch name (`feat/5-…` → `#5`)
4. Ask if still unknown

Then **run this** and take the comment whose body contains `<!-- openbrain-test-author -->`:

```bash
gh issue view <N> --comments
```

If several comments have the marker, use the **latest**. That comment is the live plan (`test-author` patches in place).

- **No issue, or no marker** → stop. Hand back to `test-author`. Do not invent a plan, and do not implement from the spec alone. The plan is where leftover spies, fake ports, and the minimum confidence set live; the spec must not grow those.
- **Plan present** → read it in full. Implement the **Minimum confidence set** and every **P0** row. P1 only when it is cheap or the user asks. Skip P2 unless asked.
- If the plan's product calls are not yet in the spec (edge row, validation string, or AC), stop and hand back to `test-author`. Do not encode an undocumented call.

State issue number and plan comment URL in the same confirmation line as the spec and slice.

---

## Pre-flight (both modes)

Preferred layout: `docs/specs/features/` (see `docs/specs/SPECS.md`). Read the feature spec **and** the issue plan before proceeding. Then verify:

1. **Status is `review` or `in-progress`, not `wip`/`draft`** — if draft/wip, stop and hand back to `spec-author` before writing any code.
2. **No blocking open flags** (`NOT SPECIFIED`, unresolved decisions that change behavior).
3. **Acceptance criteria exist** and are testable.
4. **Target slice criteria are clear** — criteria tagged `Sn` exist; if multi-criterion with no Delivery Plan/tags, stop and send back to `spec-author`.
5. **Issue plan is loaded** — marker comment exists; P0 / minimum confidence set are understood; plan and spec do not disagree.
6. **Repo conventions** — read `AGENTS.md` / README for architecture, commands, and layer rules. Those beat any default in this skill.

If pre-flight passes, summarize what will be built (spec boxes + P0 tests) and confirm before writing code.

---

## New

Implement the **target slice** across every layer it touches. Dependency direction and layer names come from the **repo** (see `AGENTS.md`). If the repo uses inward-only layers, respect them.

Work through [layer-checklist.md](layer-checklist.md) as a **prompting aid**, adapted to this repo's actual paths.

**After each meaningful layer/chunk:** run the repo's lint/typecheck (from package scripts). Do not accumulate errors.

**After the slice:**

- Run the relevant test command(s) from the repo (prefer the acceptance tests for this slice).
- Confirm the minimum confidence set from the issue plan has tests, not just handler code.
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

**5. Verify** with lint/typecheck/tests as above. Still do not weaken existing acceptance tests. New tests for the spec delta and the issue plan are in scope.

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

- Check off boxes tagged with this slice (`- [ ]` → `- [x]`) only when behavior is implemented **and covered by a test** that would fail if the leftover / message / default were wrong — not a status-code-only stand-in.
- Update `status` per SPECS.md conventions.
- Note unmet criteria and unmet P0 plan rows, and why.
- If behavior diverged from the spec or the issue plan, remind the user to revise via `spec-author` / `test-author`.
- Hand off to `test-review` (coverage vs the spec and the issue plan) and then
  `validation-gate` (rebase, review, risk-score, PR). Do not open a bare PR
  after a spec slice unless the user asks.
