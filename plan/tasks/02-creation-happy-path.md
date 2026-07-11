# Task 2 — Creation happy path

**Tracer goal:** click "Create worktree…" on an issue → dialog → branch appears
in the issue's Development panel on GitHub *and* a worktree exists under the
root → the Task-1 glyph lights up. The full write path, minimal chrome.

## Scope

In: worktrees-root setting (+ tiny settings UI), creation dialog (branch name,
base branch, path preview), GitHub linked-branch creation, fetch + worktree add.
Out: setup recipes (dialog select comes in Task 4), launchers/remove, PRs,
polished failure states (Task 6) — this task may fail ugly, it just can't fail
silently.

## Implementation

**Worktrees root setting**
- Key `worktreesRoot` in the `settings` table; default `~/polaris/worktrees`
  (resolve `~` main-side via `app.getPath('home')`). Extend `settingsRouter`
  (get + set) following the `defaultApps` pattern; settings page gets a row with
  the existing `PathInput`/`pickDirectory` flow.

**GitHub side — `src/main/services/github.ts`**
- The issues list query has no GraphQL node IDs, so add a small lookup query run
  at creation time: `repository(owner,name){ id defaultBranchRef { name target { oid } }
  refs(refPrefix:"refs/heads/", first:100){ nodes { name target { oid } } }
  issue(number:N){ id } }` → repo node id, branch list for the base-branch
  select, base OID, issue node id. Nothing persisted changes.
- `createLinkedBranch(input:{ issueId, oid, name })` mutation → created ref
  name. Token comes from the existing `resolveRepoToken`; requires the PAT to
  have Contents: write (Aaron re-issues tokens — surfacing a scope error nicely
  is Task 6, here a thrown error is fine).

**Local side — `src/main/services/worktrees.ts`**
- `addWorktree({ repoPath, branch, worktreePath })` — `git fetch origin` then
  `git worktree add <worktreePath> <branch>` (git DWIMs a local tracking branch
  for a remote-only branch). Create parent dirs first.
- Path derivation helper: `<root>/<owner>/<repo>/<sanitized-branch>`; sanitize =
  lowercase, `/` and disallowed chars → `-`. Shared with the dialog's preview
  via the router.

**Router — `worktrees.ts`**
- `creationInfo({ owner, name, number })` query → branches (default first),
  derived branch name (`<number>-<kebab-title>`, GitHub's convention), preview
  path, and blockers (no clone path / no token) so the dialog can disable
  itself.
- `create({ owner, name, number, branch, base })` mutation → linked branch on
  GitHub, then local add; returns the worktree `{ branch, path }`.

**Renderer — creation dialog**
- `worktree-create-dialog.tsx`: branch name input (pre-derived, editable), base
  branch select (default preselected), live path preview (re-derive on branch
  edit). Hover-revealed "Create worktree…" button on issue rows without a
  worktree (extends Task 1's glyph component). On success: invalidate the
  `forRepo` query so the glyph appears.

## Validation

1. Settings shows the root with the default; change it and it sticks.
2. On an issue without a branch: create with the suggested name → GitHub issue
   Development panel shows the branch; folder exists at the previewed path with
   the branch checked out; glyph appears on the row.
3. Edit the branch name in the dialog → preview updates; created accordingly.
4. Issue whose repo has no local path: dialog blocks with a message (rough is
   fine for now).
