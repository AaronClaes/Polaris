import {
  IconCode,
  IconFolder,
  IconFolderCode,
  IconFolderPlus,
  IconSparkles,
  IconTerminal2,
  IconTrash
} from '@tabler/icons-react'
import { memo, type ReactElement, useState } from 'react'
import { AppIconImg } from '@/components/action-icon'
import { claudePromptSeed, StartClaudeDialog } from '@/components/claude-launch-dialog'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { WorktreeCreateDialog } from '@/components/worktree-create-dialog'
import { FINDER_APP_KEY } from '@/lib/app-icons'
import { trpc } from '@/lib/trpc'

/**
 * The one rule for which branches a row's worktree could live on — shared by
 * the issues table and the work-item feed so an issue and its fused PR row
 * resolve to the *same* worktree:
 *
 * - an issue row → its linked branches;
 * - a PR row (incl. fused with its issue) → the head branch first, then the
 *   issue's linked branches (GitHub consumes the branch link when a PR opens,
 *   so the head usually only survives on the PR side);
 * - a fork PR → null: its head branch lives in the fork, not in the clone's
 *   origin, so the row gets no worktree affordance at all. (Store snapshots
 *   persisted before `isCrossRepository` existed lack the field and read as
 *   same-repo until the next reconcile refreshes them.)
 */
export function worktreeCandidates({
  pr,
  issue
}: {
  pr?: { headBranch: { name: string } | null; isCrossRepository: boolean } | null
  issue?: { linkedBranches: { name: string }[] } | null
}): { name: string }[] | null {
  if (pr?.isCrossRepository) return null
  const names = new Set<string>()
  if (pr?.headBranch) names.add(pr.headBranch.name)
  for (const branch of issue?.linkedBranches ?? []) names.add(branch.name)
  return [...names].map((name) => ({ name }))
}

/** Hover-revealed "Create worktree…" affordance (rows without a worktree stay
 *  calm). While a create job for this issue runs it flips to a persistent
 *  spinner instead — visible without hover, and not clickable. Relies on the
 *  row carrying the `group/row` class (see DataTable). */
function CreateWorktreeButton({
  repo,
  issue,
  existingBranch
}: {
  repo: { owner: string; name: string }
  issue: { number: number; title: string }
  existingBranch?: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  // Reads the same jobs.list cache the top-bar button polls — no extra timer.
  const { data: jobsData } = trpc.jobs.list.useQuery()
  const creating =
    jobsData?.jobs.some(
      (job) =>
        job.status === 'running' &&
        job.kind === 'worktree-create' &&
        job.meta.owner === repo.owner &&
        job.meta.name === repo.name &&
        job.meta.issueNumber === issue.number
    ) ?? false

  if (creating) {
    return (
      <span
        title="Creating worktree…"
        role="status"
        aria-label="Creating worktree"
        className="inline-flex text-muted-foreground opacity-70"
      >
        <Spinner className="size-4" />
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        aria-label="Create worktree"
        title="Create worktree…"
        onClick={() => setOpen(true)}
        className="inline-flex text-muted-foreground opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-70"
      >
        <IconFolderPlus className="size-4" />
      </button>
      {open && (
        <WorktreeCreateDialog
          repo={repo}
          issue={issue}
          existingBranch={existingBranch}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}

/** One menu-like row in the worktree popover. Negative margin lets the hover
 *  background bleed past the popover viewport's built-in inline padding. */
const ROW_CLASS =
  '-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent'

/**
 * The launchers for one worktree: open in the default IDE / terminal (the
 * global default apps — worktrees deliberately don't use per-project actions)
 * or reveal in Finder, each with cwd = the worktree — plus "Start Claude",
 * which closes the popover and opens the StartClaudeDialog (a popover sibling,
 * see the glyph). Launch errors surface inline; the popover stays open so
 * they're visible.
 */
function WorktreeLaunchers({
  path,
  onStartClaude
}: {
  path: string
  onStartClaude: () => void
}): ReactElement {
  const { data: apps } = trpc.settings.defaultApps.useQuery()
  const open = trpc.worktrees.open.useMutation()

  const ideName = apps?.ides.find((ide) => ide.key === apps.ide)?.name ?? 'IDE'
  const terminalName =
    apps?.terminals.find((terminal) => terminal.key === apps.terminal)?.name ?? 'Terminal'
  const iconClass = 'size-4 shrink-0'

  return (
    <div className="grid gap-0.5">
      <button
        type="button"
        className={ROW_CLASS}
        disabled={open.isPending}
        onClick={() => open.mutate({ path, target: 'ide' })}
      >
        <AppIconImg appKey={apps?.ide} className={iconClass} Fallback={IconCode} />
        <span className="truncate">Open in {ideName}</span>
      </button>
      <button
        type="button"
        className={ROW_CLASS}
        disabled={open.isPending}
        onClick={() => open.mutate({ path, target: 'terminal' })}
      >
        <AppIconImg appKey={apps?.terminal} className={iconClass} Fallback={IconTerminal2} />
        <span className="truncate">Open in {terminalName}</span>
      </button>
      <button
        type="button"
        className={ROW_CLASS}
        disabled={open.isPending}
        onClick={() => open.mutate({ path, target: 'finder' })}
      >
        <AppIconImg appKey={FINDER_APP_KEY} className={iconClass} Fallback={IconFolder} />
        <span className="truncate">Reveal in Finder</span>
      </button>
      <PopoverClose
        render={
          <button type="button" className={ROW_CLASS} onClick={onStartClaude}>
            <IconSparkles className={iconClass} />
            <span className="truncate">Start Claude</span>
          </button>
        }
      />
      {open.error && <p className="text-destructive-foreground text-xs">{open.error.message}</p>}
    </div>
  )
}

/**
 * The remove confirmation. Rendered as a *sibling* of the popover (which closes
 * when remove is chosen) — nested inside it, the popover's light dismiss would
 * unmount the dialog mid-interaction. Confirming starts a background job and
 * closes immediately — the glyph shows a removing state while it runs, and a
 * refusal (uncommitted / unpushed work) surfaces as a failed job in the jobs
 * popover. Only a rejected submit (e.g. already being removed) shows here. The
 * branch — local and on GitHub — is never touched either way.
 */
function RemoveWorktreeDialog({
  repo,
  worktree,
  onOpenChange
}: {
  repo: { owner: string; name: string }
  worktree: { path: string; branch: string }
  onOpenChange: (open: boolean) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const remove = trpc.worktrees.remove.useMutation({
    onSuccess: () => {
      // Kicks the top-bar polling off; the glyph disappears when useJobs sees
      // the job finish and invalidates worktrees.forRepo.
      utils.jobs.list.invalidate()
      onOpenChange(false)
    }
  })

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove worktree?</AlertDialogTitle>
          <AlertDialogDescription>
            Deletes the checkout at{' '}
            <span className="break-all font-medium text-foreground">{worktree.path}</span>. The
            branch <span className="font-medium text-foreground">{worktree.branch}</span> stays —
            locally and on GitHub.
          </AlertDialogDescription>
          {remove.error && (
            <p className="text-destructive-foreground text-sm">{remove.error.message}</p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate({
                owner: repo.owner,
                name: repo.name,
                path: worktree.path,
                branch: worktree.branch
              })
            }
          >
            Remove worktree
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}

/**
 * The worktree slot for an issue/PR row. When one of the row's candidate
 * branches has a local worktree: a persistent glyph opening a popover with each
 * worktree's branch, path, launchers, and remove. When none does (and the row
 * can create one): the hover-revealed create button. Worktree state is fully
 * derived — this queries `git worktree list` (per repo, shared via the query
 * cache across rows) and intersects it with the row's branches, so worktrees
 * created outside Polaris show up exactly the same as ones it created.
 */
export const WorktreeGlyph = memo(function WorktreeGlyph({
  repo,
  branches,
  issue
}: {
  repo: { owner: string; name: string }
  branches: { name: string }[]
  /** When set, rows without a worktree offer "Create worktree…" for this issue. */
  issue?: { number: number; title: string }
}): ReactElement | null {
  const { data } = trpc.worktrees.forRepo.useQuery(
    { owner: repo.owner, name: repo.name },
    // Rows without candidate branches can't match a worktree — skip the git
    // call entirely. 30s staleness: git is cheap but not free per keystroke.
    { enabled: branches.length > 0, staleTime: 30_000 }
  )
  const [removeTarget, setRemoveTarget] = useState<{ path: string; branch: string } | null>(null)
  // The worktree path a StartClaudeDialog is open for — a popover sibling,
  // like the remove dialog, so the popover's light dismiss can't unmount it.
  const [claudeTarget, setClaudeTarget] = useState<string | null>(null)

  // Worktrees mid-removal (running jobs, same cache the top bar polls): the
  // glyph spins and the row's remove action is disabled until the job settles.
  const { data: jobsData } = trpc.jobs.list.useQuery()
  const removingPaths = new Set(
    (jobsData?.jobs ?? [])
      .filter((job) => job.status === 'running' && job.kind === 'worktree-remove')
      .map((job) => job.meta.path)
  )

  const names = new Set(branches.map((branch) => branch.name))
  const matches = data?.worktrees.filter((worktree) => names.has(worktree.branch)) ?? []
  if (matches.length === 0) {
    if (!issue) return null
    // A row that already has a linked branch creates from it (local-only mode)
    // instead of minting a second branch on GitHub.
    return <CreateWorktreeButton repo={repo} issue={issue} existingBranch={branches[0]?.name} />
  }

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Worktree details"
              className="inline-flex text-muted-foreground transition-opacity hover:opacity-70"
            >
              {matches.some((worktree) => removingPaths.has(worktree.path)) ? (
                <Spinner className="size-4" />
              ) : (
                <IconFolderCode className="size-4" />
              )}
            </button>
          }
        />
        <PopoverPopup align="end" className="w-80">
          <div className="grid gap-2">
            {matches.map((worktree, index) => (
              <div key={worktree.path} className="grid gap-2">
                {index > 0 && <Separator className="-mx-2 my-1" />}
                <div className="grid gap-0.5 text-sm">
                  <span className="truncate font-medium" title={worktree.branch}>
                    {worktree.branch}
                  </span>
                  <span className="truncate text-muted-foreground text-xs" title={worktree.path}>
                    {worktree.path}
                  </span>
                </div>
                <WorktreeLaunchers
                  path={worktree.path}
                  onStartClaude={() => setClaudeTarget(worktree.path)}
                />
                <Separator className="-mx-2" />
                {removingPaths.has(worktree.path) ? (
                  <button type="button" className={ROW_CLASS} disabled>
                    <Spinner className="size-4 shrink-0" />
                    Removing worktree…
                  </button>
                ) : (
                  <PopoverClose
                    render={
                      <button
                        type="button"
                        className={`${ROW_CLASS} text-destructive-foreground`}
                        onClick={() => setRemoveTarget(worktree)}
                      >
                        <IconTrash className="size-4 shrink-0" />
                        Remove worktree
                      </button>
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
      {removeTarget && (
        <RemoveWorktreeDialog
          repo={repo}
          worktree={removeTarget}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null)
          }}
        />
      )}
      {claudeTarget && (
        <StartClaudeDialog
          path={claudeTarget}
          // Rows without item context (issue prop unset) start unseeded — the
          // prompt field is just empty.
          seed={issue ? claudePromptSeed(repo, issue) : undefined}
          onOpenChange={(open) => {
            if (!open) setClaudeTarget(null)
          }}
        />
      )}
    </>
  )
})
