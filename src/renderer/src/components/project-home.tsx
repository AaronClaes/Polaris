import { IconCircleCheck } from '@tabler/icons-react'
import type { TableOptions } from '@tanstack/react-table'
import { type ReactElement, useDeferredValue, useMemo, useState } from 'react'
import {
  CollapsibleSection,
  DataTable,
  EmptyHint,
  FailuresBanner,
  ListToolbar,
  QueryBoundary
} from '@/components/github-list'
import { ISSUE_COLUMNS, issueMatches } from '@/components/project-issues'
import { PULL_COLUMNS, pullMatches } from '@/components/project-pulls'
import { useRepoIssues, useRepoPulls } from '@/lib/github-queries'
import type { IssueRow, ProjectWithActions, PullRequestRow } from '@/lib/project-types'

/** One section of the Home tab: a collapsible table that hides itself while a
 * search is active and has no matches. Generic so the PR and issue tables keep
 * their own column types. */
function HomeSection<T>({
  title,
  rows,
  columns,
  emptyLabel,
  hidden
}: {
  title: string
  rows: T[]
  columns: TableOptions<T>['columns']
  emptyLabel: string
  hidden: boolean
}): ReactElement | null {
  if (hidden) return null
  return (
    <CollapsibleSection title={title} count={rows.length}>
      {rows.length === 0 ? (
        <EmptyHint>{emptyLabel}</EmptyHint>
      ) : (
        <DataTable rows={rows} columns={columns} />
      )}
    </CollapsibleSection>
  )
}

/** Collapse per-repo failures from the issue and PR queries, so a repo that
 * fails both (e.g. a bad token) is reported once rather than twice. */
function dedupeByRepo(
  failures: { repo: string; message: string }[]
): { repo: string; message: string }[] {
  const seen = new Set<string>()
  return failures.filter((failure) => {
    if (seen.has(failure.repo)) return false
    seen.add(failure.repo)
    return true
  })
}

/**
 * The project's Home tab: just the things that need you, across its linked
 * repos — pull requests assigned to you, pull requests awaiting your review,
 * and issues assigned to you. Reuses the per-repo caches the Issues and Pull
 * requests tabs fill, so it adds no extra fetches. Needs at least one linked
 * repo — otherwise it points to the Settings tab.
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
    errorMessage: pullsErrorMessage,
    isFetching: pullsFetching,
    refetch: refetchPulls
  } = useRepoPulls(repos)
  const {
    issues,
    errors: issueErrors,
    isLoading: issuesLoading,
    isError: issuesError,
    errorMessage: issuesErrorMessage,
    isFetching: issuesFetching,
    refetch: refetchIssues
  } = useRepoIssues(repos)

  const [query, setQuery] = useState('')
  // Same pattern as the Issues/Pulls tabs: the input stays responsive while the
  // deferred value drives filtering, so a keystroke never blocks on the tables.
  const deferredQuery = useDeferredValue(query)

  const { assignedPulls, reviewPulls, myIssues } = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    const keepPull = (pull: PullRequestRow): boolean => q === '' || pullMatches(pull, q)
    const keepIssue = (issue: IssueRow): boolean => q === '' || issueMatches(issue, q)
    return {
      assignedPulls: pulls.filter((p) => p.bucket === 'assigned' && keepPull(p)),
      reviewPulls: pulls.filter((p) => p.bucket === 'review' && keepPull(p)),
      myIssues: issues.filter((i) => i.bucket === 'mine' && keepIssue(i))
    }
  }, [pulls, issues, deferredQuery])

  if (repos.length === 0) {
    return (
      <p className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
        Link a repository in the Settings tab to see what needs your attention here.
      </p>
    )
  }

  // Merge the two queries into one surface: refresh refetches both, a spinner
  // shows until both first loads finish, and we only fall back to the error
  // screen if both fail outright — a single source failing shows in the banner.
  const refresh = (): void => {
    refetchPulls()
    refetchIssues()
  }
  const failures = dedupeByRepo([...pullErrors, ...issueErrors])

  const isSearching = deferredQuery.trim().length > 0
  const total = assignedPulls.length + reviewPulls.length + myIssues.length

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        isFetching={pullsFetching || issuesFetching}
        onRefresh={refresh}
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search what needs you…"
      />
      <FailuresBanner failures={failures} />
      <QueryBoundary
        isLoading={pullsLoading || issuesLoading}
        isError={pullsError && issuesError}
        errorMessage={pullsErrorMessage ?? issuesErrorMessage}
        loadingLabel="Loading…"
      >
        {total === 0 ? (
          isSearching ? (
            <EmptyHint>No matches for “{deferredQuery.trim()}”.</EmptyHint>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border border-dashed px-4 py-12 text-center">
              <IconCircleCheck className="size-6 text-muted-foreground" />
              <p className="font-medium text-sm">You're all caught up</p>
              <p className="text-muted-foreground text-sm">
                No pull requests or issues need your attention right now.
              </p>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <HomeSection
              title="Pull requests assigned to me"
              rows={assignedPulls}
              columns={PULL_COLUMNS}
              emptyLabel="No pull requests."
              hidden={isSearching && assignedPulls.length === 0}
            />
            <HomeSection
              title="Needs my review"
              rows={reviewPulls}
              columns={PULL_COLUMNS}
              emptyLabel="No pull requests."
              hidden={isSearching && reviewPulls.length === 0}
            />
            <HomeSection
              title="Issues assigned to me"
              rows={myIssues}
              columns={ISSUE_COLUMNS}
              emptyLabel="No issues."
              hidden={isSearching && myIssues.length === 0}
            />
          </div>
        )}
      </QueryBoundary>
    </div>
  )
}
