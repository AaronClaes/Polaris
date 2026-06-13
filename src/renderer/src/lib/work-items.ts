import type { IssueRow, PullRequestRow } from '@/lib/project-types'

/**
 * The WorkItem engine: turns the already-cached issues, pull requests and todos
 * for a scope into one ranked stream of "things I'm working on / that need me".
 *
 * It's a pure function of its inputs — no fetching, no `Date.now()` baked in (the
 * caller passes `now`) — and scope-agnostic: feed it the union of every repo's
 * rows for the global dashboard, or one project's rows for a per-project Home
 * dashboard later. The classification (which court, which status) lives here so
 * both surfaces stay identical; presentation (labels, icons) lives in the UI.
 */

/** Whose court the work is in — the dashboard's top-level grouping. */
export type Court = 'act' | 'flight' | 'waiting' | 'next'

/** The specific situation within a court. */
export type WorkItemStatus =
  | 'review-requested'
  | 'needs-work'
  | 'ready-to-merge'
  | 'due'
  | 'in-progress'
  | 'draft'
  | 'awaiting-review'
  | 'ci-running'
  | 'in-review-elsewhere'
  | 'to-do'
  | 'todo'
  | 'unreplied'

/** Why a "needs-work" PR needs work — several can apply at once. */
export type NeedsWorkReason = 'conflict' | 'ci-failed' | 'changes-requested'

/** The minimal todo shape the engine reads. Both `TodoRow` (a project's todos)
 * and `GlobalTodoRow` (the cross-project list) structurally satisfy it, so the
 * same engine serves the global and per-project dashboards unchanged. */
export interface WorkTodo {
  id: number
  /** Null for an unlinked todo (no owning project). */
  projectId: number | null
  title: string
  dueDate: Date | null
  completed: boolean
  createdAt: Date
}

/** The minimal email-thread shape the engine reads. `EmailThreadRow` from the
 * gmail router structurally satisfies it. Already filtered to "needs a reply" by
 * the router (latest message isn't yours, not dismissed), so the engine just
 * places it — no completion check, unlike todos. */
export interface WorkEmail {
  /** Gmail thread id. */
  id: string
  /** The linked Google account (mailbox) the thread belongs to. */
  account: string
  subject: string
  /** Null when no originating participant maps to a project (dashboard-only). */
  projectId: number | null
  /** Epoch ms of the latest message — what it sorts on, and the dismissal watermark. */
  lastMessageAt: number
  participants: { name: string; email: string }[]
  url: string
}

interface WorkItemCommon {
  /** Stable React key, unique across kinds. */
  key: string
  court: Court
  status: WorkItemStatus
  /** Lower sorts first within a court (see `compareWithin`). */
  tier: number
  /** Epoch ms of the timestamp this item sorts on within its court. */
  sortMs: number
}

/** One piece of work. A `pr` item carries its issue too when the two are fused
 * (the PR drives the status, the issue is context); a `todo` carries how overdue
 * it is when it lands in the "Act now" court. */
export type WorkItem =
  | (WorkItemCommon & {
      kind: 'pr'
      pr: PullRequestRow
      /** Set when this PR closes one of your issues (fused). */
      issue: IssueRow | null
      reasons: NeedsWorkReason[]
    })
  | (WorkItemCommon & {
      kind: 'issue'
      issue: IssueRow
    })
  | (WorkItemCommon & {
      kind: 'todo'
      todo: WorkTodo
      /** Only set for a 'due' (Act now) item. */
      due: 'overdue' | 'today' | null
    })
  | (WorkItemCommon & {
      kind: 'email'
      email: WorkEmail
    })

const COURT_ORDER: Record<Court, number> = { act: 0, flight: 1, waiting: 2, next: 3 }

/** ISO strings (GitHub) and `Date`s (todos) both reduce to epoch ms. */
function toMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function startOfDay(date: Date): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function endOfDay(date: Date): number {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** A due date carries an explicit time when its local clock isn't midnight. A
 * date-only todo (picked without a time) stays at 00:00 and is treated as an
 * end-of-day deadline — the convention the whole app shares, so one timestamp
 * can mean either "this day" or "this exact moment" without a separate flag. */
export function hasTime(date: Date): boolean {
  return date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0
}

/** The real deadline instant for a due date: the set time when there is one,
 * otherwise the end of that calendar day. */
export function deadlineOf(dueDate: Date): number {
  return hasTime(dueDate) ? dueDate.getTime() : endOfDay(dueDate)
}

type PullClass = Pick<WorkItemCommon, 'court' | 'status' | 'tier'> & { reasons: NeedsWorkReason[] }

/**
 * Derive a pull request's court + status from its signals. Only called for PRs
 * that are mine (`bucket: 'assigned'`) or awaiting my review (`'review'`) —
 * `'other'` PRs are either skipped or handled as "in review elsewhere" by the
 * fusion pass, never routed here.
 *
 * Precedence: Needs work ▸ Ready to merge ▸ Draft ▸ (no reviewer → In progress) ▸
 * CI running ▸ Awaiting review. A PR with no review requested isn't blocked on
 * anyone, so it stays in flight rather than Waiting. `mergeable: 'UNKNOWN'`
 * (GitHub hasn't computed it yet) is treated as not-conflicting; it resolves on
 * the next refresh.
 */
function classifyPull(pr: PullRequestRow): PullClass {
  if (pr.bucket === 'review') {
    return { court: 'act', status: 'review-requested', tier: 1, reasons: [] }
  }

  const reasons: NeedsWorkReason[] = []
  if (pr.mergeable === 'CONFLICTING') reasons.push('conflict')
  if (pr.checks?.state === 'failed') reasons.push('ci-failed')
  if (pr.reviewSummary.changesRequested > 0) reasons.push('changes-requested')
  if (reasons.length > 0) return { court: 'act', status: 'needs-work', tier: 0, reasons }

  if (pr.reviewSummary.approved > 0 && !pr.isDraft) {
    return { court: 'act', status: 'ready-to-merge', tier: 2, reasons: [] }
  }
  if (pr.isDraft) return { court: 'flight', status: 'draft', tier: 0, reasons: [] }

  // No review requested yet → not handed off, so it's still mine and in flight.
  if (pr.reviewers.length === 0) {
    return { court: 'flight', status: 'in-progress', tier: 0, reasons: [] }
  }

  // Handed off for review: waiting on CI, then on the requested reviewers.
  if (pr.checks?.state === 'running') {
    return { court: 'waiting', status: 'ci-running', tier: 0, reasons: [] }
  }
  return { court: 'waiting', status: 'awaiting-review', tier: 0, reasons: [] }
}

function makePrItem(pr: PullRequestRow, issue: IssueRow | null, cls: PullClass): WorkItem {
  return {
    kind: 'pr',
    key: `pr:${pr.id}`,
    pr,
    issue,
    reasons: cls.reasons,
    court: cls.court,
    status: cls.status,
    tier: cls.tier,
    sortMs: toMs(pr.updatedAt)
  }
}

function makeIssueItem(issue: IssueRow): WorkItem {
  // A linked branch with no PR yet is the strongest "actively working" signal;
  // otherwise it's a not-yet-started task in the queue. `?.` guards a snapshot
  // persisted before `linkedBranches` existed — see CACHE_BUSTER in main.tsx.
  const inProgress = (issue.linkedBranches?.length ?? 0) > 0
  return {
    kind: 'issue',
    key: `issue:${issue.id}`,
    issue,
    court: inProgress ? 'flight' : 'next',
    status: inProgress ? 'in-progress' : 'to-do',
    tier: inProgress ? 0 : 1,
    sortMs: toMs(issue.updatedAt)
  }
}

function makeTodoItem(todo: WorkTodo, now: Date): WorkItem {
  const key = `todo:${todo.id}`

  // Undated todos sit at the back of "up next", newest first.
  if (!todo.dueDate) {
    return {
      kind: 'todo',
      key,
      todo,
      due: null,
      court: 'next',
      status: 'todo',
      tier: 1,
      sortMs: toMs(todo.createdAt)
    }
  }

  // "Due / overdue" is a calendar-day judgement — a todo due tomorrow isn't
  // urgent at 11pm tonight — but the sort and the overdue refinement use the
  // real deadline: the set time, or the end of the day when none was given.
  const dueDay = startOfDay(todo.dueDate)
  const today = startOfDay(now)
  const deadlineMs = deadlineOf(todo.dueDate)

  // Due today or already past → it needs attention now.
  if (dueDay <= today) {
    // A timed todo whose moment has already passed today is overdue, not "due".
    const overdue = dueDay < today || (hasTime(todo.dueDate) && deadlineMs < now.getTime())
    return {
      kind: 'todo',
      key,
      todo,
      due: overdue ? 'overdue' : 'today',
      court: 'act',
      status: 'due',
      tier: 3,
      sortMs: deadlineMs
    }
  }

  // Otherwise it's up next, ahead of the undated todos, soonest deadline first.
  return {
    kind: 'todo',
    key,
    todo,
    due: null,
    court: 'next',
    status: 'todo',
    tier: 0,
    sortMs: deadlineMs
  }
}

/** An unreplied client email lands in "Needs you", sorted by its latest message.
 * That court ranks purely by recency (see `compareWithin`), so `tier` doesn't
 * affect its position here — `sortMs` (the last message) does all the ordering. */
function makeEmailItem(email: WorkEmail): WorkItem {
  return {
    kind: 'email',
    key: `email:${email.account}:${email.id}`,
    email,
    court: 'act',
    status: 'unreplied',
    tier: 0,
    sortMs: email.lastMessageAt
  }
}

/** Order two items already known to share a court.
 * "Needs you" (act) sorts purely by most-recent activity, regardless of kind — a
 * freshly-active email or PR rises above a stale one, so a 2-day email no longer
 * hides under a 2-month PR. The other courts rank by tier first, then a time
 * tiebreak: newest-first for In flight and Waiting (latest movement up top), and
 * oldest-first only for dated items Up next, so the soonest deadline surfaces. */
function compareWithin(court: Court, a: WorkItem, b: WorkItem): number {
  if (court === 'act') return b.sortMs - a.sortMs
  if (a.tier !== b.tier) return a.tier - b.tier
  const oldestFirst = court === 'next' && a.tier === 0
  return oldestFirst ? a.sortMs - b.sortMs : b.sortMs - a.sortMs
}

/**
 * Build the ranked work-item stream for a scope.
 *
 * Fusion: a mine issue whose open `linkedPr` is present in `pulls` becomes one
 * item driven by that PR (we fetch every open PR per repo, so an open linked PR
 * is always in-set). When that PR is someone else's (`bucket: 'other'`) the work
 * has left your hands → "in review elsewhere". The standalone issue and PR are
 * both suppressed, so nothing double-counts.
 */
export function buildWorkItems(input: {
  issues: IssueRow[]
  pulls: PullRequestRow[]
  todos: WorkTodo[]
  emails: WorkEmail[]
  now: Date
}): WorkItem[] {
  const { issues, pulls, todos, emails, now } = input
  const items: WorkItem[] = []

  // PRs indexed by id (`owner/name#number`) for the issue-side fusion lookup.
  const prById = new Map<string, PullRequestRow>()
  for (const pr of pulls) prById.set(pr.id, pr)
  const fusedPrIds = new Set<string>()

  // Pass 1 — my issues. Fuse with an open linked PR when there is one.
  for (const issue of issues) {
    if (issue.bucket !== 'mine') continue
    const linkedId = issue.linkedPr
      ? `${issue.repo.owner}/${issue.repo.name}#${issue.linkedPr.number}`
      : null
    const pr = linkedId ? prById.get(linkedId) : undefined
    if (pr) {
      fusedPrIds.add(pr.id)
      items.push(
        pr.bucket === 'other'
          ? makePrItem(pr, issue, {
              court: 'waiting',
              status: 'in-review-elsewhere',
              tier: 0,
              reasons: []
            })
          : makePrItem(pr, issue, classifyPull(pr))
      )
      continue
    }
    items.push(makeIssueItem(issue))
  }

  // Pass 2 — PRs that are mine or awaiting my review and weren't fused above.
  for (const pr of pulls) {
    if (fusedPrIds.has(pr.id) || pr.bucket === 'other') continue
    items.push(makePrItem(pr, null, classifyPull(pr)))
  }

  // Pass 3 — open todos.
  for (const todo of todos) {
    if (!todo.completed) items.push(makeTodoItem(todo, now))
  }

  // Pass 4 — emails that need a reply (already filtered by the router).
  for (const email of emails) items.push(makeEmailItem(email))

  return items.sort((a, b) => {
    const byCourt = COURT_ORDER[a.court] - COURT_ORDER[b.court]
    return byCourt !== 0 ? byCourt : compareWithin(a.court, a, b)
  })
}

/** Split a ranked stream into its four courts, each preserving the stream order.
 * Empty courts are still present, so the UI can decide how to render each. */
export function groupByCourt(items: WorkItem[]): Record<Court, WorkItem[]> {
  const groups: Record<Court, WorkItem[]> = { act: [], flight: [], waiting: [], next: [] }
  for (const item of items) groups[item.court].push(item)
  return groups
}
