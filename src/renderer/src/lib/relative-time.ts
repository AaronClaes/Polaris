// Relative + absolute time formatting for GitHub timestamps, using the native
// Intl APIs so we don't pull in a date library.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1]
]

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })

/** "3 days ago" / "in 2 hours" — picks the largest fitting unit. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const deltaSeconds = Math.round((then - Date.now()) / 1000)
  const magnitude = Math.abs(deltaSeconds)

  for (const [unit, seconds] of UNITS) {
    if (magnitude >= seconds || unit === 'second') {
      return relative.format(Math.round(deltaSeconds / seconds), unit)
    }
  }
  return ''
}

/** Full local date + time, for the hover tooltip. */
export function formatAbsolute(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}
