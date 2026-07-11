import { IconFolderCode } from '@tabler/icons-react'
import { memo, type ReactElement } from 'react'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { trpc } from '@/lib/trpc'

/**
 * The worktree marker for an issue/PR row: shown only when one of the row's
 * candidate branches has a local worktree, opening a popover with each
 * worktree's branch and path. Worktree state is fully derived — this queries
 * `git worktree list` (per repo, shared via the query cache across rows) and
 * intersects it with the row's branches, so worktrees created outside Polaris
 * show up exactly the same as ones it created.
 */
export const WorktreeGlyph = memo(function WorktreeGlyph({
  repo,
  branches
}: {
  repo: { owner: string; name: string }
  branches: { name: string }[]
}): ReactElement | null {
  const { data } = trpc.worktrees.forRepo.useQuery(
    { owner: repo.owner, name: repo.name },
    // Rows without candidate branches can't match a worktree — skip the git
    // call entirely. 30s staleness: git is cheap but not free per keystroke.
    { enabled: branches.length > 0, staleTime: 30_000 }
  )

  const names = new Set(branches.map((branch) => branch.name))
  const matches = data?.worktrees.filter((worktree) => names.has(worktree.branch)) ?? []
  if (matches.length === 0) return null

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
