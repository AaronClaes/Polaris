import {
  IconCheck,
  IconCircleCheckFilled,
  IconCircleDotFilled,
  IconCircleXFilled,
  IconGitPullRequestConflict,
  IconX
} from '@tabler/icons-react'
import { createColumnHelper, type TableOptions } from '@tanstack/react-table'
import { memo, type ReactElement, type ReactNode, useDeferredValue, useMemo, useState } from 'react'
import { CreateOnGitHubButton } from '@/components/create-on-github-button'
import {
  CollapsibleSection,
  DataTable,
  EmptyHint,
  FailuresBanner,
  ListToolbar,
  OpenButton,
  QueryBoundary,
  TitleCell,
  UserAvatar,
  UserAvatars
} from '@/components/github-list'
import { useListFilters } from '@/components/list-filter-bar'
import { Badge } from '@/components/ui/badge'
import { useRepoPulls } from '@/lib/github-queries'
import {
  type ActiveFilter,
  compileFilters,
  type FilterField,
  PULL_FILTER_FIELDS,
  rowMatchesFilters
} from '@/lib/list-filters'
import type { ProjectWithActions, PullRequestRow } from '@/lib/project-types'
import { cn } from '@/lib/utils'

/** Rolled-up GitHub Actions status as a leading icon, with a per-workflow
 * tooltip. Renders nothing when there's no run data (or the token lacks the
 * Actions read scope) — see the service note on fine-grained PAT permissions. */
const CheckStatusIcon = memo(function CheckStatusIcon({
  checks
}: {
  checks: PullRequestRow['checks']
}): ReactElement | null {
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
})

/** A danger marker shown beside the PR number only when the branch has merge
 * conflicts. MERGEABLE / UNKNOWN (not yet computed) render nothing. */
const ConflictMarker = memo(function ConflictMarker({
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
})

/** Counts of submitted reviews (approvals / changes requested), plus a draft tag.
 * Pending reviewers live in their own column. Renders nothing when there's none. */
const ReviewSummary = memo(function ReviewSummary({
  pull
}: {
  pull: PullRequestRow
}): ReactElement | null {
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
})

const columnHelper = createColumnHelper<PullRequestRow>()

// Exported so the global pull requests view can prepend a Project column.
export const PULL_COLUMNS = [
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
      return author ? <UserAvatar user={author} /> : null
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

/** Case-insensitive substring match across a PR's user-visible fields, for the
 * client-side search box. `query` is expected already lower-cased. */
export function pullMatches(pull: PullRequestRow, query: string): boolean {
  return (
    pull.title.toLowerCase().includes(query) ||
    `#${pull.number}`.includes(query) ||
    `${pull.repo.owner}/${pull.repo.name}`.toLowerCase().includes(query) ||
    (pull.author?.login.toLowerCase().includes(query) ?? false) ||
    pull.assignees.some((person) => person.login.toLowerCase().includes(query)) ||
    pull.reviewers.some((person) => person.login.toLowerCase().includes(query))
  )
}

/** The PR surface for a set of repos: a toolbar + the three sections. Repo-list-
 * driven and parametrized so the global pull requests view reuses it as-is —
 * passing a Project-prefixed `columns` and an extra Project filter field. */
export function PullsView({
  repos,
  columns = PULL_COLUMNS,
  extraFields,
  toolbarAction
}: {
  repos: { owner: string; name: string }[]
  columns?: TableOptions<PullRequestRow>['columns']
  /** Extra filter fields appended to the defaults (e.g. Project in the global view). */
  extraFields?: FilterField<PullRequestRow>[]
  toolbarAction?: ReactNode
}): ReactElement {
  const { pulls, errors, isLoading, isError, errorMessage, isFetching, refetch } =
    useRepoPulls(repos)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ActiveFilter[]>([])
  // The input stays bound to `query` (instant feedback); filtering + rendering
  // run against the deferred value so a keystroke never blocks on the tables.
  const deferredQuery = useDeferredValue(query)

  const fields = useMemo(
    () => (extraFields ? [...PULL_FILTER_FIELDS, ...extraFields] : PULL_FILTER_FIELDS),
    [extraFields]
  )
  const compiled = useMemo(() => compileFilters(filters, fields), [filters, fields])
  const { addButton, badges } = useListFilters({
    fields,
    rows: pulls,
    value: filters,
    onChange: setFilters
  })

  const buckets = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()
    const assigned: PullRequestRow[] = []
    const review: PullRequestRow[] = []
    const other: PullRequestRow[] = []
    for (const pull of pulls) {
      if (compiled.length > 0 && !rowMatchesFilters(pull, compiled)) continue
      if (normalized && !pullMatches(pull, normalized)) continue
      if (pull.bucket === 'assigned') assigned.push(pull)
      else if (pull.bucket === 'review') review.push(pull)
      else other.push(pull)
    }
    return { assigned, review, other }
  }, [pulls, deferredQuery, compiled])

  const sections = [
    { title: 'Assigned to me', rows: buckets.assigned },
    { title: 'Needs my review', rows: buckets.review },
    { title: 'Other pull requests', rows: buckets.other }
  ]
  // While searching, hide empty buckets so the matches stand out.
  const isSearching = deferredQuery.trim().length > 0
  const visibleSections = isSearching
    ? sections.filter((section) => section.rows.length > 0)
    : sections

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <ListToolbar
          isFetching={isFetching}
          onRefresh={refetch}
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search pull requests…"
          filter={addButton}
          action={toolbarAction}
        />
        {badges}
      </div>
      <FailuresBanner failures={errors} />
      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage}
        loadingLabel="Loading pull requests…"
      >
        {isSearching && visibleSections.length === 0 ? (
          <EmptyHint>No pull requests match “{deferredQuery.trim()}”.</EmptyHint>
        ) : (
          <div className="flex flex-col gap-4">
            {visibleSections.map((section) => (
              <CollapsibleSection
                key={section.title}
                title={section.title}
                count={section.rows.length}
              >
                {section.rows.length === 0 ? (
                  <EmptyHint>No pull requests.</EmptyHint>
                ) : (
                  <DataTable rows={section.rows} columns={columns} />
                )}
              </CollapsibleSection>
            ))}
          </div>
        )}
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

  return (
    <PullsView
      repos={repos}
      toolbarAction={<CreateOnGitHubButton kind="pull" groups={[{ key: 'repos', repos }]} />}
    />
  )
}
