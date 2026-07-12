import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react'
import { ClaudeLaunchFields, claudePromptSeed } from '@/components/claude-launch-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { trpc } from '@/lib/trpc'

/** Select value for "run no setup recipe" — a sentinel because base-ui select
 *  values are strings and recipe labels are user-defined. */
const NO_RECIPE = '__none__'

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
 * Both show a live preview of where the worktree will land, and can hand off
 * post-create: the "Start Claude" checkbox opens the default terminal in the
 * new worktree with an interactive `claude` session running.
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

  // The setup-recipe choice follows the same draft pattern, except an explicit
  // "None" is a real choice — so undefined means "follow the data" and null
  // means None. Defaults to the repo's last-used recipe when it still exists.
  const [recipeDraft, setRecipeDraft] = useState<string | null | undefined>(undefined)
  const recipes = info.data?.setupCommands ?? []
  const lastUsed = info.data?.lastSetupCommand ?? null
  const defaultRecipe = recipes.some((entry) => entry.label === lastUsed) ? lastUsed : null
  const recipe = recipeDraft === undefined ? defaultRecipe : recipeDraft

  // The "Start Claude" handoff: checking the box reveals an editable kickoff
  // prompt plus model / permission-mode selects (drafts over the remembered
  // last-used flags from creationInfo). The launch fires after the worktree is
  // created — never on a setup failure, where the banner takes precedence.
  const [launchClaude, setLaunchClaude] = useState(false)
  const [promptDraft, setPromptDraft] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [modeDraft, setModeDraft] = useState<string | null>(null)
  const claudeInfo = info.data?.claude
  const claudePrompt = promptDraft ?? claudePromptSeed(repo, issue)
  const claudeModel = modelDraft ?? claudeInfo?.model ?? ''
  const claudeMode = modeDraft ?? claudeInfo?.permissionMode ?? ''

  // A launch failure after a successful creation — same shape as setupError:
  // the worktree is live, so it's a warning banner, not a failed submit.
  const [launchError, setLaunchError] = useState<string | null>(null)

  // A recipe failure after a successful creation — shown as a banner while the
  // dialog sticks around (the worktree itself is live).
  const [setupError, setSetupError] = useState<string | null>(null)

  // Identifies this submission's output in the main-side creation log, so the
  // dialog can show the git/setup output live instead of just a spinner.
  const [runId, setRunId] = useState<string | null>(null)

  // Reset the drafts each time the dialog opens for a fresh derivation.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setBranchDraft(null)
      setBaseDraft(null)
      setRecipeDraft(undefined)
      setSetupError(null)
      setLaunchClaude(false)
      setPromptDraft(null)
      setModelDraft(null)
      setModeDraft(null)
      setLaunchError(null)
      setRunId(null)
    }
    wasOpen.current = open
  }, [open])

  const startClaude = trpc.worktrees.startClaude.useMutation()

  // Write the new worktree straight into the query cache so the row's glyph
  // flips instantly, then invalidate to reconcile with `git worktree list` in
  // the background (the refetch pays a login-shell spawn — too slow to gate the
  // UI on). A setup failure doesn't change any of that — the worktree exists —
  // but it keeps the dialog open to show the banner instead of closing (and
  // skips the Claude handoff: fix the setup first, launch from the popover).
  const onCreated = (created: { branch: string; path: string; setupError?: string }): void => {
    utils.worktrees.forRepo.setData({ owner: repo.owner, name: repo.name }, (old) => ({
      worktrees: [
        ...(old?.worktrees ?? []).filter((worktree) => worktree.path !== created.path),
        { path: created.path, branch: created.branch }
      ]
    }))
    utils.worktrees.forRepo.invalidate({ owner: repo.owner, name: repo.name })
    if (created.setupError) setSetupError(created.setupError)
    else if (launchClaude) {
      // Sending model/mode explicitly also makes them the remembered defaults.
      startClaude.mutate(
        {
          path: created.path,
          prompt: claudePrompt,
          model: claudeModel,
          permissionMode: claudeMode
        },
        {
          onSuccess: () => onOpenChange(false),
          onError: (mutationError) => setLaunchError(mutationError.message)
        }
      )
    } else onOpenChange(false)
  }
  // The final invalidate fetches the log's tail once more after the mutation
  // settles — the interval polling below stops the moment pending flips false.
  const onSettled = (): void => {
    utils.worktrees.creationLog.invalidate()
  }
  const create = trpc.worktrees.create.useMutation({ onSuccess: onCreated, onSettled })
  const createFromBranch = trpc.worktrees.createFromBranch.useMutation({
    onSuccess: onCreated,
    onSettled
  })
  const pending = create.isPending || createFromBranch.isPending || startClaude.isPending
  const error = create.error ?? createFromBranch.error

  // Live output of the in-flight creation (git fetch/worktree add + the setup
  // command), polled from the main-side buffer while the mutation runs.
  const creationLog = trpc.worktrees.creationLog.useQuery(
    { runId: runId ?? '' },
    { enabled: runId !== null, refetchInterval: pending ? 250 : false }
  )
  const logText = runId ? (creationLog.data?.log ?? '') : ''

  // Trickle new output into the pane instead of jumping a whole poll batch at
  // once: reveal the backlog a few lines per tick, taking a bigger bite the
  // further behind it is so a chatty burst catches up instead of lagging.
  const [displayedLog, setDisplayedLog] = useState('')
  useEffect(() => {
    if (logText === displayedLog) return
    // The buffer is trimmed from the front (and reset per run) — when the
    // displayed text is no longer a prefix of the target, snap instead.
    if (!logText.startsWith(displayedLog)) {
      setDisplayedLog(logText)
      return
    }
    const timer = setTimeout(() => {
      setDisplayedLog((current) => {
        if (!logText.startsWith(current)) return logText
        const pending = logText.slice(current.length)
        const lines = pending.split('\n')
        const take = Math.max(1, Math.ceil(lines.length / 10))
        const cut = lines.slice(0, take).join('\n').length + 1
        return current + pending.slice(0, Math.min(cut, pending.length))
      })
    }, 50)
    return () => clearTimeout(timer)
  }, [logText, displayedLog])

  // Keep the log pane pinned to the bottom as output streams in.
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!displayedLog) return
    const pane = logRef.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [displayedLog])

  const blockers = info.data?.blockers ?? []
  // Same fallback as main-side deriveWorktreePath: a name that sanitizes to
  // nothing takes `issue-<number>` instead of collapsing into the repo dir.
  const segment = sanitizeBranchForPath(branch) || `issue-${issue.number}`
  const preview = info.data ? `${info.data.repoDir}/${segment}` : null

  // Preflight validation, so a doomed submit is blocked before anything is
  // written on GitHub: the name against the refs list already fetched for the
  // base-branch select (mint mode only — an existing branch is allowed to
  // exist), and the derived path against what's already on disk.
  const branchTaken = !existingBranch && (info.data?.branches.includes(branch.trim()) ?? false)
  const pathTaken = info.data?.occupiedDirs.includes(segment) ?? false
  const canSubmit =
    !info.isLoading &&
    blockers.length === 0 &&
    branch.trim().length > 0 &&
    !branchTaken &&
    !pathTaken &&
    (existingBranch !== undefined || base.length > 0)

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    const setupCommand = recipe ?? undefined
    // Fresh id per attempt so a retry's log doesn't append to the failed one's.
    const nextRunId = crypto.randomUUID()
    setRunId(nextRunId)
    if (existingBranch) {
      createFromBranch.mutate({
        owner: repo.owner,
        name: repo.name,
        branch: existingBranch,
        number: issue.number,
        setupCommand,
        runId: nextRunId
      })
    } else {
      create.mutate({
        owner: repo.owner,
        name: repo.name,
        number: issue.number,
        branch: branch.trim(),
        base,
        setupCommand,
        runId: nextRunId
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
            {setupError && (
              <div className="grid gap-1.5 rounded-md bg-destructive/8 px-3 py-2.5">
                <p className="text-destructive-foreground text-sm">
                  The worktree was created, but its setup command failed. Finish the setup in your
                  terminal.
                </p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-destructive-foreground/80 text-xs">
                  {setupError}
                </pre>
              </div>
            )}
            {launchError && (
              <div className="grid gap-1.5 rounded-md bg-destructive/8 px-3 py-2.5">
                <p className="text-destructive-foreground text-sm">
                  The worktree was created, but Claude couldn't start. Open the worktree and run it
                  yourself.
                </p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-destructive-foreground/80 text-xs">
                  {launchError}
                </pre>
              </div>
            )}
            {!setupError && !launchError && info.isLoading && (
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
            {!setupError && !launchError && info.data && blockers.length === 0 && (
              <>
                {!existingBranch && (
                  <section className="grid gap-3">
                    <h3 className="font-medium text-sm">Branch</h3>
                    <div className="grid gap-1.5">
                      <Label htmlFor={branchId}>Branch name</Label>
                      <Input
                        id={branchId}
                        value={branch}
                        onChange={(event) => setBranchDraft(event.currentTarget.value)}
                        spellCheck={false}
                        autoComplete="off"
                      />
                      {branchTaken && (
                        <p className="text-destructive-foreground text-xs">
                          A branch named “{branch.trim()}” already exists on {repo.owner}/
                          {repo.name} — pick another name.
                        </p>
                      )}
                      {!branchTaken && pathTaken && (
                        <p className="break-all text-destructive-foreground text-xs">
                          Something already exists at {preview} — pick another name.
                        </p>
                      )}
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
                    {preview && (
                      <p className="break-all text-muted-foreground text-xs">
                        Worktree at <span className="font-medium">{preview}</span>
                      </p>
                    )}
                  </section>
                )}
                {existingBranch && pathTaken && (
                  // The branch is fixed in this mode, so an occupied path can't
                  // be typed away — it reads as a blocker instead.
                  <p className="break-all text-destructive-foreground text-sm">
                    Something already exists at <span className="font-medium">{preview}</span> —
                    remove that folder first, then try again.
                  </p>
                )}
                {existingBranch && preview && (
                  <p className="break-all text-muted-foreground text-xs">
                    Worktree at <span className="font-medium">{preview}</span>
                  </p>
                )}
                <Separator />
                <section className="grid gap-3">
                  {recipes.length > 0 && (
                    <div className="grid gap-1.5">
                      <Label>Setup command</Label>
                      <Select
                        value={recipe ?? NO_RECIPE}
                        onValueChange={(next) =>
                          next && setRecipeDraft(next === NO_RECIPE ? null : next)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <span className="truncate">{recipe ?? 'None'}</span>
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value={NO_RECIPE}>None</SelectItem>
                          {recipes.map((entry) => (
                            <SelectItem key={entry.label} value={entry.label}>
                              {entry.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                  )}
                  <div className="grid gap-3">
                    <Label className="flex w-fit items-center gap-2 font-normal">
                      <Checkbox
                        checked={launchClaude}
                        onCheckedChange={(checked) => setLaunchClaude(checked === true)}
                      />
                      Start Claude in {claudeInfo?.terminal ?? 'your terminal'}
                    </Label>
                    {launchClaude && claudeInfo && (
                      // Indented behind the checkbox so the revealed fields read
                      // as its children, not more top-level form.
                      <div className="ml-2 grid gap-3 border-border border-l-2 pl-4">
                        <ClaudeLaunchFields
                          models={claudeInfo.models}
                          permissionModes={claudeInfo.permissionModes}
                          prompt={claudePrompt}
                          onPromptChange={setPromptDraft}
                          model={claudeModel}
                          onModelChange={setModelDraft}
                          permissionMode={claudeMode}
                          onPermissionModeChange={setModeDraft}
                        />
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}
            {error && <p className="text-destructive-foreground text-sm">{error.message}</p>}
            {(pending || error) && !setupError && !launchError && displayedLog && (
              <pre
                ref={logRef}
                className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 px-3 py-2 font-mono text-muted-foreground text-xs"
              >
                {displayedLog}
              </pre>
            )}
          </DialogPanel>
          <DialogFooter>
            {setupError || launchError ? (
              // The creation itself succeeded — nothing left to submit or cancel.
              <DialogClose render={<Button type="button" />}>Close</DialogClose>
            ) : (
              <>
                <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
                <Button type="submit" disabled={!canSubmit} loading={pending}>
                  Create worktree
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
