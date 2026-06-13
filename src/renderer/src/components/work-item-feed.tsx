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
import type { ReactElement } from 'react'
import { CollapsibleSection, OpenButton, UserAvatars } from '@/components/github-list'
import { ProjectIcon } from '@/components/project-icon'
import { IssueTypeIcon } from '@/components/project-issues'
import { formatDueDate } from '@/components/project-todos'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ProjectWithActions, PullRequestRow } from '@/lib/project-types'
import { formatRelative } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import type { Court, WorkItem, WorkItemStatus } from '@/lib/work-items'

/** A linked project, resolved for a work item from its repo or projectId. */
type Project = ProjectWithActions

/** The four courts in display order, with the section label and whether it
 * starts open. The two lower-priority courts start collapsed so the things that
 * need you stay front and center. */
export const COURTS: { court: Court; label: string; defaultOpen: boolean }[] = [
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

/** The status pill for a row. An overdue todo gets its own error "Overdue" pill
 * instead of the regular warning "Due", so a missed deadline reads as a problem. */
function statusBadge(item: WorkItem): { label: string; variant: BadgeProps['variant'] } {
  if (item.kind === 'todo' && item.due === 'overdue') {
    return { label: 'Overdue', variant: 'error' }
  }
  return STATUS_BADGE[item.status]
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

/** The muted second line: a time cue. A dated todo always reads "due " + the
 * same day(+time) phrasing as the todos list — "due Today, 5:00 PM", "due
 * Yesterday", "due Jun 15" — so you can see when it was (or is) due; an issue or
 * PR shows when it was last touched. */
function metaLabel(item: WorkItem): string {
  if (item.kind === 'todo') {
    return item.todo.dueDate ? `due ${formatDueDate(item.todo.dueDate)}` : ''
  }
  const iso = item.kind === 'pr' ? item.pr.updatedAt : item.issue.updatedAt
  return `updated ${formatRelative(iso)}`
}

/** The due cue's colour: red once a todo is overdue, amber when it's due today,
 * otherwise inherited (muted). Only todos carry a due tone. */
function dueToneClass(item: WorkItem): string | undefined {
  if (item.kind !== 'todo') return undefined
  if (item.due === 'overdue') return 'text-destructive-foreground'
  if (item.due === 'today') return 'text-warning-foreground'
  return undefined
}

/** The leading glyph for an issue or PR. Anything with an issue (a standalone
 * issue or a fused PR) shows that issue's type — Bug / Feature / Task — so the
 * kind of work reads at a glance; a bare PR shows the PR glyph. (Todos use the
 * checkable control below instead.) */
function KindIcon({ item }: { item: WorkItem }): ReactElement {
  if (item.kind === 'issue') return <IssueTypeIcon type={item.issue.type} />
  if (item.kind === 'pr' && item.issue) return <IssueTypeIcon type={item.issue.type} />
  const Icon = item.kind === 'pr' ? IconGitPullRequest : IconCircle
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}

/** A todo's leading control: an open circle that turns into a check on hover, so
 * the todo can be ticked off straight from the feed. The feed only lists open
 * todos, so this only ever completes — a checked one drops off the list. */
function TodoCompleteButton({ onComplete }: { onComplete: () => void }): ReactElement {
  return (
    <button
      type="button"
      aria-label="Mark as done"
      title="Mark as done"
      onClick={onComplete}
      className="group/todo flex shrink-0 text-muted-foreground transition-colors hover:text-success-foreground"
    >
      <IconCircle className="size-4 group-hover/todo:hidden" />
      <IconCircleCheck className="hidden size-4 group-hover/todo:block" />
    </button>
  )
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
 * jump to the project's Todos tab for a todo. The project chip is shown only when
 * a `project` is given; the scoped project Home tab omits it (every row is the
 * same project), so the time cue then stands alone. */
function WorkItemRow({
  item,
  project,
  onCompleteTodo
}: {
  item: WorkItem
  project: Project | undefined
  onCompleteTodo: (id: number) => void
}): ReactElement {
  const number = itemNumber(item)
  const badge = statusBadge(item)

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {item.kind === 'todo' ? (
        <TodoCompleteButton onComplete={() => onCompleteTodo(item.todo.id)} />
      ) : (
        <KindIcon item={item} />
      )}
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
          {metaLabel(item) && (
            <span className={cn('shrink-0', dueToneClass(item))}>
              {project && '· '}
              {metaLabel(item)}
            </span>
          )}
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
      {item.kind !== 'todo' ? (
        <OpenButton url={item.kind === 'pr' ? item.pr.url : item.issue.url} />
      ) : item.todo.projectId != null ? (
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
        // An unlinked todo lives only in the global Todos list.
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open in todos"
          title="Open in todos"
          render={<Link to="/todos" />}
        >
          <IconChevronRight />
        </Button>
      )}
    </div>
  )
}

/** The shared "what needs me" feed: issues, PRs and todos already fused and
 * ranked by the work-item engine, grouped into Needs you / In progress / Waiting
 * / Up next. The caller owns the loading/error wrapper and data plumbing; this
 * renders the courts (or the caught-up empty state). `itemProject` resolves the
 * per-row project chip — return undefined to omit it (the scoped Home tab does,
 * since every row is the same project). */
export function WorkItemFeed({
  groups,
  itemProject,
  onCompleteTodo
}: {
  groups: Record<Court, WorkItem[]>
  itemProject: (item: WorkItem) => Project | undefined
  onCompleteTodo: (id: number) => void
}): ReactElement {
  const total = COURTS.reduce((sum, { court }) => sum + groups[court].length, 0)

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border border-dashed px-4 py-12 text-center">
        <IconCircleCheck className="size-6 text-muted-foreground" />
        <p className="font-medium text-sm">You're all caught up</p>
        <p className="text-muted-foreground text-sm">
          No pull requests, issues or todos need your attention right now.
        </p>
      </div>
    )
  }

  return (
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
                <WorkItemRow
                  key={item.key}
                  item={item}
                  project={itemProject(item)}
                  onCompleteTodo={onCompleteTodo}
                />
              ))}
            </div>
          </CollapsibleSection>
        )
      })}
    </div>
  )
}
