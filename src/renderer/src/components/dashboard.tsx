import {
  IconChevronRight,
  IconCircle,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCircleDotFilled,
  IconCircleXFilled,
  IconGitPullRequest,
  IconGitPullRequestConflict,
  IconX
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type ReactElement, useMemo } from 'react'
import {
  CollapsibleSection,
  FailuresBanner,
  OpenButton,
  QueryBoundary,
  UserAvatars
} from '@/components/github-list'
import { ProjectCard } from '@/components/project-card'
import { ProjectIcon } from '@/components/project-icon'
import { IssueTypeIcon } from '@/components/project-issues'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useRepoIssues, useRepoPulls } from '@/lib/github-queries'
import type { ProjectWithActions, PullRequestRow } from '@/lib/project-types'
import { formatRelative } from '@/lib/relative-time'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import {
  buildWorkItems,
  type Court,
  groupByCourt,
  type WorkItem,
  type WorkItemStatus
} from '@/lib/work-items'

// The dashboard greets by name; there's no user profile yet, so this is fixed.
const USER_NAME = 'Aaron'

/** A time-of-day greeting: morning 5–12, afternoon 12–17, evening 17–22, else night. */
function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 22) return 'Good evening'
  return 'Good night'
}

/** A linked project, resolved for a work item from its repo or projectId. */
type Project = ProjectWithActions

/** The four courts in display order, with the section label and whether it
 * starts open. The two lower-priority courts start collapsed so the things that
 * need you stay front and center. */
const COURTS: { court: Court; label: string; defaultOpen: boolean }[] = [
  { court: 'act', label: 'Needs you', defaultOpen: true },
  { court: 'flight', label: 'In progress', defaultOpen: true },
  { court: 'waiting', label: 'Waiting', defaultOpen: false },
  { court: 'next', label: 'Up next', defaultOpen: false }
]

/** Per-status pill: the human label and the badge tone. (A plain 'todo' shows no
 * pill — being in "Up next" already says it, per the design feedback.) */
const STATUS_BADGE: Record<WorkItemStatus, { label: string; variant: BadgeProps['variant'] }> = {
  'needs-work': { label: 'Needs work', variant: 'error' },
  'review-requested': { label: 'Review requested', variant: 'info' },
  'ready-to-merge': { label: 'Ready to merge', variant: 'success' },
  due: { label: 'Due', variant: 'warning' },
  'in-progress': { label: 'In progress', variant: 'info' },
  draft: { label: 'Draft', variant: 'secondary' },
  'awaiting-review': { label: 'Awaiting review', variant: 'secondary' },
  'ci-running': { label: 'CI running', variant: 'warning' },
  'in-review-elsewhere': { label: 'In review', variant: 'secondary' },
  'to-do': { label: 'To do', variant: 'outline' },
  todo: { label: 'Todo', variant: 'outline' }
}

/** A fused PR is labelled by its issue — the issue describes the task, the PR
 * title describes what was done. Otherwise it's the item's own title. */
function itemTitle(item: WorkItem): string {
  if (item.kind === 'pr') return (item.issue ?? item.pr).title
  if (item.kind === 'issue') return item.issue.title
  return item.todo.title
}

function itemNumber(item: WorkItem): number | null {
  if (item.kind === 'pr') return item.pr.number
  if (item.kind === 'issue') return item.issue.number
  return null
}

/** The muted second line: a time cue (when it was last touched, or — for a todo
 * — when it's due, measured to the end of the due day). */
function metaLabel(item: WorkItem): string {
  if (item.kind === 'todo') {
    if (item.due) return item.due === 'overdue' ? 'overdue' : 'due today'
    if (!item.todo.dueDate) return ''
    const deadline = new Date(item.todo.dueDate)
    deadline.setHours(23, 59, 59, 999)
    return `due ${formatRelative(deadline.toISOString())}`
  }
  const iso = item.kind === 'pr' ? item.pr.updatedAt : item.issue.updatedAt
  return `updated ${formatRelative(iso)}`
}

/** The leading glyph. Anything with an issue (a standalone issue or a fused PR)
 * shows that issue's type — Bug / Feature / Task — so the kind of work reads at a
 * glance; a bare PR shows the PR glyph, a todo a simple circle. */
function KindIcon({ item }: { item: WorkItem }): ReactElement {
  if (item.kind === 'issue') return <IssueTypeIcon type={item.issue.type} />
  if (item.kind === 'pr' && item.issue) return <IssueTypeIcon type={item.issue.type} />
  const Icon = item.kind === 'pr' ? IconGitPullRequest : IconCircle
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}

/** Rolled-up CI for a PR's head, as a small colored dot. Renders nothing when
 * there's no run data (or the token lacks Actions read) — so a green dot always
 * means "CI passed", never "no CI". */
function CiIcon({ checks }: { checks: PullRequestRow['checks'] }): ReactElement | null {
  if (!checks) return null
  const map = {
    passed: { Icon: IconCircleCheckFilled, color: 'text-success-foreground', label: 'CI passed' },
    failed: { Icon: IconCircleXFilled, color: 'text-destructive-foreground', label: 'CI failing' },
    running: { Icon: IconCircleDotFilled, color: 'text-warning-foreground', label: 'CI running' }
  }[checks.state]
  return (
    <span className={cn('inline-flex shrink-0', map.color)} title={map.label}>
      <map.Icon className="size-3.5" />
    </span>
  )
}

/** The remaining "needs work" reasons as danger glyphs (CI failure is already
 * shown by the CI dot, so only conflicts and requested changes appear here). */
function ReasonIcons({ item }: { item: WorkItem }): ReactElement | null {
  if (item.kind !== 'pr' || item.reasons.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-destructive-foreground">
      {item.reasons.includes('conflict') && (
        <span className="inline-flex" title="Merge conflicts">
          <IconGitPullRequestConflict className="size-3.5" />
        </span>
      )}
      {item.reasons.includes('changes-requested') && (
        <span className="inline-flex" title="Changes requested">
          <IconX className="size-3.5" />
        </span>
      )}
    </span>
  )
}

/** One work item as a row: kind glyph, title + project/time, PR health + status,
 * pending reviewers, and a trailing control — open on GitHub for an issue/PR, or
 * jump to the project's Todos tab for a todo. */
function WorkItemRow({
  item,
  project
}: {
  item: WorkItem
  project: Project | undefined
}): ReactElement {
  const number = itemNumber(item)
  const badge = STATUS_BADGE[item.status]

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <KindIcon item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium text-sm">{itemTitle(item)}</span>
          {number !== null && (
            <span className="shrink-0 text-muted-foreground text-xs">#{number}</span>
          )}
          {item.kind === 'pr' && <CiIcon checks={item.pr.checks} />}
          <ReasonIcons item={item} />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          {project && (
            <span className="flex min-w-0 items-center gap-1">
              <ProjectIcon
                icon={project.icon}
                color={project.color}
                size={10}
                className="size-3.5"
              />
              <span className="truncate">{project.name}</span>
            </span>
          )}
          {metaLabel(item) && <span className="shrink-0">· {metaLabel(item)}</span>}
        </div>
      </div>
      {item.kind === 'pr' && item.pr.reviewers.length > 0 && (
        <UserAvatars users={item.pr.reviewers} />
      )}
      {item.status !== 'todo' && (
        <Badge variant={badge.variant} size="sm" className="shrink-0">
          {badge.label}
        </Badge>
      )}
      {item.kind === 'todo' ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open in project"
          title="Open in project"
          render={
            <Link
              to="/projects/$projectId"
              params={{ projectId: String(item.todo.projectId) }}
              search={{ tab: 'todos' }}
            />
          }
        >
          <IconChevronRight />
        </Button>
      ) : (
        <OpenButton url={item.kind === 'pr' ? item.pr.url : item.issue.url} />
      )}
    </div>
  )
}

/**
 * The home dashboard. The launch grid of pinned projects on top, then a "what
 * needs me today" feed — every issue, PR and todo across all linked repos, fused
 * and ranked by the work-item engine into Needs you / In progress / Waiting / Up
 * next. Reads the same per-repo caches the lists use, so it adds no fetches.
 */
export function Dashboard(): ReactElement {
  const projectsQuery = trpc.projects.list.useQuery()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const pinned = projects.filter((project) => project.pinned)

  // The union of every linked repo, deduped — the dashboard aggregates across all
  // projects, not just the pinned ones. Same shape the global views fetch.
  const allRepos = useMemo(() => {
    const seen = new Set<string>()
    const repos: { owner: string; name: string }[] = []
    for (const project of projects) {
      for (const repo of project.repos) {
        const key = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        repos.push({ owner: repo.owner, name: repo.name })
      }
    }
    return repos
  }, [projects])

  // Resolve a work item back to its project — by repo for issues/PRs, by id for
  // todos — so each row can show the project chip.
  const projectByRepo = useMemo(() => {
    const map = new Map<string, Project>()
    for (const project of projects) {
      for (const repo of project.repos) {
        map.set(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, project)
      }
    }
    return map
  }, [projects])
  const projectById = useMemo(() => {
    const map = new Map<number, Project>()
    for (const project of projects) map.set(project.id, project)
    return map
  }, [projects])

  const {
    issues,
    errors: issueErrors,
    isLoading: issuesLoading,
    isError: issuesError
  } = useRepoIssues(allRepos)
  const {
    pulls,
    errors: pullErrors,
    isLoading: pullsLoading,
    isError: pullsError
  } = useRepoPulls(allRepos)
  const todosQuery = trpc.todos.listAll.useQuery()
  const todos = todosQuery.data ?? []

  const groups = useMemo(
    () => groupByCourt(buildWorkItems({ issues, pulls, todos, now: new Date() })),
    [issues, pulls, todos]
  )

  function itemProject(item: WorkItem): Project | undefined {
    if (item.kind === 'todo') return projectById.get(item.todo.projectId)
    const repo = item.kind === 'pr' ? item.pr.repo : item.issue.repo
    return projectByRepo.get(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`)
  }

  // One repo failing shouldn't blank the feed — collapse both queries' per-repo
  // failures (deduped) into the banner.
  const failures = useMemo(() => {
    const seen = new Set<string>()
    return [...issueErrors, ...pullErrors].filter((failure) => {
      if (seen.has(failure.repo)) return false
      seen.add(failure.repo)
      return true
    })
  }, [issueErrors, pullErrors])

  const total = COURTS.reduce((sum, { court }) => sum + groups[court].length, 0)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-8 py-10">
      <div className="flex flex-col gap-6">
        <h1 className="font-heading font-semibold text-4xl tracking-tight">
          {greeting(new Date().getHours())}, {USER_NAME}
        </h1>
        <Separator />
      </div>

      {pinned.length > 0 && (
        <section className="flex flex-col gap-4">
          <header className="flex items-center justify-between gap-3">
            <h2 className="font-heading font-semibold text-lg tracking-tight">Projects</h2>
            <Button variant="ghost" size="sm" render={<Link to="/projects" />}>
              View all
              <IconChevronRight />
            </Button>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pinned.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <FailuresBanner failures={failures} />
        <QueryBoundary
          isLoading={issuesLoading || pullsLoading}
          isError={issuesError && pullsError}
          loadingLabel="Loading what needs you…"
        >
          {total === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border border-dashed px-4 py-12 text-center">
              <IconCircleCheck className="size-6 text-muted-foreground" />
              <p className="font-medium text-sm">You're all caught up</p>
              <p className="text-muted-foreground text-sm">
                No pull requests, issues or todos need your attention right now.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {COURTS.map(({ court, label, defaultOpen }) => {
                const rows = groups[court]
                if (rows.length === 0) return null
                return (
                  <CollapsibleSection
                    key={court}
                    title={label}
                    count={rows.length}
                    defaultOpen={defaultOpen}
                  >
                    <div className="divide-y divide-border">
                      {rows.map((item) => (
                        <WorkItemRow key={item.key} item={item} project={itemProject(item)} />
                      ))}
                    </div>
                  </CollapsibleSection>
                )
              })}
            </div>
          )}
        </QueryBoundary>
      </section>
    </div>
  )
}
