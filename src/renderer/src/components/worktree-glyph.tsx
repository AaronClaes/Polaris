import {
  IconCode,
  IconFolder,
  IconFolderCode,
  IconFolderPlus,
  IconTerminal2,
  IconTrash
} from '@tabler/icons-react'
import { memo, type ReactElement, useState } from 'react'
import { AppIconImg } from '@/components/action-icon'
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
import { WorktreeCreateDialog } from '@/components/worktree-create-dialog'
import { FINDER_APP_KEY } from '@/lib/app-icons'
import { trpc } from '@/lib/trpc'

/** Hover-revealed "Create worktree…" affordance (rows without a worktree stay
 *  calm). Relies on the row carrying the `group/row` class (see DataTable). */
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
  '-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent'

/**
 * The launchers for one worktree: open in the default IDE / terminal (the
 * global default apps — worktrees deliberately don't use per-project actions)
 * or reveal in Finder, each with cwd = the worktree. Launch errors surface
 * inline; the popover stays open so they're visible.
 */
function WorktreeLaunchers({ path }: { path: string }): ReactElement {
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
        onClick={() => open.mutate({ path, target: 'ide' })}
      >
        <AppIconImg appKey={apps?.ide} className={iconClass} Fallback={IconCode} />
        <span className="truncate">Open in {ideName}</span>
      </button>
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => open.mutate({ path, target: 'terminal' })}
      >
        <AppIconImg appKey={apps?.terminal} className={iconClass} Fallback={IconTerminal2} />
        <span className="truncate">Open in {terminalName}</span>
      </button>
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => open.mutate({ path, target: 'finder' })}
      >
        <AppIconImg appKey={FINDER_APP_KEY} className={iconClass} Fallback={IconFolder} />
        <span className="truncate">Reveal in Finder</span>
      </button>
      {open.error && <p className="text-destructive-foreground text-xs">{open.error.message}</p>}
    </div>
  )
}

/**
 * The remove confirmation. Rendered as a *sibling* of the popover (which closes
 * when remove is chosen) — nested inside it, the popover's light dismiss would
 * unmount the dialog mid-interaction. Stays open on failure so the service's
 * refusal (uncommitted / unpushed work) is readable; the branch — local and on
 * GitHub — is never touched either way.
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
      // Drop it from the query cache immediately (the glyph flips without
      // waiting on a git round-trip), then reconcile in the background.
      utils.worktrees.forRepo.setData({ owner: repo.owner, name: repo.name }, (old) =>
        old ? { worktrees: old.worktrees.filter((entry) => entry.path !== worktree.path) } : old
      )
      utils.worktrees.forRepo.invalidate({ owner: repo.owner, name: repo.name })
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
              remove.mutate({ owner: repo.owner, name: repo.name, path: worktree.path })
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
              <IconFolderCode className="size-4" />
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
                <WorktreeLaunchers path={worktree.path} />
                <Separator className="-mx-2" />
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
    </>
  )
})
