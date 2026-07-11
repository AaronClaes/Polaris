# Task 4 — Setup recipes

**Tracer goal:** configure a recipe once on the repo ("copy env": `cp
$REPO_PATH/.env .`), create a worktree with it selected, and find the `.env`
sitting in the new worktree.

## Scope

In: schema + migration, repo-settings editor, dialog select (None + recipes,
last-used preselected), post-create execution with env vars, failure banner.
Out: multi-select/composable steps (explicitly rejected — each recipe is a
complete, self-contained script).

## Implementation

**Schema — `project_repos` (drizzle-kit generate for the migration)**
- `setupCommands`: JSON text column, ordered `{ label, command }[]`, default
  `[]`. A JSON column, not a table — mirrors how action configs store JSON, and
  recipes are only ever read as a whole list.
- `lastSetupCommand`: text, nullable — the label of the recipe last used for
  this repo (null = None). Label-keyed is fine; a renamed recipe just falls back
  to None.

**Repo settings UI**
- In the linked-repo row/dialog where `setRepoPath` lives (`project-repos.tsx`):
  a small list editor — add/remove/reorder recipes, each a label + command
  input. Persist via a new `github.setRepoSetupCommands` (or a dedicated
  mutation on the worktrees router — pick whichever reads cleaner next to
  `setRepoPath`).

**Dialog + execution**
- `creationInfo` additionally returns the repo's recipes + last-used label; the
  dialog select lists None + recipes, preselecting last-used.
- `create` takes an optional recipe label. After a successful worktree add, run
  the command via `$SHELL -ilc` with cwd = the worktree and env `REPO_PATH`,
  `WORKTREE_PATH`, `BRANCH`, `ISSUE_NUMBER` layered over `process.env`. Update
  `lastSetupCommand`. Bound it with a sane timeout (e.g. 2 min) so a hung
  recipe can't wedge the mutation.
- Recipe failure (non-zero exit / timeout): the mutation still resolves as
  created, carrying `setupError` (message + captured stderr/stdout tail); the
  dialog shows it in an error banner but the glyph/worktree are live.

## Validation

1. Add two recipes on a repo; reorder; relaunch the app — they persist.
2. Create a worktree with "copy env" selected → `.env` exists in the worktree;
   dialog closes clean.
3. Create another worktree on the same repo → "copy env" is preselected.
4. Recipe with `exit 1` → worktree is created and glyph appears, but the dialog
   shows the failure output.
5. Select None → nothing runs, nothing remembered as last-used… and the next
   dialog preselects None.
