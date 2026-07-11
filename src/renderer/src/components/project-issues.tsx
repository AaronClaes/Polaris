import {
  IconBug,
  IconCircleCheck,
  IconCircleDot,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconSparkles
} from '@tabler/icons-react'
import { createColumnHelper, type TableOptions } from '@tanstack/react-table'
import {
  type ComponentType,
  memo,
  type ReactElement,
  type ReactNode,
  useDeferredValue,
  useMemo,
  useState
} from 'react'
import { CreateOnGitHubButton } from '@/components/create-on-github-button'
import {
  BranchLink,
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
import { ListSort } from '@/components/list-sort-bar'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { WorktreeGlyph } from '@/components/worktree-glyph'
import { useRepoIssues } from '@/lib/github-queries'
import {
  type ActiveFilter,
  compileFilters,
  type FilterField,
  ISSUE_FILTER_FIELDS,
  rowMatchesFilters
} from '@/lib/list-filters'
import { DEFAULT_SORT, type SortState, sortRows } from '@/lib/list-sort'
import type { IssueRow, ProjectWithActions } from '@/lib/project-types'
import { cn } from '@/lib/utils'

// GitHub's IssueTypeColor enum → a representative hex for the type icon.
const TYPE_COLORS: Record<string, string> = {
  BLUE: '#0969da',
  GRAY: '#59636e',
  GREEN: '#1a7f37',
  ORANGE: '#bc4c00',
  PINK: '#bf3989',
  PURPLE: '#8250df',
  RED: '#cf222e',
  YELLOW: '#9a6700'
}

// GitHub's built-in issue types (Task / Bug / Feature) → an icon. Custom org
// types fall back to a generic marker.
const TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  bug: IconBug,
  feature: IconSparkles,
  task: IconCircleCheck
}

/** The issue type as a colored icon, with a tooltip naming it (Task / Bug /
 * Feature / …). When no type is set, falls back to GitHub's standard open-issue
 * marker: a green circle-dot. Memoized so a search re-render skips unchanged rows. */
export const IssueTypeIcon = memo(function IssueTypeIcon({
  type
}: {
  type: IssueRow['type']
}): ReactElement {
  const Icon = type ? (TYPE_ICONS[type.name.toLowerCase()] ?? IconCircleDot) : IconCircleDot
  const color = type ? (TYPE_COLORS[type.color] ?? TYPE_COLORS.GRAY) : TYPE_COLORS.GREEN
  const label = type ? type.name : 'Issue'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0" style={{ color }}>
            <Icon className="size-4" />
          </span>
        }
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  )
})

const LabelChips = memo(function LabelChips({
  labels
}: {
  labels: IssueRow['labels']
}): ReactElement | null {
  if (labels.length === 0) return null
  const shown = labels.slice(0, 3)
  const extra = labels.length - shown.length
  return (
    <div className="flex items-center gap-1">
      {shown.map((label) => (
        <Badge key={label.name} variant="outline" size="sm" className="gap-1 font-normal">
          <span className="size-2 rounded-full" style={{ backgroundColor: `#${label.color}` }} />
          {label.name}
        </Badge>
      ))}
      {extra > 0 && <span className="text-muted-foreground text-xs">+{extra}</span>}
    </div>
  )
})

/** GitHub's PR state → its icon, a signalling color, and a readable label. A
 * linked PR is open (green), merged (purple), or closed without merging (red). */
const PR_STATE = {
  OPEN: { Icon: IconGitPullRequest, color: 'text-success-foreground', label: 'Open' },
  MERGED: { Icon: IconGitMerge, color: 'text-violet-600 dark:text-violet-400', label: 'Merged' },
  CLOSED: { Icon: IconGitPullRequestClosed, color: 'text-destructive-foreground', label: 'Closed' }
} as const

/** The linked-PR cell: a pull-request icon, colored by the PR's state, linking
 * to it on GitHub — with the number + state in a tooltip. */
const LinkedPrLink = memo(function LinkedPrLink({
  pr
}: {
  pr: NonNullable<IssueRow['linkedPr']>
}): ReactElement {
  const state = PR_STATE[pr.state.toUpperCase() as keyof typeof PR_STATE] ?? PR_STATE.OPEN
  const { Icon } = state
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Pull request #${pr.number} (${state.label}) — open on GitHub`}
            className={cn('inline-flex transition-opacity hover:opacity-70', state.color)}
          >
            <Icon className="size-4" />
          </a>
        }
      />
      <TooltipPopup>
        #{pr.number} · {state.label}
      </TooltipPopup>
    </Tooltip>
  )
})

/** One "Development" slot per issue. GitHub promotes a linked branch into a PR
 * the moment one is opened — the branch link is consumed, so the two never
 * coexist in the normal flow. We mirror that as a single column: the state-
 * colored PR icon once a PR exists, otherwise the neutral branch icon for a
 * branch that's been created but has no PR yet. The worktree glyph sits
 * alongside either — a local worktree on one of the linked branches is
 * orthogonal to how far the GitHub side has progressed. */
const DevelopmentCell = memo(function DevelopmentCell({
  pr,
  branches,
  repo,
  issue
}: {
  pr: IssueRow['linkedPr']
  branches: IssueRow['linkedBranches']
  repo: IssueRow['repo']
  // The row itself — a stable reference (unlike an inline `{ number, title }`,
  // which would defeat the memo), narrowed to what the create dialog needs.
  issue: Pick<IssueRow, 'number' | 'title'>
}): ReactElement | null {
  return (
    <div className="flex items-center gap-1.5">
      {pr ? <LinkedPrLink pr={pr} /> : branches.length > 0 && <BranchLink branches={branches} />}
      <WorktreeGlyph repo={repo} branches={branches} issue={issue} />
    </div>
  )
})

const columnHelper = createColumnHelper<IssueRow>()

// Defined once and shared by every section's table — the column model is the
// seam for future sort / filter / show-hide controls. Exported so the global
// issues view can prepend a Project column to it.
export const ISSUE_COLUMNS = [
  columnHelper.accessor('title', {
    header: 'Issue',
    cell: (cell) => (
      <TitleCell
        title={cell.getValue()}
        number={cell.row.original.number}
        owner={cell.row.original.repo.owner}
        name={cell.row.original.repo.name}
        leading={<IssueTypeIcon type={cell.row.original.type} />}
      />
    )
  }),
  columnHelper.accessor('labels', {
    header: 'Labels',
    meta: { width: '14rem' },
    cell: (cell) => <LabelChips labels={cell.getValue()} />
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
  columnHelper.display({
    id: 'dev',
    header: 'Dev',
    meta: { width: '3.5rem' },
    cell: (cell) => (
      <DevelopmentCell
        pr={cell.row.original.linkedPr}
        branches={cell.row.original.linkedBranches}
        repo={cell.row.original.repo}
        issue={cell.row.original}
      />
    )
  }),
  columnHelper.display({
    id: 'open',
    meta: { width: '3.5rem' },
    cell: (cell) => <OpenButton url={cell.row.original.url} />
  })
]

/** Case-insensitive substring match across an issue's user-visible fields, for
 * the client-side search box. `query` is expected already lower-cased. */
export function issueMatches(issue: IssueRow, query: string): boolean {
  return (
    issue.title.toLowerCase().includes(query) ||
    `#${issue.number}`.includes(query) ||
    `${issue.repo.owner}/${issue.repo.name}`.toLowerCase().includes(query) ||
    (issue.author?.login.toLowerCase().includes(query) ?? false) ||
    issue.assignees.some((person) => person.login.toLowerCase().includes(query)) ||
    issue.labels.some((label) => label.name.toLowerCase().includes(query)) ||
    issue.linkedBranches.some((branch) => branch.name.toLowerCase().includes(query)) ||
    (issue.type?.name.toLowerCase().includes(query) ?? false)
  )
}

/** The issues surface for a set of repos: a toolbar + the three assignment
 * sections. Repo-list-driven and parametrized so the global issues view reuses
 * it as-is — passing a Project-prefixed `columns` and an extra Project filter
 * field. */
export function IssuesView({
  repos,
  columns = ISSUE_COLUMNS,
  extraFields,
  toolbarAction
}: {
  repos: { owner: string; name: string }[]
  columns?: TableOptions<IssueRow>['columns']
  /** Extra filter fields appended to the defaults (e.g. Project in the global view). */
  extraFields?: FilterField<IssueRow>[]
  toolbarAction?: ReactNode
}): ReactElement {
  const { issues, errors, isLoading, isError, errorMessage } = useRepoIssues(repos)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ActiveFilter[]>([])
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  // The input stays bound to `query` (instant feedback); filtering + rendering
  // run against the deferred value so a keystroke never blocks on the tables.
  const deferredQuery = useDeferredValue(query)

  const fields = useMemo(
    () => (extraFields ? [...ISSUE_FILTER_FIELDS, ...extraFields] : ISSUE_FILTER_FIELDS),
    [extraFields]
  )
  const compiled = useMemo(() => compileFilters(filters, fields), [filters, fields])
  const { addButton, badges } = useListFilters({
    fields,
    rows: issues,
    value: filters,
    onChange: setFilters
  })

  const buckets = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()
    const mine: IssueRow[] = []
    const unassigned: IssueRow[] = []
    const others: IssueRow[] = []
    for (const issue of issues) {
      if (compiled.length > 0 && !rowMatchesFilters(issue, compiled)) continue
      if (normalized && !issueMatches(issue, normalized)) continue
      if (issue.bucket === 'mine') mine.push(issue)
      else if (issue.bucket === 'unassigned') unassigned.push(issue)
      else others.push(issue)
    }
    return {
      mine: sortRows(mine, sort),
      unassigned: sortRows(unassigned, sort),
      others: sortRows(others, sort)
    }
  }, [issues, deferredQuery, compiled, sort])

  const sections = [
    { title: 'Assigned to me', rows: buckets.mine },
    { title: 'Unassigned', rows: buckets.unassigned },
    { title: 'Assigned to others', rows: buckets.others }
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
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search issues…"
          filter={addButton}
          sort={<ListSort value={sort} onChange={setSort} />}
          action={toolbarAction}
        />
        {badges}
      </div>
      <FailuresBanner failures={errors} />
      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage}
        loadingLabel="Loading issues…"
      >
        {isSearching && visibleSections.length === 0 ? (
          <EmptyHint>No issues match “{deferredQuery.trim()}”.</EmptyHint>
        ) : (
          <div className="flex flex-col gap-4">
            {visibleSections.map((section) => (
              <CollapsibleSection
                key={section.title}
                title={section.title}
                count={section.rows.length}
              >
                {section.rows.length === 0 ? (
                  <EmptyHint>No issues.</EmptyHint>
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
 * The project's Issues tab: open issues for its linked repos, split into
 * assigned-to-me / unassigned / assigned-to-others. Needs at least one linked
 * repo — otherwise it points to the Settings tab.
 */
export function ProjectIssues({ project }: { project: ProjectWithActions }): ReactElement {
  const repos = useMemo(
    () => project.repos.map((repo) => ({ owner: repo.owner, name: repo.name })),
    [project.repos]
  )

  if (repos.length === 0) {
    return (
      <p className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
        Link a repository in the Settings tab to see its issues here.
      </p>
    )
  }

  return (
    <IssuesView
      repos={repos}
      toolbarAction={<CreateOnGitHubButton kind="issue" groups={[{ key: 'repos', repos }]} />}
    />
  )
}
