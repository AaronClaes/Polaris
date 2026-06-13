import { IconCalendarEvent, IconExternalLink, IconVideo } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { EmptyHint, FailuresBanner } from '@/components/github-list'
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

interface DayGroup {
  label: string
  allDay: CalendarEventRow[]
  timed: CalendarEventRow[]
}

/** Split the merged, start-sorted events into Today / Tomorrow, separating
 *  all-day events (shown as chips) from timed ones (shown as rows). The window is
 *  exactly today + tomorrow, so every event falls into one of the two. */
function groupByDay(events: CalendarEventRow[], now: Date): DayGroup[] {
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  const today: DayGroup = { label: 'Today', allDay: [], timed: [] }
  const tomorrow: DayGroup = { label: 'Tomorrow', allDay: [], timed: [] }
  for (const event of events) {
    const group = event.start.getTime() < startOfTomorrow ? today : tomorrow
    ;(event.allDay ? group.allDay : group.timed).push(event)
  }
  return [today, tomorrow].filter((group) => group.allDay.length > 0 || group.timed.length > 0)
}

/** An all-day event as a clickable chip (no time to show). */
function AllDayChip({ event }: { event: CalendarEventRow }): ReactElement {
  return (
    <button
      type="button"
      onClick={() => window.open(event.htmlLink, '_blank')}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent"
    >
      <IconCalendarEvent className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{event.title}</span>
    </button>
  )
}

/** A timed meeting row: start time, title, an optional Meet "Join" button, and
 *  an open-in-Calendar action. The current/next meeting is highlighted; a meeting
 *  that's already ended is dimmed. */
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
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2',
        isNext && 'bg-accent/40',
        isPast && 'opacity-55'
      )}
    >
      <span
        className={cn(
          'w-16 shrink-0 text-xs tabular-nums',
          isNext ? 'font-medium text-foreground' : 'text-muted-foreground'
        )}
      >
        {formatTime(event.start)}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{event.title}</span>
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
 * account, merged and sorted. Renders nothing until a Google account is linked,
 * so the dashboard is unchanged for anyone not using the integration. Past events
 * are dimmed and the current/next meeting highlighted; all-day events show as
 * chips. Meetings stay dashboard-global (not project-scoped) for now — see the
 * domain→project map planned with the email phase.
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
        ) : events.length === 0 ? (
          <EmptyHint>Nothing on your calendar today or tomorrow.</EmptyHint>
        ) : (
          groups.map((group, i) => (
            <div key={group.label} className={cn(i > 0 && 'border-border border-t')}>
              <div className="bg-muted/40 px-3 py-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {group.label}
              </div>
              {group.allDay.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-1.5 pb-2">
                  {group.allDay.map((event) => (
                    <AllDayChip key={eventKey(event)} event={event} />
                  ))}
                </div>
              )}
              {group.timed.length > 0 && (
                <div className="divide-y divide-border">
                  {group.timed.map((event) => (
                    <EventRow
                      key={eventKey(event)}
                      event={event}
                      isNext={eventKey(event) === nextKey}
                      isPast={!event.allDay && event.end.getTime() <= nowMs}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
