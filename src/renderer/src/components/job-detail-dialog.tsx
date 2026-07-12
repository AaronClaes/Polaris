import { IconCheck, IconX } from '@tabler/icons-react'
import { type ReactElement, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { formatRelative } from '@/lib/relative-time'
import { trpc } from '@/lib/trpc'

/** "12s" / "2m 5s" — a job's wall-clock time, for the header line. */
function formatDuration(startedAt: Date, finishedAt: Date): string {
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

/**
 * The status view for one job: live status, the full error copy on failure
 * (this is where the half-failure guidance — "the worktree was created, but…" —
 * gets read), and the captured log. Follows the job by id through the shared
 * `jobs.list` cache (the top bar polls it while anything runs), so a running
 * job flips to succeeded/failed in place while you watch; only the log itself
 * is polled here, and only while the job runs — it's too heavy for `list`.
 *
 * Rendered as a *sibling* of the jobs popover (which closes when a row is
 * clicked), same pattern as the worktree glyph's dialogs — nested inside it,
 * the popover's light dismiss would unmount this mid-read.
 */
export function JobDetailDialog({
  jobId,
  onOpenChange
}: {
  jobId: string
  onOpenChange: (open: boolean) => void
}): ReactElement | null {
  const { data } = trpc.jobs.list.useQuery()
  const job = data?.jobs.find((entry) => entry.id === jobId)
  const running = job?.status === 'running'

  const log = trpc.jobs.log.useQuery({ id: jobId }, { refetchInterval: running ? 250 : false })

  // Pin the log to its tail: the newest output is what a live view is for, and
  // on a finished job the ending (error included) is the part worth reading.
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (log.data === undefined) return
    const pane = logRef.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [log.data])

  // Evicted from the registry under the dialog (archive cap) — nothing left to
  // show, so just close.
  if (!job) return null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            {job.status === 'running' ? (
              <Spinner className="size-5 shrink-0" />
            ) : job.status === 'succeeded' ? (
              <IconCheck className="size-5 shrink-0 text-success-foreground" />
            ) : (
              <IconX className="size-5 shrink-0 text-destructive-foreground" />
            )}
            <span className="truncate">{job.title}</span>
          </DialogTitle>
          <DialogDescription className="truncate" title={job.meta.path ?? job.detail}>
            {job.detail}
            {job.meta.path && <> · {job.meta.path}</>}
          </DialogDescription>
          <p className="text-muted-foreground text-xs">
            Started {formatRelative(job.startedAt.toISOString())}
            {job.finishedAt && <> · took {formatDuration(job.startedAt, job.finishedAt)}</>}
          </p>
          {job.error && (
            <p className="whitespace-pre-wrap break-words text-destructive-foreground text-sm">
              {job.error}
            </p>
          )}
        </DialogHeader>
        <DialogPanel>
          <pre
            ref={logRef}
            className="max-h-72 min-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 px-3 py-2 font-mono text-muted-foreground text-xs"
          >
            {log.data?.log || 'No output.'}
          </pre>
        </DialogPanel>
        {/* Bare footer for breathing room — the × in the corner is the close. */}
        <div className="pb-3" />
      </DialogPopup>
    </Dialog>
  )
}
