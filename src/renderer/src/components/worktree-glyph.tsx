import { IconFolderCode, IconFolderPlus } from '@tabler/icons-react'
import { memo, type ReactElement, useState } from 'react'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { WorktreeCreateDialog } from '@/components/worktree-create-dialog'
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

/**
 * The worktree slot for an issue/PR row. When one of the row's candidate
 * branches has a local worktree: a persistent glyph opening a popover with each
 * worktree's branch and path. When none does (and the row can create one): the
 * hover-revealed create button. Worktree state is fully derived — this queries
 * `git worktree list` (per repo, shared via the query cache across rows) and
 * intersects it with the row's branches, so worktrees created outside Polaris
 * show up exactly the same as ones it created.
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

  const names = new Set(branches.map((branch) => branch.name))
  const matches = data?.worktrees.filter((worktree) => names.has(worktree.branch)) ?? []
  if (matches.length === 0) {
    if (!issue) return null
    // A row that already has a linked branch creates from it (local-only mode)
    // instead of minting a second branch on GitHub.
    return <CreateWorktreeButton repo={repo} issue={issue} existingBranch={branches[0]?.name} />
  }

  return (
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
        <div className="grid gap-3">
          {matches.map((worktree) => (
            <div key={worktree.path} className="grid gap-0.5 text-sm">
              <span className="truncate font-medium" title={worktree.branch}>
                {worktree.branch}
              </span>
              <span className="truncate text-muted-foreground text-xs" title={worktree.path}>
                {worktree.path}
              </span>
            </div>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  )
})
