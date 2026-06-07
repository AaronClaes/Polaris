import {
  IconCheck,
  IconCircleCheckFilled,
  IconCircleDotFilled,
  IconCircleXFilled,
  IconGitPullRequestConflict,
  IconX
} from '@tabler/icons-react'
import { createColumnHelper } from '@tanstack/react-table'
import { type ReactElement, useMemo } from 'react'
import {
  CollapsibleSection,
  DataTable,
  EmptyHint,
  FailuresBanner,
  ListToolbar,
  OpenButton,
  QueryBoundary,
  TitleCell,
  UserAvatars
} from '@/components/github-list'
import { Badge } from '@/components/ui/badge'
import type { ProjectWithActions, PullRequestRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

/** Rolled-up GitHub Actions status as a leading icon, with a per-workflow
 * tooltip. Renders nothing when there's no run data (or the token lacks the
 * Actions read scope) — see the service note on fine-grained PAT permissions. */
function CheckStatusIcon({ checks }: { checks: PullRequestRow['checks'] }): ReactElement | null {
  let Icon = IconCircleCheckFilled
  let tooltip = ''
  let color = 'text-success-foreground'

  if (checks) {
    tooltip = checks.runs.map((run) => `${run.name}: ${run.state}`).join('\n')
    Icon =
      checks.state === 'passed'
        ? IconCircleCheckFilled
        : checks.state === 'failed'
          ? IconCircleXFilled
          : IconCircleDotFilled

    color =
      checks.state === 'passed'
        ? 'text-success-foreground'
        : checks.state === 'failed'
          ? 'text-destructive-foreground'
          : 'text-warning-foreground'
  }

  return (
    <span className={cn('inline-flex shrink-0', color)} title={tooltip}>
      <Icon className="size-4" />
    </span>
  )
}

/** A danger marker shown beside the PR number only when the branch has merge
 * conflicts. MERGEABLE / UNKNOWN (not yet computed) render nothing. */
function ConflictMarker({
  mergeable
}: {
  mergeable: PullRequestRow['mergeable']
}): ReactElement | null {
  if (mergeable !== 'CONFLICTING') return null
  return (
    <span className="inline-flex shrink-0 text-destructive-foreground" title="Has merge conflicts">
      <IconGitPullRequestConflict className="size-4" />
    </span>
  )
}

/** Counts of submitted reviews (approvals / changes requested), plus a draft tag.
 * Pending reviewers live in their own column. Renders nothing when there's none. */
function ReviewSummary({ pull }: { pull: PullRequestRow }): ReactElement | null {
  const { approved, changesRequested } = pull.reviewSummary
  if (!pull.isDraft && approved === 0 && changesRequested === 0) return null
  return (
    <div className="flex items-center gap-2 text-xs">
      {pull.isDraft && (
        <Badge variant="secondary" size="sm" className="font-normal">
          Draft
        </Badge>
      )}
      {approved > 0 && (
        <span
          className="flex items-center gap-0.5 text-success-foreground"
          title={`${approved} approved`}
        >
          <IconCheck className="size-3.5" />
          {approved}
        </span>
      )}
      {changesRequested > 0 && (
        <span
          className="flex items-center gap-0.5 text-destructive-foreground"
          title={`${changesRequested} requested changes`}
        >
          <IconX className="size-3.5" />
          {changesRequested}
        </span>
      )}
    </div>
  )
}

const columnHelper = createColumnHelper<PullRequestRow>()

const PULL_COLUMNS = [
  columnHelper.accessor('title', {
    header: 'Pull request',
    cell: (cell) => (
      <TitleCell
        title={cell.getValue()}
        number={cell.row.original.number}
        owner={cell.row.original.repo.owner}
        name={cell.row.original.repo.name}
        leading={<CheckStatusIcon checks={cell.row.original.checks} />}
        trailing={<ConflictMarker mergeable={cell.row.original.mergeable} />}
      />
    )
  }),
  columnHelper.display({
    id: 'reviews',
    header: 'Reviews',
    meta: { width: '7rem' },
    cell: (cell) => <ReviewSummary pull={cell.row.original} />
  }),
  columnHelper.accessor('author', {
    header: 'Author',
    meta: { width: '4.5rem' },
    cell: (cell) => {
      const author = cell.getValue()
      return <UserAvatars users={author ? [author] : []} />
    }
  }),
  columnHelper.accessor('assignees', {
    header: 'Assignees',
    meta: { width: '6rem' },
    cell: (cell) => <UserAvatars users={cell.getValue()} />
  }),
  columnHelper.accessor('reviewers', {
    header: 'Reviewers',
    meta: { width: '6rem' },
    cell: (cell) => <UserAvatars users={cell.getValue()} />
  }),
  columnHelper.display({
    id: 'open',
    meta: { width: '3.5rem' },
    cell: (cell) => <OpenButton url={cell.row.original.url} />
  })
]

/** The PR surface for a set of repos: a toolbar + the three sections. Repo-list-
 * driven so a future global inbox can reuse it as-is. */
function PullsView({ repos }: { repos: { owner: string; name: string }[] }): ReactElement {
  const pullsQuery = trpc.github.listPullRequests.useQuery(
    { repos },
    { enabled: repos.length > 0, staleTime: 60_000 }
  )

  const buckets = useMemo(() => {
    const assigned: PullRequestRow[] = []
    const review: PullRequestRow[] = []
    const other: PullRequestRow[] = []
    for (const pull of pullsQuery.data?.pulls ?? []) {
      if (pull.bucket === 'assigned') assigned.push(pull)
      else if (pull.bucket === 'review') review.push(pull)
      else other.push(pull)
    }
    return { assigned, review, other }
  }, [pullsQuery.data])

  const sections = [
    { title: 'Assigned to me', rows: buckets.assigned },
    { title: 'Needs my review', rows: buckets.review },
    { title: 'Other pull requests', rows: buckets.other }
  ]

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        description="Open pull requests across this project's repositories."
        isFetching={pullsQuery.isFetching}
        onRefresh={() => pullsQuery.refetch()}
      />
      <FailuresBanner failures={pullsQuery.data?.errors ?? []} />
      <QueryBoundary
        isLoading={pullsQuery.isLoading}
        isError={pullsQuery.isError}
        errorMessage={pullsQuery.error?.message}
        loadingLabel="Loading pull requests…"
      >
        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <CollapsibleSection
              key={section.title}
              title={section.title}
              count={section.rows.length}
            >
              {section.rows.length === 0 ? (
                <EmptyHint>No pull requests.</EmptyHint>
              ) : (
                <DataTable rows={section.rows} columns={PULL_COLUMNS} />
              )}
            </CollapsibleSection>
          ))}
        </div>
      </QueryBoundary>
    </div>
  )
}

/**
 * The project's Pull Requests tab: open PRs for its linked repos, split into
 * assigned-to-me / needs-my-review / other. Needs at least one linked repo —
 * otherwise it points to the Settings tab.
 */
export function ProjectPulls({ project }: { project: ProjectWithActions }): ReactElement {
  const repos = useMemo(
    () => project.repos.map((repo) => ({ owner: repo.owner, name: repo.name })),
    [project.repos]
  )

  if (repos.length === 0) {
    return (
      <p className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
        Link a repository in the Settings tab to see its pull requests here.
      </p>
    )
  }

  return <PullsView repos={repos} />
}
