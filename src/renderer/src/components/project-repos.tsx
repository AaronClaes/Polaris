import {
  IconBrandGithub,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconLock,
  IconPencil,
  IconPlus,
  IconScript,
  IconTrash
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import { PathInput } from '@/components/path-input'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
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
import { Spinner } from '@/components/ui/spinner'
import type { GithubRepoRow, ProjectRepoRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** One linked repo: identity (opens on GitHub) + its local path + edit/unlink. */
function LinkedRepoRow({
  repo,
  projectPath,
  unlinking,
  onUnlink
}: {
  repo: ProjectRepoRow
  /** The project's default path — shown (with a "(default)" tag) when the repo
   * has no path of its own, and used as the picker/placeholder seed. */
  projectPath: string | null
  unlinking: boolean
  onUnlink: () => void
}): ReactElement {
  const [editOpen, setEditOpen] = useState(false)
  const [recipesOpen, setRecipesOpen] = useState(false)
  const Icon = repo.private ? IconLock : IconBrandGithub
  // The repo's own path wins; otherwise fall back to the project default.
  const displayPath = repo.path ?? projectPath
  return (
    <li className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <a
          href={repo.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 font-medium text-sm hover:underline"
        >
          <span className="truncate">
            <span className="text-muted-foreground">{repo.owner}/</span>
            {repo.name}
          </span>
          <IconExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </a>
        {repo.description && (
          <p className="truncate text-muted-foreground text-xs">{repo.description}</p>
        )}
        {displayPath && (
          <p
            className="mt-0.5 truncate font-mono text-muted-foreground text-xs"
            title={displayPath}
          >
            {displayPath}
            {!repo.path && <span className="opacity-70"> (default)</span>}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Edit setup recipes for ${repo.owner}/${repo.name}`}
        title="Edit worktree setup recipes"
        onClick={() => setRecipesOpen(true)}
      >
        <IconScript />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Edit local directory for ${repo.owner}/${repo.name}`}
        title="Edit local directory"
        onClick={() => setEditOpen(true)}
      >
        <IconPencil />
      </Button>
      <Button
        variant="destructive-outline"
        size="icon-sm"
        aria-label={`Unlink ${repo.owner}/${repo.name}`}
        title="Unlink repository"
        loading={unlinking}
        onClick={onUnlink}
      >
        <IconTrash />
      </Button>
      <RepoPathDialog
        repo={repo}
        projectPath={projectPath}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <RepoSetupCommandsDialog repo={repo} open={recipesOpen} onOpenChange={setRecipesOpen} />
    </li>
  )
}

/** Dialog to set (or clear) a linked repo's local working directory. Blank saves
 * as null, falling back to the project default; the project default seeds the
 * input's placeholder so you can see what "empty" resolves to. */
function RepoPathDialog({
  repo,
  projectPath,
  open,
  onOpenChange
}: {
  repo: ProjectRepoRow
  projectPath: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const pathId = useId()
  const [path, setPath] = useState(repo.path ?? '')

  // Seed the field from the repo each time the dialog opens.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) setPath(repo.path ?? '')
    wasOpen.current = open
  }, [open, repo.path])

  const setRepoPath = trpc.github.setRepoPath.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      onOpenChange(false)
    }
  })

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    setRepoPath.mutate({ id: repo.id, path })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Local directory</DialogTitle>
          <DialogDescription>
            The working directory for{' '}
            <span className="font-medium text-foreground">
              {repo.owner}/{repo.name}
            </span>
            . Leave it empty to use the project's default path.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel className="grid gap-1.5">
            <Label htmlFor={pathId}>Path</Label>
            <PathInput
              id={pathId}
              value={path}
              onChange={setPath}
              placeholder={projectPath ?? '/Users/you/projects/repo'}
            />
            {setRepoPath.error && (
              <p className="text-destructive-foreground text-sm">{setRepoPath.error.message}</p>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" loading={setRepoPath.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}

/** An editable recipe row. `id` is a per-dialog counter so reordering keeps
 * React keys (and thus input focus) stable — labels aren't unique while typing. */
interface RecipeDraft {
  id: number
  label: string
  command: string
}

/**
 * Dialog to edit a linked repo's worktree setup recipes: an ordered list of
 * label + command pairs, saved wholesale. Each recipe is a complete,
 * self-contained script (never composed with others) that the worktree
 * creation dialog offers as a single choice — anything beyond a one-liner
 * belongs in a script inside the repo that the command just calls.
 */
function RepoSetupCommandsDialog({
  repo,
  open,
  onOpenChange
}: {
  repo: ProjectRepoRow
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const nextId = useRef(0)
  const [recipes, setRecipes] = useState<RecipeDraft[]>([])

  // Seed the drafts from the repo each time the dialog opens.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setRecipes(repo.setupCommands.map((recipe) => ({ id: nextId.current++, ...recipe })))
    }
    wasOpen.current = open
  }, [open, repo.setupCommands])

  const save = trpc.github.setRepoSetupCommands.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      onOpenChange(false)
    }
  })

  const update = (id: number, patch: Partial<Omit<RecipeDraft, 'id'>>): void => {
    setRecipes((list) => list.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }
  const move = (index: number, delta: -1 | 1): void => {
    setRecipes((list) => {
      const next = [...list]
      const [row] = next.splice(index, 1)
      next.splice(index + delta, 0, row)
      return next
    })
  }

  // Rows left fully empty are dropped silently; a half-filled row blocks save.
  const cleaned = recipes
    .map((row) => ({ label: row.label.trim(), command: row.command.trim() }))
    .filter((row) => row.label || row.command)
  const incomplete = cleaned.some((row) => !row.label || !row.command)
  const duplicated = new Set(cleaned.map((row) => row.label)).size !== cleaned.length

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (incomplete || duplicated) return
    save.mutate({ id: repo.id, setupCommands: cleaned })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Setup recipes</DialogTitle>
          <DialogDescription>
            Commands offered when creating a worktree of{' '}
            <span className="font-medium text-foreground">
              {repo.owner}/{repo.name}
            </span>
            . The selected one runs in the new worktree through your shell, with{' '}
            <span className="font-mono text-xs">REPO_PATH</span>,{' '}
            <span className="font-mono text-xs">WORKTREE_PATH</span>,{' '}
            <span className="font-mono text-xs">BRANCH</span> and{' '}
            <span className="font-mono text-xs">ISSUE_NUMBER</span> set.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel className="grid gap-3">
            {recipes.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No recipes yet — add one, like copying the main clone’s env file:{' '}
                <span className="font-mono text-xs">cp "$REPO_PATH/.env" .</span>
              </p>
            )}
            {recipes.map((recipe, index) => (
              <div key={recipe.id} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2">
                <Input
                  value={recipe.label}
                  onChange={(event) => update(recipe.id, { label: event.currentTarget.value })}
                  placeholder="Label"
                  aria-label="Recipe label"
                  autoComplete="off"
                />
                <Input
                  value={recipe.command}
                  onChange={(event) => update(recipe.id, { command: event.currentTarget.value })}
                  placeholder="./scripts/setup-worktree.sh"
                  aria-label="Recipe command"
                  className="font-mono"
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move recipe up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <IconChevronUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move recipe down"
                    disabled={index === recipes.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <IconChevronDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive-foreground hover:bg-destructive/8"
                    aria-label="Remove recipe"
                    onClick={() => setRecipes((list) => list.filter((row) => row.id !== recipe.id))}
                  >
                    <IconTrash />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                setRecipes((list) => [...list, { id: nextId.current++, label: '', command: '' }])
              }
            >
              <IconPlus />
              Add recipe
            </Button>
            {duplicated && (
              <p className="text-destructive-foreground text-sm">Recipe labels must be unique.</p>
            )}
            {save.error && (
              <p className="text-destructive-foreground text-sm">{save.error.message}</p>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={incomplete || duplicated} loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}

/**
 * A ⌘K-style command dialog over every repo the linked owners' tokens can reach.
 * Repos are grouped by owner and filtered as you type (on `owner/name`); clicking
 * one toggles its link without closing, so several can be added in a row. The
 * checkmark reflects what's currently linked (sourced from `projects.list`).
 */
function RepoPickerDialog({
  projectId,
  linkedRepoIds,
  open,
  onOpenChange
}: {
  projectId: number
  linkedRepoIds: Set<number>
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactElement {
  const utils = trpc.useUtils()
  // Only hit GitHub once the dialog is actually opened.
  const reposQuery = trpc.github.listRepos.useQuery(undefined, {
    enabled: open
  })

  const link = trpc.github.linkRepo.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const unlink = trpc.github.unlinkRepo.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })

  const groups = useMemo(() => {
    const byOwner = new Map<string, GithubRepoRow[]>()
    for (const repo of reposQuery.data?.repos ?? []) {
      const list = byOwner.get(repo.owner)
      if (list) list.push(repo)
      else byOwner.set(repo.owner, [repo])
    }
    return [...byOwner.entries()].map(([owner, items]) => ({
      value: owner,
      items
    }))
  }, [reposQuery.data])

  const toggle = (repo: GithubRepoRow): void => {
    if (linkedRepoIds.has(repo.id)) {
      unlink.mutate({ projectId, repoId: repo.id })
    } else {
      link.mutate({
        projectId,
        repoId: repo.id,
        owner: repo.owner,
        name: repo.name,
        private: repo.private,
        description: repo.description,
        url: repo.htmlUrl,
        defaultBranch: repo.defaultBranch
      })
    }
  }

  const failures = reposQuery.data?.errors ?? []

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup>
        <Command items={groups} itemToStringValue={(repo) => (repo as GithubRepoRow).fullName}>
          <CommandInput placeholder="Search repositories…" />
          {failures.length > 0 && (
            <p className="mx-2 mb-1 rounded-md bg-destructive/8 px-2.5 py-1.5 text-destructive-foreground text-xs">
              Couldn’t load repos for {failures.map((f) => f.owner).join(', ')}.
            </p>
          )}
          <CommandEmpty>
            {reposQuery.isLoading ? (
              <span className="flex items-center justify-center gap-2 text-muted-foreground">
                <Spinner className="size-4" />
                Loading repositories…
              </span>
            ) : reposQuery.isError ? (
              'Couldn’t load repositories. Check your tokens and try again.'
            ) : (
              'No repositories found.'
            )}
          </CommandEmpty>
          <CommandList>
            {(group: { value: string; items: GithubRepoRow[] }) => (
              <CommandGroup key={group.value} items={group.items}>
                <CommandGroupLabel>{group.value}</CommandGroupLabel>
                <CommandCollection>
                  {(repo: GithubRepoRow) => (
                    <CommandItem
                      key={repo.id}
                      value={repo}
                      onClick={() => toggle(repo)}
                      className="gap-2"
                    >
                      {repo.private ? (
                        <IconLock className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <IconBrandGithub className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {repo.name}
                        {repo.description && (
                          <span className="ml-2 text-muted-foreground text-xs">
                            {repo.description}
                          </span>
                        )}
                      </span>
                      {linkedRepoIds.has(repo.id) && (
                        <IconCheck className="size-4 shrink-0 text-foreground" />
                      )}
                    </CommandItem>
                  )}
                </CommandCollection>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <CommandFooter>
          <span>Click a repo to link or unlink it</span>
          <span>{linkedRepoIds.size} linked</span>
        </CommandFooter>
      </CommandDialogPopup>
    </CommandDialog>
  )
}

/**
 * The project's Repositories section: the list of linked repos and the picker to
 * add more. Requires at least one linked GitHub owner — otherwise it points the
 * user to Settings to connect one.
 */
export function ProjectRepos({ project }: { project: ProjectWithActions }): ReactElement {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const accountsQuery = trpc.github.listAccounts.useQuery()
  const hasAccounts = (accountsQuery.data?.length ?? 0) > 0
  const [pickerOpen, setPickerOpen] = useState(false)

  const linkedRepoIds = useMemo(
    () => new Set(project.repos.map((repo) => repo.repoId)),
    [project.repos]
  )

  const unlink = trpc.github.unlinkRepo.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-medium text-sm">Repositories</h3>
          <p className="mt-0.5 text-muted-foreground text-sm">
            Link GitHub repositories to see issues, PRs, and what needs your attention.
          </p>
        </div>
        {hasAccounts && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setPickerOpen(true)}
          >
            <IconPlus />
            Add repository
          </Button>
        )}
      </div>

      {!hasAccounts ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-border border-dashed p-6 text-sm">
          <p className="text-muted-foreground">
            Connect a GitHub account to link repositories to this project.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: '/settings' })}>
            <IconBrandGithub />
            Open settings
          </Button>
        </div>
      ) : project.repos.length === 0 ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm transition-colors hover:border-muted-foreground/40 hover:text-foreground"
        >
          No repositories linked yet. Search and add one.
        </button>
      ) : (
        <ul className="flex flex-col gap-2">
          {project.repos.map((repo) => (
            <LinkedRepoRow
              key={repo.id}
              repo={repo}
              projectPath={project.path}
              unlinking={unlink.isPending && unlink.variables?.repoId === repo.repoId}
              onUnlink={() => unlink.mutate({ projectId: project.id, repoId: repo.repoId })}
            />
          ))}
        </ul>
      )}

      {hasAccounts && (
        <RepoPickerDialog
          projectId={project.id}
          linkedRepoIds={linkedRepoIds}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        />
      )}
    </section>
  )
}
