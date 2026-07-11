# Task 5 — Tasks feed + PR rows

**Tracer goal:** the surface you actually live in — the tasks feed — shows the
same glyph/create affordances, and a PR row can pull its head branch down as a
worktree. The branch-keyed model proves itself: an issue and its fused PR row
resolve to the *same* worktree.

## Scope

In: feed rows (issues + PRs only), PR head-branch worktrees, fork-PR exclusion.
Out: emails/todos (no branches), a standalone worktrees overview (post-v1).

## Implementation

**PR data**
- Check the pulls GraphQL query (`services/github.ts`) for `headRefName` and
  `isCrossRepository`; add whichever is missing to the query + `PullRequestRow`
  (this flows into the persisted `tracked_items` payload automatically via the
  existing reconcile).

**Candidate branches per row (the one rule)**
- Issue row → its `linkedBranches` names.
- PR row (incl. fused) → head branch name first, plus the linked issue's
  branches when fused.
- Fork PR (`isCrossRepository`) → no worktree affordance at all.
- Extract this resolution as a small shared helper next to the glyph component
  so the issues table and the feed use literally the same code.

**Create from a PR**
- The head branch already exists, so creation skips GitHub entirely:
  `create` grows a mode for existing branches (fetch + worktree add only) —
  which is also, by construction, the retry path for a half-failed issue
  creation. Dialog simplifies for this mode: branch fixed (not editable), no
  base select; path preview + recipe select unchanged.

**Feed wiring — `work-item-feed.tsx`**
- Add the glyph to `WorkItemRow`'s trailing controls for issue/PR kinds; the
  create affordance stays hover-revealed to keep rows calm. One `forRepo` query
  per distinct repo among rendered rows (the feed is small; per-repo queries
  with shared React Query keys dedupe across issues table and feed anyway).

## Validation

1. An issue with a worktree shows the glyph in the feed; popover launchers work
   from there.
2. Open a PR from that branch → the fused PR row shows the *same* worktree
   (same path in the popover).
3. A PR row without a worktree: create → branch fetched, worktree added, no new
   branch created on GitHub.
4. A fork PR row (if one exists anywhere reachable): no worktree affordance.
