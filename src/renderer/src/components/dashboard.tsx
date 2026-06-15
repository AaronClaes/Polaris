import { IconChevronRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type ReactElement, useMemo } from 'react'
import { FailuresBanner, QueryBoundary } from '@/components/github-list'
import { ProjectCard } from '@/components/project-card'
import { TodayAgenda } from '@/components/today-agenda'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { WorkItemFeed } from '@/components/work-item-feed'
import { useRepoIssues, useRepoPulls } from '@/lib/github-queries'
import { useCompleteEmail, useEditEmailTitle, useNeedsMeEmails } from '@/lib/gmail-queries'
import type { ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { useVisibleProjects, useVisibleTodos } from '@/lib/use-visible-projects'
import { buildWorkItems, groupByCourt, type WorkItem } from '@/lib/work-items'

// The dashboard greets by name; there's no user profile yet, so this is fixed.
const USER_NAME = 'Aaron'

/** A time-of-day greeting: morning 5–12, afternoon 12–17, evening 17–22, else night. */
function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 22) return 'Good evening'
  return 'Good night'
}

/**
 * The home dashboard. The launch grid of pinned projects on top, then a "what
 * needs me today" feed — every issue, PR and todo across all linked repos, fused
 * and ranked by the work-item engine into Needs you / In progress / Waiting / Up
 * next. Reads the same per-repo caches the lists use, so it adds no fetches.
 */
export function Dashboard(): ReactElement {
  const projectsQuery = useVisibleProjects()
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
    const map = new Map<string, ProjectWithActions>()
    for (const project of projects) {
      for (const repo of project.repos) {
        map.set(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, project)
      }
    }
    return map
  }, [projects])
  const projectById = useMemo(() => {
    const map = new Map<number, ProjectWithActions>()
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
  // Todos filtered to the visible projects under the current tag filter
  // (issues/PRs already are, via `allRepos`).
  const todosQuery = useVisibleTodos()
  const todos = useMemo(() => todosQuery.data ?? [], [todosQuery.data])
  // Client emails needing a reply (empty unless a Google account is linked).
  const { emails, errors: emailErrors } = useNeedsMeEmails()

  // Tick a todo off straight from the feed; invalidating refetches the list, so
  // the completed one drops out on the next render.
  const utils = trpc.useUtils()
  const completeTodo = trpc.todos.setCompleted.useMutation({
    onSuccess: () => utils.todos.invalidate()
  })
  // Mark an email done — optimistically removed from the feed (Gmail untouched).
  const completeEmail = useCompleteEmail()
  // Rename an email's feed title locally (Gmail untouched); blank clears it.
  const editEmailTitle = useEditEmailTitle()

  const groups = useMemo(
    () => groupByCourt(buildWorkItems({ issues, pulls, todos, emails, now: new Date() })),
    [issues, pulls, todos, emails]
  )

  function itemProject(item: WorkItem): ProjectWithActions | undefined {
    if (item.kind === 'todo') {
      // An unlinked todo has no project chip.
      return item.todo.projectId != null ? projectById.get(item.todo.projectId) : undefined
    }
    if (item.kind === 'email') {
      // A dashboard-only email (no originating project) has no chip.
      return item.email.projectId != null ? projectById.get(item.email.projectId) : undefined
    }
    const repo = item.kind === 'pr' ? item.pr.repo : item.issue.repo
    return projectByRepo.get(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`)
  }

  // One repo failing shouldn't blank the feed — collapse both queries' per-repo
  // failures (deduped) into the banner.
  const failures = useMemo(() => {
    const seen = new Set<string>()
    // Email failures are per-account; surface them in the same banner.
    const emailFailures = emailErrors.map((error) => ({
      repo: error.account,
      message: error.message
    }))
    return [...issueErrors, ...pullErrors, ...emailFailures].filter((failure) => {
      if (seen.has(failure.repo)) return false
      seen.add(failure.repo)
      return true
    })
  }, [issueErrors, pullErrors, emailErrors])

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
            <h2 className="font-heading font-semibold text-lg tracking-tight">Pinned projects</h2>
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

      <TodayAgenda />

      <section className="flex flex-col gap-4">
        <h2 className="font-heading font-semibold text-lg tracking-tight">Tasks</h2>
        <FailuresBanner failures={failures} />
        <QueryBoundary
          isLoading={issuesLoading || pullsLoading}
          isError={issuesError && pullsError}
          loadingLabel="Loading what needs you…"
        >
          <WorkItemFeed
            groups={groups}
            itemProject={itemProject}
            onCompleteTodo={(id) => completeTodo.mutate({ id, completed: true })}
            onCompleteEmail={(email) =>
              completeEmail.mutate({
                account: email.account,
                threadId: email.id,
                lastMessageAt: email.lastMessageAt
              })
            }
            onEditEmailTitle={(email, title) =>
              editEmailTitle.mutate({ account: email.account, threadId: email.id, title })
            }
          />
        </QueryBoundary>
      </section>
    </div>
  )
}
