import {
  IconCircleDot,
  IconGitPullRequest,
  IconListCheck,
  type TablerIcon
} from '@tabler/icons-react'
import { type ReactElement, type ReactNode, useMemo } from 'react'
import { GlobalListPage } from '@/components/global-views'
import { ProjectIcon } from '@/components/project-icon'
import type { IssueRow, PullRequestRow } from '@/lib/project-types'
import { useVisibleArchive, useVisibleProjects, useVisibleTodos } from '@/lib/use-visible-projects'
import { cn } from '@/lib/utils'

/** The display bits of a project, for a row's chip. */
type ProjectRef = { id: number; name: string; icon: string; color: string }

/** One finished thing in the timeline — a closed issue, a merged/closed PR (with
 * the issue it closed, when the two fuse), or a completed todo. */
interface ArchiveEntry {
  key: string
  kind: 'issue' | 'pr' | 'todo'
  title: string
  // GitHub URL for an issue/PR (opened externally); null for a todo.
  url: string | null
  // Epoch ms it was finished — `closedAt` for GitHub, `completedAt` for a todo.
  completedMs: number
  project: ProjectRef | null
  // The issue a fused PR closed, for the "closes #N" suffix.
  closesIssue: number | null
}

interface DayGroup {
  dayMs: number
  label: string
  entries: ArchiveEntry[]
}

interface MonthGroup {
  key: string
  label: string
  days: DayGroup[]
}

const KIND_ICON: Record<ArchiveEntry['kind'], TablerIcon> = {
  issue: IconCircleDot,
  pr: IconGitPullRequest,
  todo: IconListCheck
}

function startOfDayMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd", … */
function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** "Today" / "Yesterday" for the recent days, else "18th - Thursday" (the month
 * and year already live in the month header above). */
function dayLabel(dayMs: number, todayMs: number): string {
  const diffDays = Math.round((todayMs - dayMs) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const date = new Date(dayMs)
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' })
  return `${ordinal(date.getDate())} - ${weekday}`
}

/**
 * One row on a month's rail. The vertical line sits behind the marker and runs
 * the full row height, so consecutive rows (days and the items under them) read
 * as a single continuous line. Markers are vertically centred, so the line joins
 * them at the row mid-point; it's capped there on the month's first and last rows
 * so it doesn't dangle past either end.
 */
function TimelineRow({
  marker,
  isFirst,
  isLast,
  spacious = false,
  children
}: {
  marker: ReactNode
  isFirst: boolean
  isLast: boolean
  // Day rows get more room above/below than item rows.
  spacious?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <li className={cn('relative flex items-center gap-3', spacious ? 'py-4' : 'py-2')}>
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-3.5 z-0 w-px bg-border',
          isFirst && isLast
            ? 'hidden'
            : isFirst
              ? 'top-1/2 bottom-0'
              : isLast
                ? 'top-0 bottom-1/2'
                : 'top-0 bottom-0'
        )}
      />
      <span className="relative z-10 flex w-7 shrink-0 justify-center">{marker}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">{children}</div>
    </li>
  )
}

/** A day heading on the rail: a muted dot, a bit larger than the item markers,
 * with a muted label. */
function DayMarker({
  label,
  isFirst,
  isLast
}: {
  label: string
  isFirst: boolean
  isLast: boolean
}): ReactElement {
  return (
    <TimelineRow
      isFirst={isFirst}
      isLast={isLast}
      spacious
      marker={<span className="size-4 rounded-full bg-muted-foreground" />}
    >
      <span className="shrink-0 font-medium text-muted-foreground text-sm">{label}</span>
      {/* A rule running out to the edge sets the day's items apart from the one above. */}
      <span className="h-px flex-1 bg-border" />
    </TimelineRow>
  )
}

/** A completed item on the rail, its kind shown by the icon in its badge. GitHub
 * items open on github.com; todos are plain text (there's no direct todo target). */
function ArchiveRow({
  entry,
  isFirst,
  isLast
}: {
  entry: ArchiveEntry
  isFirst: boolean
  isLast: boolean
}): ReactElement {
  const Icon = KIND_ICON[entry.kind]
  const time = new Date(entry.completedMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })

  const titleContent = (
    <>
      <span className="truncate">{entry.title}</span>
      {entry.closesIssue != null && (
        <span className="shrink-0 text-muted-foreground text-xs">closes #{entry.closesIssue}</span>
      )}
    </>
  )

  return (
    <TimelineRow
      isFirst={isFirst}
      isLast={isLast}
      marker={
        <span className="flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
          <Icon className="size-4" />
        </span>
      }
    >
      {entry.url ? (
        <button
          type="button"
          onClick={() => window.open(entry.url as string, '_blank')}
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 text-left text-sm hover:underline"
        >
          {titleContent}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">{titleContent}</span>
      )}
      {entry.project && (
        <span className="flex max-w-44 shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
          <ProjectIcon
            icon={entry.project.icon}
            color={entry.project.color}
            size={12}
            className="size-4 shrink-0"
          />
          <span className="truncate">{entry.project.name}</span>
        </span>
      )}
      <span className="shrink-0 tabular-nums text-muted-foreground text-xs">{time}</span>
    </TimelineRow>
  )
}

/**
 * The Archive: a reverse-chronological timeline of finished work — closed issues,
 * merged/closed pull requests, and completed todos. Reads the lifecycle store
 * (`trackedItems.archive`) plus completed todos, both filtered to the visible
 * projects under the tag filter, and lays them out as one continuous rail per
 * month with a dot for each day and a smaller dot for each completed item.
 *
 * Scope mirrors the dashboard's ownership model: only issues assigned to you
 * (`bucket: 'mine'`) and PRs you own (`bucket: 'assigned'`) count as "yours", and
 * an issue is fused with the PR that closed it so the pair shows once — just like
 * the dashboard Tasks feed. (Review-requested PRs and unassigned issues are
 * someone else's work, so they're left out.)
 */
export function Archive(): ReactElement {
  const archiveQuery = useVisibleArchive()
  const todosQuery = useVisibleTodos()
  const projectsQuery = useVisibleProjects()

  const projectById = useMemo(() => {
    const map = new Map<number, ProjectRef>()
    for (const p of projectsQuery.data ?? []) {
      map.set(p.id, { id: p.id, name: p.name, icon: p.icon, color: p.color })
    }
    return map
  }, [projectsQuery.data])

  const entries = useMemo<ArchiveEntry[]>(() => {
    const list: ArchiveEntry[] = []
    const items = archiveQuery.data ?? []

    // "My work" only — assigned issues + my own PRs (see the component doc).
    const issues = items.filter(
      (it) => it.kind === 'issue' && (it.payload as IssueRow).bucket === 'mine'
    )
    const prs = items.filter(
      (it) => it.kind === 'pr' && (it.payload as PullRequestRow).bucket === 'assigned'
    )

    const prByKey = new Map<string, (typeof prs)[number]>()
    for (const pr of prs) prByKey.set((pr.payload as PullRequestRow).id, pr)
    const fusedPrIds = new Set<string>()

    const projectOf = (projectId: number | null): ProjectRef | null =>
      projectId != null ? (projectById.get(projectId) ?? null) : null

    for (const it of issues) {
      if (!it.closedAt) continue
      const issue = it.payload as IssueRow
      // Fuse with the PR that closed it (when that PR is also a finished one of
      // yours) — the PR drives the row, the issue becomes a "closes #N" note. The
      // merge/close of the PR is the moment the work finished, so sort on its time.
      const linkedKey = issue.linkedPr
        ? `${issue.repo.owner}/${issue.repo.name}#${issue.linkedPr.number}`
        : null
      const pr = linkedKey ? prByKey.get(linkedKey) : undefined
      if (pr?.closedAt) {
        const prPayload = pr.payload as PullRequestRow
        fusedPrIds.add(prPayload.id)
        list.push({
          key: `pr:${prPayload.id}`,
          kind: 'pr',
          title: prPayload.title,
          url: prPayload.url,
          completedMs: pr.closedAt.getTime(),
          project: projectOf(it.projectId),
          closesIssue: issue.number
        })
        continue
      }
      list.push({
        key: `issue:${issue.id}`,
        kind: 'issue',
        title: issue.title,
        url: issue.url,
        completedMs: it.closedAt.getTime(),
        project: projectOf(it.projectId),
        closesIssue: null
      })
    }

    for (const pr of prs) {
      const prPayload = pr.payload as PullRequestRow
      if (fusedPrIds.has(prPayload.id) || !pr.closedAt) continue
      list.push({
        key: `pr:${prPayload.id}`,
        kind: 'pr',
        title: prPayload.title,
        url: prPayload.url,
        completedMs: pr.closedAt.getTime(),
        project: projectOf(pr.projectId),
        closesIssue: null
      })
    }

    for (const todo of todosQuery.data ?? []) {
      if (!todo.completed) continue
      // `completedAt` is stamped on completion; fall back to `updatedAt` for any
      // todo completed before that column existed.
      const completedMs = (todo.completedAt ?? todo.updatedAt).getTime()
      list.push({
        key: `todo:${todo.id}`,
        kind: 'todo',
        title: todo.title || 'Untitled todo',
        url: null,
        completedMs,
        project: projectOf(todo.projectId),
        closesIssue: null
      })
    }

    return list.sort((a, b) => b.completedMs - a.completedMs)
  }, [archiveQuery.data, todosQuery.data, projectById])

  // Group the flat, already-sorted stream into months → days → items.
  const months = useMemo<MonthGroup[]>(() => {
    const todayMs = startOfDayMs(Date.now())
    const out: MonthGroup[] = []
    for (const entry of entries) {
      const date = new Date(entry.completedMs)
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`
      let month = out[out.length - 1]
      if (!month || month.key !== monthKey) {
        month = { key: monthKey, label: monthLabel(date), days: [] }
        out.push(month)
      }
      const dayMs = startOfDayMs(entry.completedMs)
      let day = month.days[month.days.length - 1]
      if (!day || day.dayMs !== dayMs) {
        day = { dayMs, label: dayLabel(dayMs, todayMs), entries: [] }
        month.days.push(day)
      }
      day.entries.push(entry)
    }
    return out
  }, [entries])

  const loading = archiveQuery.isLoading || todosQuery.isLoading

  return (
    <GlobalListPage
      title="Archive"
      subtitle="Issues, pull requests and todos you've completed, newest first."
      count={loading ? undefined : entries.length}
      // Stay on the content side while loading so the empty hint doesn't flash.
      hasContent={loading || entries.length > 0}
      emptyHint="Nothing archived yet. Completed issues, pull requests and todos collect here as you finish them."
    >
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <div className="flex flex-col gap-9">
          {months.map((month) => {
            // Flatten the month into one rail: a day marker followed by its items.
            // The line is continuous, so first/last are tracked across the whole
            // month to cap its two ends.
            const rowCount = month.days.reduce((n, day) => n + 1 + day.entries.length, 0)
            let row = -1
            return (
              <section key={month.key} className="flex flex-col gap-4">
                <h2 className="font-heading font-semibold text-foreground text-lg tracking-tight">
                  {month.label}
                </h2>
                <ul className="flex flex-col">
                  {month.days.map((day) => {
                    row += 1
                    const dayMarker = (
                      <DayMarker
                        key={`day:${day.dayMs}`}
                        label={day.label}
                        isFirst={row === 0}
                        isLast={row === rowCount - 1}
                      />
                    )
                    const itemRows = day.entries.map((entry) => {
                      row += 1
                      return (
                        <ArchiveRow
                          key={entry.key}
                          entry={entry}
                          isFirst={false}
                          isLast={row === rowCount - 1}
                        />
                      )
                    })
                    return [dayMarker, ...itemRows]
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </GlobalListPage>
  )
}
