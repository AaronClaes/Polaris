# Task 1 — Jobs core + backgrounded create

**Tracer goal:** create a worktree from an issue → the dialog closes the moment
preflight passes → a job shows in a (minimal) top-bar popover → when it
finishes, the row's glyph appears without the dialog ever having waited.

## Scope

In: jobs service, `jobs` tRPC router, backgrounding `create` /
`createFromBranch` (including setup recipe + Claude launch inside the job),
minimal always-visible top-bar button + popover list, `useJobs` invalidation
hook, create dialog closes on submit and loses its inline log panel, the old
creation-log machinery absorbed. Out: remove, duplicate guard, detail dialog,
badge seen-semantics, toasts (tasks 2–3).

## Implementation

**`src/main/services/jobs.ts` (new)**

- Types:
  ```ts
  interface Job {
    id: string                      // crypto.randomUUID()
    kind: 'worktree-create' | 'worktree-remove'
    title: string                   // 'Create worktree 123-fix-login'
    detail: string                  // 'owner/repo' (or the path for removes)
    status: 'running' | 'succeeded' | 'failed'
    error?: string
    startedAt: Date
    finishedAt?: Date
    seenAt?: Date                   // written in task 3; in the shape from day 1
    meta: { owner?: string; name?: string; branch?: string; path?: string }
  }
  ```
- Module-level `Map<string, Job>` + a parallel log map (same bounding as
  today's creation logs: ~20k chars per job). Eviction: past ~50 jobs, drop the
  oldest *finished* job.
- `startJob(descriptor, run: (log: (chunk: string) => void) => Promise<void>): Job`
  — registers as `running`, kicks off the closure (not awaited by the caller),
  flips to `succeeded` / `failed` (+`error`, message extraction like
  `describeGitFailure` callers do) and stamps `finishedAt`.
- `listJobs()` (newest first, **without** logs — they're too heavy per poll),
  `readJobLog(id)`, `dismissJob(id)` (finished only), `clearFinishedJobs()`.
- Delete `creationLogs` / `appendCreationLog` / `readCreationLog` from
  `worktrees.ts` — the job's `log` callback replaces `onLog` wiring (the
  `onLog` params on `addWorktree` / `runSetupCommand` stay as-is).

**`src/main/trpc/routers/jobs.ts` (new, mount in the app router)**

- `list` query → `Job[]` (superjson carries the Dates).
- `log({ id })` query → `{ log: string }` (unknown id = empty, never an error —
  same posture as the old `creationLog`).
- `dismiss({ id })`, `clearFinished` mutations. (Seen-marking lands in task 3.)

**`src/main/trpc/routers/worktrees.ts`**

- `create`: keep the synchronous preflight exactly as-is (usable clone, token).
  Everything from `fetchWorktreeCreationLookup` on — lookup, `createLinkedBranch`
  with its FORBIDDEN mapping, `deriveWorktreePath`, `addWorktree` with its
  half-failure copy, `runSetupRecipe` — moves into the `startJob` closure.
  Mutation returns `{ jobId }` immediately.
- The Claude handoff moves main-side: `create` grows optional
  `claude: { prompt, model, permissionMode }` input; when present the job's
  last step validates the flags / writes the remembered defaults (reuse the
  `startClaude` mutation's body via a shared helper) and launches the terminal.
  The renderer no longer chains `startClaude.mutate` after create.
- A failed recipe / Claude launch fails the job, but the error text must say
  the worktree was created and is usable (today's `setupError` / `launchError`
  banner copy). `setupError` disappears from the return shape.
- `createFromBranch`: same treatment.
- Drop the `runId` inputs and the `creationLog` query.

**Renderer**

- `src/renderer/src/hooks/use-jobs.ts` (new): `trpc.jobs.list.useQuery` with
  `refetchInterval: (query) => anyRunning(query) ? 1000 : false`. Track previous
  statuses in a ref; on running → finished flip for worktree jobs, invalidate
  `utils.worktrees.forRepo` and `utils.github` (linked branch shows up on the
  row). Hook lives once, in the top-bar jobs button. **After a mutation returns
  a jobId, the caller invalidates `jobs.list`** so polling starts.
- `src/renderer/src/components/jobs-button.tsx` (new): always-visible top-bar
  icon button (e.g. `IconStack2` or `IconProgressCheck`), right cluster of
  [top-bar.tsx](../../src/renderer/src/components/top-bar.tsx) left of Refresh.
  v1 badge: plain running-count (vendored `ui/badge.tsx`), no seen logic yet.
  Popover: job rows (status glyph — spinner / check / destructive ×, title,
  detail, relative time), empty state "No jobs yet." Rows are inert this task.
- `worktree-create-dialog.tsx`: on mutate success → `onOpenChange(false)`,
  nothing else. Remove: `runId` state, the log panel + `creationLog` polling,
  the `setupError` / `launchError` banners and their footer/body gating, and
  the post-create `startClaude.mutate` chaining (the checkbox's drafts now ride
  the create input as `claude`). Preflight validation (blockers, occupied path,
  branch collision) stays untouched.

## Validation

1. Create a worktree with a slow setup recipe (`pnpm install`): dialog closes
   instantly, jobs button shows the running job, popover shows it spinning.
2. When it finishes: glyph appears on the row (no dialog involved), job row
   flips to succeeded and stays listed.
3. Create with the Claude checkbox on: Warp tab pops only after the recipe
   finishes.
4. Break the recipe (bogus command): job fails, error says the worktree was
   still created — and the glyph is indeed there.
5. Read-only token (Task 6 scenario): job fails with the FORBIDDEN copy naming
   the owner.
