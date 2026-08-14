# Triage Checklist

Run every surviving comment, review, and failing check through these tests,
in order. The first test that lands decides the bucket. An item you cannot
place is an item to escalate, not to guess at.

---

## Test 1 — Is it a request at all?

Praise, acknowledgment, thinking out loud, and a reviewer answering their
own question need no action.

→ **Nit / praise / ack.** Skip silently.

A nit is a stylistic preference the repo does not encode in `AGENTS.md`,
lint, a spec, or an ADR. If the reviewer marked it "nit" *and* it is a
two-line change you are already touching, doing it is cheaper than the
reply.

## Test 2 — Is it a question rather than a change request?

"Why is this here?" is a request for understanding. Answering with a
commit is a common expensive mistake.

→ **Question.** Answer in the thread, cite the ADR or spec if one governs
it, write no code.

If the answer is "you're right, this is wrong" — re-run at Test 4.

## Test 3 — Is it real?

- Read the **current** code, not the hunk quoted in the comment.
- Name the input, state, or call path that produces the bad outcome.
- Check what local scripts / CI already enforce. If those are green, a
  comment claiming a type error or a missing build is mistaken.
- Check for an explicit silence (lint-ignore, comment, ADR).

→ Fails any of these: **Incorrect.** Reply once with evidence. One round.

## Test 4 — Was it caused by this PR?

- Untouched pre-existing code → not this PR (Test 5 / out of scope).
- Code the diff touched or broke → in play.

## Test 5 — Is it inside this branch's concern?

`AGENTS.md`: one concern per branch. Name this PR's concern from the PR
body and its spec.

Out of scope:

- A rename or refactor adjacent to the change but not part of it
- A new mechanism (store, embedding vendor, OAuth, Durable Objects) the
  PR does not already introduce
- A feature or edge case the spec does not cover
- Anything that would push the diff meaningfully past ~40 files or
  ~800 net lines

In scope even if it grows the diff:

- A test for behavior this PR introduces
- A doc update this change makes necessary (spec checkbox, `SPECS.md`,
  ADR index)
- A fix to something this PR broke

→ **Valid, out of scope** or **Valid, in scope**.

## Test 6 — Would the fix violate a repo convention?

Examples: a client implementing domain rules (ADR-0004), accepting the
API key from `Authorization: Bearer`, logging `x-api-key`, inventing
product policy with no spec.

→ **Escalate.** Do not implement it, and do not simply refuse. Tell the
user what was asked, which convention it hits, and what you would do
instead.

---

## Failing checks

1. Read the job log.
2. Does it fail on `main` with this diff absent? Say so once; re-run when
   base recovers.
3. Otherwise it is in scope. Re-running a flake counts; assuming a flake
   without checking does not.

---

## Quick reference

| Test | Yes → | No → |
| ---- | ----- | ---- |
| 1. A request at all? | continue | **Nit / praise / ack** |
| 2. Asking for code, not an answer? | continue | **Question** |
| 3. Verifiably real? | continue | **Incorrect** |
| 4. Caused or touched by this PR? | continue | **Out of scope** |
| 5. Inside this branch's concern? | continue | **Out of scope** |
| 6. Fix respects repo conventions? | **Valid, in scope** | **Escalate** |
