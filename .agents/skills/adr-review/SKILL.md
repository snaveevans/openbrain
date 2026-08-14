---
name: adr-review
description: Thoroughly review an Architecture Decision Record — altitude, completeness, and the rigour of its options analysis. Use when asked to review, critique, or sanity-check an Open Brain ADR, before accepting a proposed one, or to audit an existing decision record.
---

# ADR Review

You are reviewing a decision record, not writing one. You **never edit the ADR** —
you report findings and a verdict.

## Why a separate reviewer

The author of an ADR is the worst-placed person to judge it. They already made the
decision, so the options they wrote read as obviously-weighed to them, and the
mechanism they know intimately reads as essential context. You come in cold and
see what they cannot.

## Before anything: what are you reviewing?

Read the target ADR in full, plus `docs/decisions/README.md` (the house rules for
statuses, numbering, and full-vs-short form — those beat any default here).

**Status changes what a finding can do:**

- **`proposed`** — still a draft. Findings go back to the author for revision.
- **`accepted`** — immutable. The body cannot be fixed. A material finding means
  the decision needs a **superseding ADR**, not an edit. Say that explicitly
  rather than requesting changes that would corrupt the ledger.

If the ADR is accepted and your findings are cosmetic, the right answer is
usually "record stands" — an imperfect historical record is still the record.

---

## 1. Should this be an ADR at all?

Apply the README's "When to write one" test: hard to reverse, real alternatives
existed, or a future reader would ask "why did they do it this way?"

Be willing to say no:

- Describes **how a feature behaves or is built** → that is spec detail, belongs
  in `docs/specs/`.
- Small, obvious, or trivially reversible → a code comment is enough.

Naming an ADR that should not exist is a successful review, not a failed one.

## 2. Altitude

Work through [../adr-author/decision-altitude-checklist.md](../adr-author/decision-altitude-checklist.md).
That checklist is the shared standard — apply it as a judge rather than an author.

Go line by line. For each statement: is this **what we decided and why**, or **how
it is carried out**? Mechanism to flag: table schemas, function or module names,
step-by-step algorithms, wire formats, concrete API or MCP tool shapes, retry
counts, config values.

For each piece of mechanism you find, name the spec it belongs in. Do not propose
moving prose yourself — that is the author's call.

## 3. Completeness

Check each is present and load-bearing, not boilerplate:

| Section | The bar |
| ------- | ------- |
| Decision | **One** decision, stated plainly in a sentence. Bundled decisions must be split. |
| Context | The forces that make this decision necessary — the problem, not the solution. |
| Drivers | The qualities and constraints the options are judged against, named explicitly. |
| Options | The alternatives, with honest pros and cons. See below. |
| Outcome | What was chosen, and why it wins **on the stated drivers**. |
| Consequences | Both directions. At least one accepted trade-off. |
| Metadata | Status, date, sequential unused number, README index row. |

A decision whose drivers are implicit reads as arbitrary to a future reader — that
is a finding, not a nitpick.

## 4. Options analysis — review this hardest

This is where ADRs most often fail, and it is the least likely thing the author
will catch themselves.

**Coverage** — Are the alternatives ones a thoughtful reader would actually ask
about? A missing obvious option is a major finding: name it. Was the status quo
(do nothing) considered where it was a live choice?

**Straw men** — the failure mode to hunt for. Signals:

- An option with only cons, or the chosen option with no cons
- Cons that are trivially fixable, or that misstate what the option actually is
- An option dismissed in a clause, with no engagement
- Rejection reasons that are not among the stated drivers

**Judged against the drivers** — each option should be evaluated against the same
named drivers, not against ad-hoc criteria that shift per option.

**Decidability** — could a reader reach the same conclusion from what is written?
If the outcome only follows because the author already knew the answer, the
analysis is decoration. That is a finding.

**Cost of being wrong** — for a hard-to-reverse decision, is reversibility or exit
cost weighed at all?

## 5. Ledger integrity

- Number is sequential and never reused.
- Status is valid per the README.
- If this supersedes another: the new record says what changed and why, the old
  ADR's status is flipped and links here, and **nothing else in the old file
  changed**. Verify that with `git diff` / `git log` on the old file.
- No accepted ADR's body was edited. This is the one that quietly corrupts the
  ledger, so check it rather than assuming.

---

## Output

Start with the verdict:

**Approve** | **Approve with follow-ups** | **Changes required** | **Supersede instead** | **Not an ADR**

Then findings, most severe first. Each one:

- Where — section, and a quote or line reference
- What — the defect, stated plainly
- Why it matters — what a future reader loses, or what breaks
- Direction — what would fix it. Not rewritten prose.

Close with what you did **not** assess (domain facts you could not verify, options
you lack context to judge). A reviewer who implies full coverage they did not have
is worse than one who names the gap.

## Validation

- Every finding cites a location and a reason, never "feels off".
- The altitude checklist was actually applied, not summarised.
- The options section was judged for straw men and decidability, not just presence.
- The ADR's status was respected: no change requests against an accepted record.
- You edited nothing.

## Failure modes

- Symptom: you are rewriting the ADR's prose in your findings.
  - Fix: describe the direction and hand it back. The record is the author's.
- Symptom: every option looks reasonable, so options review passes trivially.
  - Fix: you are reading the author's framing. Ask what a *proponent of each
    rejected option* would say to this write-up.
- Symptom: findings pile up on an accepted ADR.
  - Fix: the verdict is **Supersede instead**. Accepted records are not edited.
- Symptom: the review is entirely about wording.
  - Fix: altitude, missing options, and undecidable reasoning are the substance.
    Style notes belong last, or not at all.
