# Task 3 — Jobs UX polish

**Tracer goal:** the jobs button becomes the finished product: badge that only
nags about things you haven't seen, click-through to a live status dialog with
the log, toasts on completion, and an archive you clear explicitly.

## Scope

In: job detail dialog (live log), badge seen-semantics, completion/failure
toasts, per-row dismiss + "Clear finished". Out: persistence, cancel, optimize
adoption (all deferred).

## Implementation

**Main**

- `markJobsSeen()` in the jobs service (stamps `seenAt` on every finished job)
  + a `jobs.markSeen` mutation. Running jobs are never "seen" — they finish
  after the popover closed, and should count as new again.

**`src/renderer/src/components/jobs-button.tsx`**

- Badge semantics: count = running + finished-with-`seenAt`-unset. Any unseen
  *failed* job → destructive badge variant; otherwise default. No jobs unseen
  and none running → no badge (button stays).
- Popover open → fire `markSeen` (+ invalidate `jobs.list`). Jobs stay listed.
- Rows become buttons: click → close popover, open the detail dialog as a
  popover **sibling** (the StartClaudeDialog / RemoveWorktreeDialog pattern —
  lifted `detailJob` state, `onOpenChange(false)` = unmount).
- Finished rows get an × (dismiss); footer gets "Clear finished" when any
  finished job exists.

**`src/renderer/src/components/job-detail-dialog.tsx` (new)**

- Header: status glyph + title, detail (repo / path), started + duration.
- Failed → the error message prominent (destructive text, full copy — this is
  where the half-failure guidance is read).
- Log: `trpc.jobs.log.useQuery({ id }, { refetchInterval: running ? 250 : false })`
  in the same monospace scroll panel the create dialog used to have
  (auto-scroll to bottom while running). Empty log → "No output."
- The dialog keeps polling `jobs.list` via the shared cache, so a running job
  flips to succeeded/failed live while you watch.

**Toasts**

- First use of the vendored `ui/toast.tsx` — check its API (base-ui manager?)
  and mount whatever provider/viewport it needs at the app shell.
- Fired from the `useJobs` transition handler: success → `"<title> finished"`
  (e.g. "Create worktree 123-fix-login finished"); failure → `"<title> failed
  — open Jobs for details"`. Keep toasts dumb: the popover/detail dialog is
  the durable record.

## Validation

1. Run a create; don't touch anything: toast on finish, badge shows 1; open
   popover → badge clears, job still listed.
2. Fail a job while the popover is closed: destructive badge, failure toast;
   detail dialog shows the full error + log.
3. Open the detail dialog while a recipe is installing: log streams live,
   status flips to succeeded in place.
4. Dismiss a row / Clear finished: archive empties; badge unaffected by
   already-seen jobs.
5. Restart the app: jobs list is empty ("No jobs yet") — expected,
   session-scoped by design.
