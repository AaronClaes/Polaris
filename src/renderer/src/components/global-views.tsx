import { createColumnHelper } from '@tanstack/react-table'
import { type ReactElement, type ReactNode, useCallback, useMemo } from 'react'
import { CreateOnGitHubButton, type RepoGroup } from '@/components/create-on-github-button'
import { ProjectIcon } from '@/components/project-icon'
import { ISSUE_COLUMNS, IssuesView } from '@/components/project-issues'
import { PULL_COLUMNS, PullsView } from '@/components/project-pulls'
import { TodosView } from '@/components/project-todos'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { useRepoIssues, useRepoPulls } from '@/lib/github-queries'
import type { FilterField } from '@/lib/list-filters'
import type { IssueRow, ProjectWithActions, PullRequestRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { useVisibleProjects, useVisibleTodos } from '@/lib/use-visible-projects'

/** The display bits of a project, attached to each repo for the Project column. */
type ProjectRef = { id: number; name: string; icon: string; color: string }

/** Lowercased so a row's repo (GitHub canonical casing) matches the stored one. */
function repoKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`
}

/**
 * The deduped union of every linked repo, plus a repo → owning-project lookup
 * for the Project column and the project filter. A repo linked to several
 * projects is attributed to the first it appears in (projects.list is newest
 * first), and fetched once.
 */
function useProjectIndex(projects: ProjectWithActions[]): {
  repos: { owner: string; name: string }[]
  projectByRepo: Map<string, ProjectRef>
} {
  return useMemo(() => {
    const repos: { owner: string; name: string }[] = []
    const projectByRepo = new Map<string, ProjectRef>()
    for (const project of projects) {
      for (const repo of project.repos) {
        const key = repoKey(repo.owner, repo.name)
        if (projectByRepo.has(key)) continue
        projectByRepo.set(key, {
          id: project.id,
          name: project.name,
          icon: project.icon,
          color: project.color
        })
        repos.push({ owner: repo.owner, name: repo.name })
      }
    }
    return { repos, projectByRepo }
  }, [projects])
}

/** Repo groups for the create-on-GitHub picker: one labeled group per project
 * with linked repos. Not deduped (unlike the fetch index) — a repo shared by
 * several projects appears under each, so you create in the right context. */
function repoGroupsByProject(projects: ProjectWithActions[]): RepoGroup[] {
  return projects
    .map((project) => ({
      key: String(project.id),
      label: project.name,
      repos: project.repos.map((repo) => ({ owner: repo.owner, name: repo.name }))
    }))
    .filter((group) => group.repos.length > 0)
}

/** A "Project" filter field for the global views: its options are the projects
 * present in the rows (attributed via `projectByRepo`), so the global lists gain
 * project filtering through the same Add-filter UI as every other property. */
function useProjectField<T extends { repo: { owner: string; name: string } }>(
  projectByRepo: Map<string, ProjectRef>
): FilterField<T> {
  return useMemo(
    () => ({
      id: 'project',
      label: 'Project',
      buildOptions: (rows: T[]) => {
        const byId = new Map<number, ProjectRef>()
        for (const row of rows) {
          const project = projectByRepo.get(repoKey(row.repo.owner, row.repo.name))
          if (project && !byId.has(project.id)) byId.set(project.id, project)
        }
        return [...byId.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((project) => ({
            value: String(project.id),
            label: project.name,
            kind: 'project' as const,
            project: { icon: project.icon, color: project.color }
          }))
      },
      matches: (row, selected) => {
        const project = projectByRepo.get(repoKey(row.repo.owner, row.repo.name))
        return project ? selected.has(String(project.id)) : false
      }
    }),
    [projectByRepo]
  )
}

/** The Project column cell: the project's color-tinted icon, name on hover. */
function ProjectCell({ project }: { project?: ProjectRef }): ReactElement | null {
  if (!project) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex w-fit">
            <ProjectIcon icon={project.icon} color={project.color} size={14} className="size-6" />
          </span>
        }
      />
      <TooltipPopup>{project.name}</TooltipPopup>
    </Tooltip>
  )
}

/** Full-screen page chrome for a global list: title + the list, or an empty
 * hint when there's nothing to show yet. */
function GlobalListPage({
  title,
  subtitle,
  count,
  hasContent,
  emptyHint = 'Link a repository to a project to see it here.',
  children
}: {
  title: string
  subtitle: string
  // Total across all projects; omitted while still loading (no flash of 0).
  count?: number
  // Whether there's anything to render; otherwise `emptyHint` shows instead.
  hasContent: boolean
  emptyHint?: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">
          {title}
          {count !== undefined && (
            <span className="ml-2 font-normal text-muted-foreground">{count}</span>
          )}
        </h1>
        <p className="mt-0.5 text-muted-foreground text-sm">{subtitle}</p>
      </header>
      {hasContent ? (
        children
      ) : (
        <p className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
          {emptyHint}
        </p>
      )}
    </div>
  )
}

const issueColumnHelper = createColumnHelper<IssueRow>()
const pullColumnHelper = createColumnHelper<PullRequestRow>()

/** Open issues across every project's repos — the per-project Issues view with a
 * leading Project column and a Project filter. */
export function AllIssues(): ReactElement {
  const projectsQuery = useVisibleProjects()
  const projects = projectsQuery.data ?? []
  const { repos, projectByRepo } = useProjectIndex(projects)
  // Total open issues across all projects (unfiltered) — for the page title.
  const { issues, isLoading } = useRepoIssues(repos)

  const columns = useMemo(
    () => [
      issueColumnHelper.display({
        id: 'project',
        meta: { width: '3rem' },
        cell: (cell) => (
          <ProjectCell
            project={projectByRepo.get(
              repoKey(cell.row.original.repo.owner, cell.row.original.repo.name)
            )}
          />
        )
      }),
      ...ISSUE_COLUMNS
    ],
    [projectByRepo]
  )
  const projectField = useProjectField<IssueRow>(projectByRepo)
  const extraFields = useMemo(() => [projectField], [projectField])
  const createGroups = useMemo(() => repoGroupsByProject(projects), [projects])

  return (
    <GlobalListPage
      title="Issues"
      subtitle="Open issues across all your projects."
      count={isLoading ? undefined : issues.length}
      hasContent={repos.length > 0}
    >
      <IssuesView
        repos={repos}
        columns={columns}
        extraFields={extraFields}
        toolbarAction={<CreateOnGitHubButton kind="issue" groups={createGroups} />}
      />
    </GlobalListPage>
  )
}

/** Open pull requests across every project's repos — the per-project Pull
 * requests view with a leading Project column and a Project filter. */
export function AllPulls(): ReactElement {
  const projectsQuery = useVisibleProjects()
  const projects = projectsQuery.data ?? []
  const { repos, projectByRepo } = useProjectIndex(projects)
  // Total open pull requests across all projects (unfiltered) — for the title.
  const { pulls, isLoading } = useRepoPulls(repos)

  const columns = useMemo(
    () => [
      pullColumnHelper.display({
        id: 'project',
        meta: { width: '3rem' },
        cell: (cell) => (
          <ProjectCell
            project={projectByRepo.get(
              repoKey(cell.row.original.repo.owner, cell.row.original.repo.name)
            )}
          />
        )
      }),
      ...PULL_COLUMNS
    ],
    [projectByRepo]
  )
  const projectField = useProjectField<PullRequestRow>(projectByRepo)
  const extraFields = useMemo(() => [projectField], [projectField])
  const createGroups = useMemo(() => repoGroupsByProject(projects), [projects])

  return (
    <GlobalListPage
      title="Pull requests"
      subtitle="Open pull requests across all your projects."
      count={isLoading ? undefined : pulls.length}
      hasContent={repos.length > 0}
    >
      <PullsView
        repos={repos}
        columns={columns}
        extraFields={extraFields}
        toolbarAction={<CreateOnGitHubButton kind="pull" groups={createGroups} />}
      />
    </GlobalListPage>
  )
}

/** Every project's todos in one flat list, each tagged with its project. The add
 * row carries a project picker (todos can be created here, not just in a tab). */
export function AllTodos(): ReactElement {
  const utils = trpc.useUtils()
  const projectsQuery = useVisibleProjects()
  const projects = projectsQuery.data ?? []
  // Todos filtered to the visible projects under the current tag filter.
  const todosQuery = useVisibleTodos()
  const rows = useMemo(() => todosQuery.data ?? [], [todosQuery.data])
  // The page count is open todos (matches the nav badge), not the total.
  const openCount = rows.filter((todo) => !todo.completed).length

  const addProjects = useMemo(
    () =>
      projects.map((project) => ({
        id: project.id,
        name: project.name,
        icon: project.icon,
        color: project.color
      })),
    [projects]
  )

  const invalidate = useCallback(() => utils.todos.invalidate(), [utils])
  const create = trpc.todos.create.useMutation({ onSuccess: invalidate })
  const update = trpc.todos.update.useMutation({ onSuccess: invalidate })
  const setCompleted = trpc.todos.setCompleted.useMutation({ onSuccess: invalidate })
  const remove = trpc.todos.delete.useMutation({ onSuccess: invalidate })

  return (
    <GlobalListPage
      title="Todos"
      subtitle="Tasks across all your projects, plus quick todos linked to none."
      count={todosQuery.isLoading ? undefined : openCount}
      // Always rendered: even with no projects you can add an unlinked todo.
      hasContent
    >
      <TodosView
        rows={rows}
        isLoading={todosQuery.isLoading}
        showProject
        addProjects={addProjects}
        creating={create.isPending}
        pendingDeleteId={remove.isPending ? remove.variables?.id : undefined}
        onCreate={(input) => create.mutate(input)}
        onUpdate={(input) => update.mutate(input)}
        onToggle={(id, completed) => setCompleted.mutate({ id, completed })}
        onDelete={(id) => remove.mutate({ id })}
      />
    </GlobalListPage>
  )
}
