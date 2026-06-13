import { IconCalendar, IconExternalLink, IconVideo } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { EmptyHint, FailuresBanner, UserAvatars } from '@/components/github-list'
import { Button } from '@/components/ui/button'
import type { CalendarEventRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

// Poll so a meeting added mid-day shows up without a manual refresh (react-query
// also refetches on window focus by default).
const AGENDA_REFETCH_MS = 5 * 60 * 1000

function eventKey(event: CalendarEventRow): string {
  return `${event.account}:${event.id}`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "All day", or a start–end range with a shared AM/PM written once
 *  ("2:30–3:00 PM"). In a 24-hour locale there's no meridiem, so it reads
 *  "14:30–15:00" — the trim is a no-op. */
function formatRange(event: CalendarEventRow): string {
  if (event.allDay) return 'All day'
  const start = formatTime(event.start)
  const end = formatTime(event.end)
  const sameMeridiem = event.start.getHours() < 12 === event.end.getHours() < 12
  const startTrimmed = sameMeridiem ? start.replace(/\s?[AP]M$/i, '') : start
  return `${startTrimmed}–${end}`
}

function formatDayDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

interface DayGroup {
  label: string
  date: string
  events: CalendarEventRow[]
}

/** Split the merged events into Today / Tomorrow, dropping a day with nothing on
 *  it (the window is exactly those two days). Within a day, timed events come
 *  first (in start order) and all-day events sit at the bottom. */
function groupByDay(events: CalendarEventRow[], now: Date): DayGroup[] {
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const today: DayGroup = { label: 'Today', date: formatDayDate(todayDate), events: [] }
  const tomorrow: DayGroup = { label: 'Tomorrow', date: formatDayDate(tomorrowDate), events: [] }
  for (const event of events) {
    ;(event.start.getTime() < tomorrowDate.getTime() ? today : tomorrow).events.push(event)
  }
  for (const group of [today, tomorrow]) {
    group.events.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? 1 : -1
      return a.start.getTime() - b.start.getTime()
    })
  }
  return [today, tomorrow].filter((group) => group.events.length > 0)
}

/** One meeting: a time range, the title, the participant avatars (you excluded,
 *  capped at 3 + "+N"), an optional Meet "Join" button, and an open-in-Calendar
 *  action. The current/next meeting is marked by the accent rail alone; a meeting
 *  that's ended is dimmed (its time goes muted too). */
function EventRow({
  event,
  isNext,
  isPast
}: {
  event: CalendarEventRow
  isNext: boolean
  isPast: boolean
}): ReactElement {
  return (
    <div className={cn('relative flex items-center gap-3 px-3 py-2', isPast && 'opacity-55')}>
      {/* The current/next meeting's accent rail — inset from top/bottom so it
          never collides with the card's rounded corners. */}
      {isNext && (
        <span aria-hidden className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary" />
      )}
      <span className="min-w-28 shrink-0 whitespace-nowrap text-foreground text-xs tabular-nums">
        {formatRange(event)}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{event.title}</span>
      {event.attendees.length > 0 && (
        <UserAvatars
          users={event.attendees.map((attendee) => ({ login: attendee.name, avatarUrl: null }))}
        />
      )}
      {event.hangoutLink && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => window.open(event.hangoutLink ?? '', '_blank')}
        >
          <IconVideo />
          Join
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label="Open in Google Calendar"
        title="Open in Google Calendar"
        onClick={() => window.open(event.htmlLink, '_blank')}
      >
        <IconExternalLink />
      </Button>
    </div>
  )
}

/**
 * The dashboard agenda: today's and tomorrow's meetings from every linked Google
 * account, merged and sorted, as a single list grouped by day. Renders nothing
 * until a Google account is linked, so the dashboard is unchanged for anyone not
 * using the integration. Meetings stay dashboard-global (not project-scoped) for
 * now — see the domain→project map planned with the email phase.
 */
export function TodayAgenda(): ReactElement | null {
  const accounts = trpc.google.listAccounts.useQuery()
  const connected = (accounts.data?.length ?? 0) > 0

  const agenda = trpc.google.agenda.useQuery(undefined, {
    enabled: connected,
    refetchInterval: AGENDA_REFETCH_MS
  })

  if (!connected) return null

  const nowMs = Date.now()
  const events = agenda.data?.events ?? []
  const groups = groupByDay(events, new Date(nowMs))
  // The current/next meeting is the first timed event that hasn't ended yet.
  const next = events.find((event) => !event.allDay && event.end.getTime() > nowMs)
  const nextKey = next ? eventKey(next) : null
  const failures = (agenda.data?.errors ?? []).map((error) => ({
    repo: error.account,
    message: error.message
  }))

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-heading font-semibold text-lg tracking-tight">Agenda</h2>
      <FailuresBanner failures={failures} />
      <div className="overflow-hidden rounded-xl border border-border">
        {agenda.isLoading ? (
          <EmptyHint>Loading your agenda…</EmptyHint>
        ) : groups.length === 0 ? (
          <EmptyHint>Nothing on your calendar today or tomorrow.</EmptyHint>
        ) : (
          groups.map((group, i) => (
            <div key={group.label} className={cn(i > 0 && 'border-border border-t')}>
              <div className="flex items-center gap-2 border-border border-b px-3 py-2 text-muted-foreground">
                <IconCalendar className="size-4 shrink-0" />
                <span className="font-medium text-sm">{group.label}</span>
                <span className="text-xs">{group.date}</span>
              </div>
              <div className="flex flex-col divide-y divide-border">
                {group.events.map((event) => (
                  <EventRow
                    key={eventKey(event)}
                    event={event}
                    isNext={eventKey(event) === nextKey}
                    isPast={!event.allDay && event.end.getTime() <= nowMs}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
