import { IconFilter } from '@tabler/icons-react'
import { createColumnHelper } from '@tanstack/react-table'
import { type ReactElement, type ReactNode, useCallback, useMemo, useState } from 'react'
import { CreateOnGitHubButton, type RepoGroup } from '@/components/create-on-github-button'
import { ProjectIcon } from '@/components/project-icon'
import { ISSUE_COLUMNS, IssuesView } from '@/components/project-issues'
import { PULL_COLUMNS, PullsView } from '@/components/project-pulls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { useRepoIssues, useRepoPulls } from '@/lib/github-queries'
import type { IssueRow, ProjectWithActions, PullRequestRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

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

/** Deselected project ids hide their rows; everything shows by default. New
 * projects appear automatically (absence from the set = visible). */
function useProjectFilter(): { hidden: Set<number>; toggle: (id: number) => void } {
  const [hidden, setHidden] = useState<Set<number>>(() => new Set())
  const toggle = useCallback((id: number) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  return { hidden, toggle }
}

/** Row predicate for the project filter: keep a row unless its attributed
 * project is hidden. Unattributed rows (shouldn't happen) always show. */
function makeRowFilter(
  projectByRepo: Map<string, ProjectRef>,
  hidden: Set<number>
): (row: { repo: { owner: string; name: string } }) => boolean {
  return (row) => {
    const project = projectByRepo.get(repoKey(row.repo.owner, row.repo.name))
    return project ? !hidden.has(project.id) : true
  }
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

/** Toolbar dropdown: every project as a checkbox — deselect to hide its rows.
 * Stays open across toggles; a badge shows the active/total count when filtered. */
function ProjectFilterMenu({
  projects,
  hidden,
  onToggle
}: {
  projects: ProjectWithActions[]
  hidden: Set<number>
  onToggle: (id: number) => void
}): ReactElement {
  const activeCount = projects.filter((project) => !hidden.has(project.id)).length
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" />}>
        <IconFilter />
        Projects
        {hidden.size > 0 && (
          <Badge variant="secondary" size="sm" className="rounded-full">
            {activeCount}/{projects.length}
          </Badge>
        )}
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-52">
        {projects.map((project) => (
          <MenuCheckboxItem
            key={project.id}
            checked={!hidden.has(project.id)}
            onCheckedChange={() => onToggle(project.id)}
            closeOnClick={false}
          >
            <span className="flex items-center gap-2">
              <ProjectIcon
                icon={project.icon}
                color={project.color}
                size={13}
                className="size-4.5"
              />
              <span className="truncate">{project.name}</span>
            </span>
          </MenuCheckboxItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}

/** Full-screen page chrome for a global list: title + the list, or an empty
 * hint when no project has a linked repo yet. */
function GlobalListPage({
  title,
  subtitle,
  count,
  hasRepos,
  children
}: {
  title: string
  subtitle: string
  // Total across all projects; omitted while still loading (no flash of 0).
  count?: number
  hasRepos: boolean
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
      {hasRepos ? (
        children
      ) : (
        <p className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
          Link a repository to a project to see it here.
        </p>
      )}
    </div>
  )
}

const issueColumnHelper = createColumnHelper<IssueRow>()
const pullColumnHelper = createColumnHelper<PullRequestRow>()

/** Open issues across every project's repos — the per-project Issues view with a
 * leading Project column and a project filter. */
export function AllIssues(): ReactElement {
  const projectsQuery = trpc.projects.list.useQuery()
  const projects = projectsQuery.data ?? []
  const { repos, projectByRepo } = useProjectIndex(projects)
  const { hidden, toggle } = useProjectFilter()
  // Total open issues across all projects (unfiltered) — for the page title.
  const { issues, isLoading } = useRepoIssues(repos)

  const columns = useMemo(
    () => [
      issueColumnHelper.display({
        id: 'project',
        header: 'Project',
        meta: { width: '5rem' },
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
  const rowFilter = useMemo(() => makeRowFilter(projectByRepo, hidden), [projectByRepo, hidden])
  const createGroups = useMemo(() => repoGroupsByProject(projects), [projects])

  return (
    <GlobalListPage
      title="Issues"
      subtitle="Open issues across all your projects."
      count={isLoading ? undefined : issues.length}
      hasRepos={repos.length > 0}
    >
      <IssuesView
        repos={repos}
        columns={columns}
        rowFilter={rowFilter}
        toolbarFilter={<ProjectFilterMenu projects={projects} hidden={hidden} onToggle={toggle} />}
        toolbarAction={<CreateOnGitHubButton kind="issue" groups={createGroups} />}
      />
    </GlobalListPage>
  )
}

/** Open pull requests across every project's repos — the per-project Pull
 * requests view with a leading Project column and a project filter. */
export function AllPulls(): ReactElement {
  const projectsQuery = trpc.projects.list.useQuery()
  const projects = projectsQuery.data ?? []
  const { repos, projectByRepo } = useProjectIndex(projects)
  const { hidden, toggle } = useProjectFilter()
  // Total open pull requests across all projects (unfiltered) — for the title.
  const { pulls, isLoading } = useRepoPulls(repos)

  const columns = useMemo(
    () => [
      pullColumnHelper.display({
        id: 'project',
        header: 'Project',
        meta: { width: '5rem' },
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
  const rowFilter = useMemo(() => makeRowFilter(projectByRepo, hidden), [projectByRepo, hidden])
  const createGroups = useMemo(() => repoGroupsByProject(projects), [projects])

  return (
    <GlobalListPage
      title="Pull requests"
      subtitle="Open pull requests across all your projects."
      count={isLoading ? undefined : pulls.length}
      hasRepos={repos.length > 0}
    >
      <PullsView
        repos={repos}
        columns={columns}
        rowFilter={rowFilter}
        toolbarFilter={<ProjectFilterMenu projects={projects} hidden={hidden} onToggle={toggle} />}
        toolbarAction={<CreateOnGitHubButton kind="pull" groups={createGroups} />}
      />
    </GlobalListPage>
  )
}
