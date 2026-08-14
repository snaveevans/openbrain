---
audience: [who reads this spec]
purpose: [what this feature does — one line]
source: this file
date: YYYY-MM-DD
---

# [Feature Name]

**Status:** `draft` | `wip` | `review` | `in-progress` | `active` | `deprecated`
**Owner:** [name]
**Related Specs:** [cross-cutting specs]

---

## Summary

One paragraph. What this feature does and the user problem it solves. No implementation details.

## User Stories

- As a **[role]**, I can **[action]** so that **[outcome]**

## Acceptance Criteria

<!-- These boxes are the live implementation checklist: check a box (`- [x]`) only when the
behavior is implemented AND covered by a test on `main`. Every criterion carries exactly one
slice tag (`S1`…) from the Delivery Plan below. A criterion that resists a single tag is too
coarse — split it. Each slice PR checks off only its own boxes. See docs/specs/SPECS.md. -->

- [ ] `S1` [Specific, observable behavior]
- [ ] `S1` [Another testable criterion]

## Observable Contract

<!-- The surface a caller interacts with, stated as BEHAVIOR, not code. This is a
     functional requirement — what is observed across the boundary — for products
     whose interface is the product (MCP tool, HTTP, CLI, SDK).
       MCP : `search {query}` → ranked memories | empty result | auth error
       HTTP: `GET /health` → 200 readiness payload, no secrets
     Do NOT put internal class/method design here — that is mechanism.
     Omit this section for features with no external surface. -->

- [contract line — request/response or public operation as behavior]

## Delivery Plan

<!-- Independently reviewable increments, each normally a GitHub issue/PR.
     For a single-slice feature, replace the table with:
     "Single slice — the whole feature (`S1`)." -->

| Slice | Scope                      | Issue | Depends on |
| ----- | -------------------------- | ----- | ---------- |
| `S1`  | [what this slice delivers] | #—    | —          |
| `S2`  | [next increment]           | #—    | `S1`       |

## Edge Cases & Error States

| Scenario   | Expected Behavior   |
| ---------- | ------------------- |
| [scenario] | [expected behavior] |

## Observability

**Request / tool telemetry:** name the operations this feature emits, or write
"None — this feature has no observable operations." Do not log secrets, raw
tokens, or memory contents unless a cross-cutting spec explicitly allows it.

**Audit / domain events:** name them, or write "None."

## Out of Scope

- [Explicitly what this feature does NOT handle]

## Open Questions

- [ ] [Question — owner — target resolution date]
