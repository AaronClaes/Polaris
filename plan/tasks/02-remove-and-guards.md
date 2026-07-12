# Task 2 — Backgrounded remove + guards

**Tracer goal:** confirm a remove → the dialog closes instantly → the glyph
shows a removing state → the popover shows the outcome, including the safety
refusals (dirty / unpushed) as failed jobs.

## Scope

In: `remove` as a job (checks included), duplicate-job guards on create and
remove, removing-state on the glyph. Out: detail dialog, badge semantics,
toasts (task 3).

## Implementation

**`src/main/trpc/routers/worktrees.ts`**

- `remove`: preflight stays sync (usable clone); the whole `removeWorktree`
  call — status check, unpushed check, `git worktree remove` — moves into a
  job (`kind: 'worktree-remove'`, title `Remove worktree <branch>`, meta
  carries `path` + owner/name). Returns `{ jobId }`. The refusal messages
  ("uncommitted changes…", "unpushed commits…") become the job's `error`
  unchanged.
- Thread the job's `log` into `removeWorktree` (add `onLog` pass-through to its
  three `runGit` calls) so the detail dialog in task 3 has something to show.

**`src/main/services/jobs.ts`**

- `findActiveJob(predicate)` (or similar) over running jobs.
- Guards, thrown from the mutations' sync part (they land in the dialog):
  - create/createFromBranch: a running create for the same owner/name/branch →
    "That worktree is already being created — check the jobs list."
  - remove: a running remove for the same path → equivalent message.
  - create: also refuse while a remove for the same derived path runs.

**Renderer**

- `worktree-glyph.tsx`: the popover's remove flow already closes the popover;
  `RemoveWorktreeDialog` now closes on mutate success (jobId back) instead of
  waiting — its cache-eviction `onSuccess` logic moves to the `useJobs`
  transition handler (a finished remove job invalidates `worktrees.forRepo`;
  no optimistic eviction needed since the row shows a removing state instead).
- Removing state: the glyph reads the shared `jobs.list` cache (same query the
  top bar polls — no extra polling); a running `worktree-remove` job whose
  `meta.path` matches one of the row's worktrees renders the glyph as a
  spinner (popover still openable; its remove row disabled). Same idea for a
  running create matching the row's repo+branch: the hover create button shows
  a spinner and is disabled.

## Validation

1. Remove a clean worktree with a big `node_modules`: dialog closes instantly,
   glyph spins for the ~20s the deletion actually takes, then disappears.
2. Dirty worktree: job fails with the uncommitted-changes refusal in the
   popover; worktree untouched, glyph back to normal.
3. Unpushed commits: same, with the unpushed copy.
4. While a create job runs, reopen the create dialog for the same issue and
   submit: inline error says it's already being created.
5. Double-click remove race: second confirm errors in the dialog, no
   double-job.
