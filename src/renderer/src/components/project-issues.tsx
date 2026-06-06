import {
  IconChevronDown,
  IconExternalLink,
  IconGitPullRequest,
  IconRefresh
} from '@tabler/icons-react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable
} from '@tanstack/react-table'
import { type ReactElement, useMemo, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import type { IssueRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

// GitHub's IssueTypeColor enum → a representative hex for the badge dot.
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

function AssigneeAvatars({ assignees }: { assignees: IssueRow['assignees'] }): ReactElement | null {
  if (assignees.length === 0) return null
  const shown = assignees.slice(0, 3)
  const extra = assignees.length - shown.length
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((person) => (
        <Avatar key={person.login} className="size-6 ring-2 ring-background" title={person.login}>
          <AvatarImage src={person.avatarUrl} alt={person.login} />
          <AvatarFallback>{person.login.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && <span className="pl-2.5 text-muted-foreground text-xs">+{extra}</span>}
    </div>
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
    header: 'Title',
    cell: (cell) => (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="max-w-md truncate font-medium">{cell.getValue()}</span>
          <span className="shrink-0 text-muted-foreground text-xs">
            #{cell.row.original.number}
          </span>
        </div>
        <span className="truncate text-muted-foreground text-xs">
          {cell.row.original.repo.owner}/{cell.row.original.repo.name}
        </span>
      </div>
    )
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    cell: (cell) => {
      const type = cell.getValue()
      if (!type) return null
      return (
        <Badge variant="outline" size="sm" className="gap-1 font-normal">
          <span
            className="size-2 rounded-full"
            style={{
              backgroundColor: TYPE_COLORS[type.color] ?? TYPE_COLORS.GRAY
            }}
          />
          {type.name}
        </Badge>
      )
    }
  }),
  columnHelper.accessor('labels', {
    header: 'Labels',
    cell: (cell) => <LabelChips labels={cell.getValue()} />
  }),
  columnHelper.accessor((row) => row.linkedPr, {
    id: 'pr',
    header: 'PR',
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
  columnHelper.accessor('assignees', {
    header: 'Assignees',
    cell: (cell) => <AssigneeAvatars assignees={cell.getValue()} />
  }),
  columnHelper.display({
    id: 'open',
    cell: (cell) => (
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open on GitHub"
          title="Open on GitHub"
          onClick={() => window.open(cell.row.original.url, '_blank')}
        >
          <IconExternalLink />
        </Button>
      </div>
    )
  })
]

/** One section's table. Each section is its own table instance so it can sort
 * and filter independently once those controls land. */
function IssuesTable({ rows }: { rows: IssueRow[] }): ReactElement {
  const table = useReactTable({
    data: rows,
    columns: ISSUE_COLUMNS,
    getCoreRowModel: getCoreRowModel()
  })

  return (
    <Table>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** A collapsible, titled section wrapping one bucket's table (or an empty hint). */
function IssuesSection({ title, rows }: { title: string; rows: IssueRow[] }): ReactElement {
  const [open, setOpen] = useState(true)

  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50',
          open && 'border-border border-b'
        )}
      >
        <IconChevronDown
          className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')}
        />
        <span className="font-medium text-sm">{title}</span>
        <span className="text-muted-foreground text-xs">{rows.length}</span>
      </button>
      {open &&
        (rows.length === 0 ? (
          <p className="px-3 py-4 text-center text-muted-foreground text-xs">No issues.</p>
        ) : (
          <IssuesTable rows={rows} />
        ))}
    </section>
  )
}

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

  const failures = issuesQuery.data?.errors ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Open issues across this project's repositories.
        </p>
        <Button
          variant="ghost"
          size="sm"
          loading={issuesQuery.isFetching}
          onClick={() => issuesQuery.refetch()}
        >
          <IconRefresh />
          Refresh
        </Button>
      </div>

      {failures.length > 0 && (
        <div className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-xs">
          {failures.map((failure) => (
            <p key={failure.repo}>
              <span className="font-medium">{failure.repo}</span>: {failure.message}
            </p>
          ))}
        </div>
      )}

      {issuesQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Loading issues…
        </div>
      ) : issuesQuery.isError ? (
        <p className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-sm">
          Couldn't load issues. {issuesQuery.error.message}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <IssuesSection title="Assigned to me" rows={buckets.mine} />
          <IssuesSection title="Unassigned" rows={buckets.unassigned} />
          <IssuesSection title="Assigned to others" rows={buckets.others} />
        </div>
      )}
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
