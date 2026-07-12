import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectItem, SelectPopup, SelectTrigger } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { trpc } from '@/lib/trpc'

/** Client-side mirror of the main-side path rule (services/worktrees.ts
 *  sanitizeBranchForPath) so the preview tracks the branch input live without a
 *  round-trip per keystroke. The mutation derives the real path main-side; a
 *  divergence here would only ever be cosmetic. Keep the two in sync. */
function sanitizeBranchForPath(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The "create a worktree from this issue" dialog, in two modes keyed on
 * whether the row already has a branch:
 *
 * - No branch yet: an editable pre-derived branch name + base branch select;
 *   submitting creates the branch on GitHub (linked to the issue's Development
 *   panel) and materializes it as a local worktree.
 * - `existingBranch` set: the branch is fixed and nothing touches GitHub —
 *   submitting just fetches and adds the worktree. This is also the retry path
 *   when a previous create made the branch but the local half failed.
 *
 * Both show a live preview of where the worktree will land. Designed to later
 * grow post-create actions (open IDE, launch Claude) and the setup-recipe
 * select.
 */
export function WorktreeCreateDialog({
  repo,
  issue,
  existingBranch,
  open,
  onOpenChange
}: {
  repo: { owner: string; name: string }
  issue: { number: number; title: string }
  /** A branch that already exists for this row — switches to local-only mode. */
  existingBranch?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const branchId = useId()
  const info = trpc.worktrees.creationInfo.useQuery(
    {
      owner: repo.owner,
      name: repo.name,
      number: issue.number,
      title: issue.title,
      existingBranch
    },
    { enabled: open }
  )

  // Both fields default from the query (suggested name / default branch) but
  // stage user edits locally — null means "not touched, follow the data".
  const [branchDraft, setBranchDraft] = useState<string | null>(null)
  const [baseDraft, setBaseDraft] = useState<string | null>(null)
  const branch = existingBranch ?? branchDraft ?? info.data?.suggestedBranch ?? ''
  const base = baseDraft ?? info.data?.defaultBranch ?? info.data?.branches[0] ?? ''

  // Reset the drafts each time the dialog opens for a fresh derivation.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setBranchDraft(null)
      setBaseDraft(null)
    }
    wasOpen.current = open
  }, [open])

  // Write the new worktree straight into the query cache so the row's glyph
  // flips instantly, then invalidate to reconcile with `git worktree list` in
  // the background (the refetch pays a login-shell spawn — too slow to gate the
  // UI on).
  const onCreated = (created: { branch: string; path: string }): void => {
    utils.worktrees.forRepo.setData({ owner: repo.owner, name: repo.name }, (old) => ({
      worktrees: [
        ...(old?.worktrees ?? []).filter((worktree) => worktree.path !== created.path),
        { path: created.path, branch: created.branch }
      ]
    }))
    utils.worktrees.forRepo.invalidate({ owner: repo.owner, name: repo.name })
    onOpenChange(false)
  }
  const create = trpc.worktrees.create.useMutation({ onSuccess: onCreated })
  const createFromBranch = trpc.worktrees.createFromBranch.useMutation({ onSuccess: onCreated })
  const pending = create.isPending || createFromBranch.isPending
  const error = create.error ?? createFromBranch.error

  const blockers = info.data?.blockers ?? []
  const preview = info.data ? `${info.data.repoDir}/${sanitizeBranchForPath(branch)}` : null
  const canSubmit =
    !info.isLoading &&
    blockers.length === 0 &&
    branch.trim().length > 0 &&
    (existingBranch !== undefined || base.length > 0)

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    if (existingBranch) {
      createFromBranch.mutate({ owner: repo.owner, name: repo.name, branch: existingBranch })
    } else {
      create.mutate({
        owner: repo.owner,
        name: repo.name,
        number: issue.number,
        branch: branch.trim(),
        base
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create worktree</DialogTitle>
          <DialogDescription>
            {existingBranch ? (
              <>
                Checks out the existing branch{' '}
                <span className="font-medium text-foreground">{existingBranch}</span> as a local
                worktree. Nothing changes on GitHub.
              </>
            ) : (
              <>
                Creates a branch on GitHub linked to{' '}
                <span className="font-medium text-foreground">
                  {repo.owner}/{repo.name}#{issue.number}
                </span>{' '}
                and checks it out as a local worktree.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel className="grid gap-4">
            {info.isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner className="size-4" /> Loading branch info…
              </div>
            )}
            {info.error && (
              <p className="text-destructive-foreground text-sm">{info.error.message}</p>
            )}
            {blockers.map((blocker) => (
              <p key={blocker} className="text-destructive-foreground text-sm">
                {blocker}
              </p>
            ))}
            {info.data && blockers.length === 0 && (
              <>
                {!existingBranch && (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor={branchId}>Branch name</Label>
                      <Input
                        id={branchId}
                        value={branch}
                        onChange={(event) => setBranchDraft(event.currentTarget.value)}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Base branch</Label>
                      <Select
                        value={base || null}
                        onValueChange={(next) => next && setBaseDraft(next)}
                      >
                        <SelectTrigger className="w-full">
                          <span className="truncate">{base || 'Select…'}</span>
                        </SelectTrigger>
                        <SelectPopup>
                          {info.data.branches.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                  </>
                )}
                {preview && (
                  <p className="break-all text-muted-foreground text-xs">
                    Worktree at <span className="font-medium">{preview}</span>
                  </p>
                )}
              </>
            )}
            {error && <p className="text-destructive-foreground text-sm">{error.message}</p>}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!canSubmit} loading={pending}>
              Create worktree
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
