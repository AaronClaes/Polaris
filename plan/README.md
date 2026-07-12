# Background jobs — implementation plan

Long-running worktree operations (create — especially with a setup recipe that
runs an install — and remove, which deletes `node_modules`-sized trees) move
out of blocking dialogs into a main-side **job registry** with a top-bar jobs
UI. Submit → dialog closes immediately → the job runs in the background → the
worktree glyph appears/disappears when it's done.

Design settled in the 2026-07-12 conversation. The decisions that shape
everything:

- **In-memory, session-scoped — no DB table.** If the app quits mid-job the
  child process dies with it, so a persisted "running" row would be a lie on
  restart; and worktree state is derived from git, so the glyphs always show
  truth regardless. A jobs table is an easy later add if week-old logs ever
  matter.
- **The registry absorbs the creation-log machinery.** `creationLogs` /
  `appendCreationLog` / `readCreationLog` and the `creationLog` query (plus the
  renderer-generated `runId` plumbing) fold into jobs — each job carries its
  own bounded log. One system, not two.
- **Polling, not subscriptions.** The renderer polls `jobs.list` (~1s) only
  while something is running, matching how the rest of the codebase works. A
  `useJobs` hook watches running → finished transitions and invalidates the
  derived queries (`worktrees.forRepo`, github) — that's how glyphs update
  without any dialog involved.
- **Preflight stays synchronous.** Cheap checks (usable clone, token, occupied
  path / branch collision) still throw straight into the dialog before a job
  is created. Only the slow work (GitHub branch, `worktree add`, setup recipe,
  Claude launch, remove) runs inside the job.
- **Remove is fully backgrounded** — including its safety checks. A refusal
  (dirty / unpushed / never pushed) surfaces as a failed job in the popover,
  not in the confirm dialog.
- **Archive until cleared.** Finished jobs stay listed — running → finished,
  never running → gone — so there's no "wait, did I run it?", and logs stay
  readable after the fact. Explicit per-row dismiss + "Clear finished";
  bounded (oldest finished evicted past a cap).
- **Badge, not spinner-icon.** The top-bar jobs button is always visible (empty
  state: "No jobs yet"). A small badge carries state: count of running +
  unseen-finished jobs, destructive color when an unseen job failed. Opening
  the popover marks jobs seen and clears the badge; the jobs themselves stay.
- **Job detail dialog.** Clicking a job row opens a status dialog — status,
  title/repo, timing, the error prominently when failed, live log underneath
  (250ms poll while running). This replaces the create dialog's inline log
  panel; it's rendered as a popover *sibling* (same pattern as
  StartClaudeDialog / RemoveWorktreeDialog).
- **Toasts on completion** — success ("Worktree 123-fix-login ready") and
  failure — using the vendored `ui/toast.tsx` (first use). Failures also
  persist in the popover; a toast alone is too easy to miss.
- **Duplicate guard.** Starting a create while a job for the same repo+branch
  is running throws (the dialog no longer blocks you, so the registry must);
  same for a remove of the same path.
- **A failed step after the worktree exists still fails the job** (setup
  recipe, Claude launch) — two statuses only, but the error text says the
  worktree was created and is usable. The Task 6 half-failure copy (branch on
  GitHub, local checkout failed → retry from the row) moves into job errors
  verbatim.
- **Deferred (post-v1):** persisting jobs to the DB, adopting jobs for the 3D
  tool's optimize/export, remove-speed optimization (explicitly left out),
  cancel/kill a running job.

## Tracer-bullet tasks

Each task cuts main → tRPC → renderer and ends with something you can validate
in the running dev app before the next slice starts.

| # | Task | Validates |
|---|------|-----------|
| 1 | [Jobs core + backgrounded create](tasks/01-jobs-core-create.md) | Registry → router → top-bar list; create returns instantly, glyph appears on its own |
| 2 | [Backgrounded remove + guards](tasks/02-remove-and-guards.md) | Remove via job (refusals as failed jobs), duplicate guard, removing-state glyph |
| 3 | [Jobs UX polish](tasks/03-jobs-ux.md) | Detail dialog with live log, badge seen-semantics, toasts, dismiss/clear |

## Working agreement

- After each task: `typecheck` + Biome + `electron-vite build` green, then Aaron
  validates in the dev app (Electron GUI is not verifiable from Claude's env).
- Commit only via `/commit`, one commit per validated task.
- Biome style throughout: single quotes, no semicolons, line width 100.
