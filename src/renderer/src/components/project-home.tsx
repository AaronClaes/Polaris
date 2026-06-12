import { type ReactElement, useMemo } from 'react'
import { FailuresBanner, QueryBoundary } from '@/components/github-list'
import { WorkItemFeed } from '@/components/work-item-feed'
import { useRepoIssues, useRepoPulls } from '@/lib/github-queries'
import type { ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { buildWorkItems, groupByCourt } from '@/lib/work-items'

/**
 * The project's Home tab: the same "what needs me" feed the dashboard shows —
 * this project's issues, PRs and todos fused and ranked by the work-item engine
 * into Needs you / In progress / Waiting / Up next — but scoped to a single
 * project. Reuses the per-repo caches the Issues/Pull requests tabs fill and the
 * todos.list cache the Todos tab fills, so it adds no extra fetches. The per-row
 * project chip is omitted (every row is this project). Needs at least one linked
 * repo or one todo — otherwise it points to the Settings/Todos tabs.
 */
export function ProjectHome({ project }: { project: ProjectWithActions }): ReactElement {
  const repos = useMemo(
    () => project.repos.map((repo) => ({ owner: repo.owner, name: repo.name })),
    [project.repos]
  )

  const {
    pulls,
    errors: pullErrors,
    isLoading: pullsLoading,
    isError: pullsError,
    errorMessage: pullsErrorMessage
  } = useRepoPulls(repos)
  const {
    issues,
    errors: issueErrors,
    isLoading: issuesLoading,
    isError: issuesError,
    errorMessage: issuesErrorMessage
  } = useRepoIssues(repos)

  // Todos are local (no repos needed); shares the cache the Todos tab fills.
  const utils = trpc.useUtils()
  const todosQuery = trpc.todos.list.useQuery({ projectId: project.id })
  const todos = useMemo(() => todosQuery.data ?? [], [todosQuery.data])
  const completeTodo = trpc.todos.setCompleted.useMutation({
    onSuccess: () => utils.todos.invalidate()
  })

  const groups = useMemo(
    () => groupByCourt(buildWorkItems({ issues, pulls, todos, now: new Date() })),
    [issues, pulls, todos]
  )

  // Collapse per-repo failures from both queries, so a repo that fails both
  // (e.g. a bad token) is reported once rather than twice.
  const failures = useMemo(() => {
    const seen = new Set<string>()
    return [...pullErrors, ...issueErrors].filter((failure) => {
      if (seen.has(failure.repo)) return false
      seen.add(failure.repo)
      return true
    })
  }, [pullErrors, issueErrors])

  // Only a dead end when there's nothing at all — a repo-less project can still
  // be all about its todos, so don't short-circuit while any todo exists.
  if (repos.length === 0 && todos.length === 0) {
    return (
      <p className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
        Link a repository in the Settings tab, or add a todo in the Todos tab, to see what needs
        your attention here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <FailuresBanner failures={failures} />
      <QueryBoundary
        isLoading={pullsLoading || issuesLoading}
        isError={pullsError && issuesError}
        errorMessage={pullsErrorMessage ?? issuesErrorMessage}
        loadingLabel="Loading what needs you…"
      >
        {/* Scoped to one project, so the per-row project chip is redundant —
            return undefined to omit it. */}
        <WorkItemFeed
          groups={groups}
          itemProject={() => undefined}
          onCompleteTodo={(id) => completeTodo.mutate({ id, completed: true })}
        />
      </QueryBoundary>
    </div>
  )
}
