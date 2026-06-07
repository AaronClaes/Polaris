import {
  IconBug,
  IconCircleCheck,
  IconCircleDot,
  IconGitPullRequest,
  IconSparkles
} from '@tabler/icons-react'
import { createColumnHelper } from '@tanstack/react-table'
import { type ComponentType, type ReactElement, useMemo } from 'react'
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
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import type { IssueRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

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
 * marker: a green circle-dot. */
function IssueTypeIcon({ type }: { type: IssueRow['type'] }): ReactElement {
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
}

function LabelChips({ labels }: { labels: IssueRow['labels'] }): ReactElement | null {
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
}

const columnHelper = createColumnHelper<IssueRow>()

// Defined once and shared by every section's table — the column model is the
// seam for future sort / filter / show-hide controls.
const ISSUE_COLUMNS = [
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
      return <UserAvatars users={author ? [author] : []} />
    }
  }),
  columnHelper.accessor('assignees', {
    header: 'Assignees',
    meta: { width: '6rem' },
    cell: (cell) => <UserAvatars users={cell.getValue()} />
  }),
  columnHelper.accessor((row) => row.linkedPr, {
    id: 'pr',
    header: 'PR',
    meta: { width: '3.5rem' },
    cell: (cell) => {
      const pr = cell.getValue()
      if (!pr) return null
      return (
        <span
          className="inline-flex text-muted-foreground"
          title={`#${pr.number} (${pr.state.toLowerCase()})`}
        >
          <IconGitPullRequest className="size-4" />
        </span>
      )
    }
  }),
  columnHelper.display({
    id: 'open',
    meta: { width: '3.5rem' },
    cell: (cell) => <OpenButton url={cell.row.original.url} />
  })
]

/** The issues surface for a set of repos: a toolbar + the three assignment
 * sections. Repo-list-driven so a future global inbox can reuse it as-is. */
function IssuesView({ repos }: { repos: { owner: string; name: string }[] }): ReactElement {
  const issuesQuery = trpc.github.listIssues.useQuery(
    { repos },
    { enabled: repos.length > 0, staleTime: 60_000 }
  )

  const buckets = useMemo(() => {
    const mine: IssueRow[] = []
    const unassigned: IssueRow[] = []
    const others: IssueRow[] = []
    for (const issue of issuesQuery.data?.issues ?? []) {
      if (issue.bucket === 'mine') mine.push(issue)
      else if (issue.bucket === 'unassigned') unassigned.push(issue)
      else others.push(issue)
    }
    return { mine, unassigned, others }
  }, [issuesQuery.data])

  const sections = [
    { title: 'Assigned to me', rows: buckets.mine },
    { title: 'Unassigned', rows: buckets.unassigned },
    { title: 'Assigned to others', rows: buckets.others }
  ]

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        description="Open issues across this project's repositories."
        isFetching={issuesQuery.isFetching}
        onRefresh={() => issuesQuery.refetch()}
      />
      <FailuresBanner failures={issuesQuery.data?.errors ?? []} />
      <QueryBoundary
        isLoading={issuesQuery.isLoading}
        isError={issuesQuery.isError}
        errorMessage={issuesQuery.error?.message}
        loadingLabel="Loading issues…"
      >
        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <CollapsibleSection
              key={section.title}
              title={section.title}
              count={section.rows.length}
            >
              {section.rows.length === 0 ? (
                <EmptyHint>No issues.</EmptyHint>
              ) : (
                <DataTable rows={section.rows} columns={ISSUE_COLUMNS} />
              )}
            </CollapsibleSection>
          ))}
        </div>
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

  return <IssuesView repos={repos} />
}
