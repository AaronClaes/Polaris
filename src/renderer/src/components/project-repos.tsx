import {
  IconBrandGithub,
  IconCheck,
  IconExternalLink,
  IconLock,
  IconPlus,
  IconTrash
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { type ReactElement, useMemo, useState } from 'react'
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
import { Spinner } from '@/components/ui/spinner'
import type { GithubRepoRow, ProjectRepoRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** One linked repo: identity (opens on GitHub) + an unlink button. */
function LinkedRepoRow({
  repo,
  unlinking,
  onUnlink
}: {
  repo: ProjectRepoRow
  unlinking: boolean
  onUnlink: () => void
}): ReactElement {
  const Icon = repo.private ? IconLock : IconBrandGithub
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
      </div>
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
    </li>
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
    <section className="flex flex-col gap-3">
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
