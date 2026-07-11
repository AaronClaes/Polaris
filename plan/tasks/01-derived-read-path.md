# Task 1 — Derived read path

**Tracer goal:** an issue row grows the worktree glyph for a worktree you created
*by hand in the terminal* — proving the derived model (GitHub linkedBranches ∩
`git worktree list`) end to end before Polaris can write anything.

## Scope

In: read-only worktree discovery, main → tRPC → issues-table glyph + popover
showing branch and path. Out: creation, launchers, removal, tasks feed, PRs.

## Implementation

**`src/main/services/worktrees.ts` (new)**
- `listWorktrees(repoPath)` — run `git worktree list --porcelain` with cwd =
  the repo's clone, via the same login-shell `execa` pattern as
  `action-runner.ts` (`$SHELL -ilc`) so the packaged app finds git. Parse
  porcelain stanzas into `{ path, branch, head, isMain }` (branch from
  `branch refs/heads/<name>`; detached/bare stanzas skipped; the first stanza is
  the main clone — exclude it, we only surface *added* worktrees).
- Resolve a repo's clone path: `project_repos.path` falling back to the owning
  project's `path` (same fallback the schema comment documents). No path or the
  dir missing → return `[]` (not an error) so rendering never breaks.

**`src/main/trpc/routers/worktrees.ts` (new, mount in `trpc/router.ts`)**
- `forRepo({ owner, name })` query → `{ branch, path }[]`. Look up the linked
  repo row for owner/name to find the clone path. Keep it a plain query — the
  renderer already knows each row's owner/name.

**Renderer**
- `src/renderer/src/components/worktree-glyph.tsx` (new): given a row's
  candidate branch names + the repo's worktree list, render nothing (this task:
  no create affordance yet) when no branch has a worktree, or the persistent
  glyph (branch icon) opening a popover listing each matching worktree's branch
  + path. Reuse vendored ui/ popover primitives.
- Wire into `project-issues.tsx` rows: candidate branches = the issue's
  `linkedBranches` names; worktree data via one `worktrees.forRepo` query per
  repo (React Query, e.g. 30s staleness — git is cheap but not free).

## Validation

1. Pick an issue that has a linked branch (or link one on GitHub by hand).
2. In the terminal: `git worktree add ../wt-test <that-branch>` in the repo.
3. Dev app → project issues: the row shows the glyph; popover shows branch +
   the path you used.
4. `git worktree remove ../wt-test` → after refetch the glyph is gone.
5. Repo with no local path set: no glyph, no errors in console.
