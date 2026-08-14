---
description: Review a PR or the current branch diff
argument-hint: "[PR number or URL — omit to review the current branch]"
disable-model-invocation: true
---

Use the `pr-review` skill to review $ARGUMENTS.

If no argument was given, review the current branch against `main`.

When the target is a PR, the review posts its verdict as a comment.
Add "don't post" to keep it in-session.
