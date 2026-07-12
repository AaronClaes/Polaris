import { IconCheck, IconStack2, IconX } from '@tabler/icons-react'
import { type ReactElement, useEffect, useRef, useState } from 'react'
import { JobDetailDialog } from '@/components/job-detail-dialog'
import { ProjectIcon } from '@/components/project-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { useJobs } from '@/hooks/use-jobs'
import { formatRelative } from '@/lib/relative-time'
import { trpc } from '@/lib/trpc'

/**
 * The top-bar window onto background jobs — always visible, so there's a fixed
 * place to answer "did I run it?". The badge only nags about news: running
 * jobs plus finished ones you haven't laid eyes on (destructive when one of
 * those failed); opening the popover marks everything seen but keeps it
 * listed — the archive empties only by explicit dismiss / "Clear finished".
 * Rows click through to the detail dialog with the live log. This is also
 * where the one `useJobs` instance lives, doing the poll + finished-job
 * invalidations and toasts for the whole app.
 */
export function JobsButton(): ReactElement {
  const utils = trpc.useUtils()
  const { data } = useJobs()
  const jobs = data?.jobs ?? []
  const running = jobs.filter((job) => job.status === 'running').length
  const finished = jobs.filter((job) => job.status !== 'running')
  const unseen = finished.filter((job) => !job.seenAt)
  const badgeCount = running + unseen.length
  const unseenFailed = unseen.some((job) => job.status === 'failed')
  // Raw list on purpose (same as the top bar's title lookup): a job's project
  // must still resolve when its tag is currently hidden.
  const projects = trpc.projects.list.useQuery()

  const markSeen = trpc.jobs.markSeen.useMutation({
    onSuccess: () => utils.jobs.list.invalidate()
  })
  const dismiss = trpc.jobs.dismiss.useMutation({
    onSuccess: () => utils.jobs.list.invalidate()
  })
  const clearFinished = trpc.jobs.clearFinished.useMutation({
    onSuccess: () => utils.jobs.list.invalidate()
  })

  // Pop open when a *new* job appears — submitting closes its dialog
  // immediately, so without this it looks like nothing happened. The first
  // dataset only seeds the set: those jobs predate this window (the registry
  // is main-side, so it survives a renderer reload).
  const [open, setOpen] = useState(false)
  const knownIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    const current = data?.jobs
    if (!current) return
    const known = knownIds.current
    if (known && current.some((job) => !known.has(job.id))) setOpen(true)
    knownIds.current = new Set(current.map((job) => job.id))
  }, [data])

  // While the popover is open, everything listed has been seen — stamp any
  // finished job that isn't yet. Keyed on the data too, so a job finishing
  // *while you watch* doesn't come back as a badge after closing. (markSeen
  // is idempotent, so an overlapping call during a poll tick is harmless.)
  const markSeenMutate = markSeen.mutate
  useEffect(() => {
    if (!open) return
    const current = data?.jobs ?? []
    if (current.some((job) => job.status !== 'running' && !job.seenAt)) markSeenMutate()
  }, [open, data, markSeenMutate])

  // The detail dialog is a popover *sibling* (the worktree glyph's dialog
  // pattern): clicking a row closes the popover, and nested inside it the
  // popover's light dismiss would unmount the dialog mid-read.
  const [detailJobId, setDetailJobId] = useState<string | null>(null)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" size="icon-sm" aria-label="Jobs" title="Jobs">
              <IconStack2 />
              {badgeCount > 0 && (
                <Badge
                  size="sm"
                  variant={unseenFailed ? 'destructive' : 'default'}
                  className="-top-1.5 -right-1.5 absolute rounded-full"
                >
                  {badgeCount}
                </Badge>
              )}
            </Button>
          }
        />
        <PopoverPopup align="end" className="w-80">
          {jobs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No jobs yet.</p>
          ) : (
            <div className="grid gap-2.5">
              {jobs.map((job) => {
                const project = projects.data?.find((entry) => entry.id === job.meta.projectId)
                return (
                  // The hover surface is the whole item — the dismiss × lives
                  // inside it (top-right), while only the main button opens the
                  // detail dialog. Two sibling buttons, since they can't nest.
                  <div
                    key={job.id}
                    className="-m-1 flex min-w-0 items-start gap-1 rounded-md p-1 transition-colors hover:bg-accent"
                  >
                    {/* min-w-0 down the chain so the truncates engage instead
                        of the row expanding past the popover (grid/flex
                        min-width: auto). */}
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        setDetailJobId(job.id)
                      }}
                      className="grid min-w-0 flex-1 gap-0.5 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        {job.status === 'running' ? (
                          <Spinner className="size-4 shrink-0" />
                        ) : job.status === 'succeeded' ? (
                          <IconCheck className="size-4 shrink-0 text-success-foreground" />
                        ) : (
                          <IconX className="size-4 shrink-0 text-destructive-foreground" />
                        )}
                        <span className="truncate font-medium" title={job.title}>
                          {job.title}
                        </span>
                      </span>
                      {/* Project icon over repo text so the time — the part that
                          actually changes — always has room; owner/repo
                          (job.detail) is the fallback for repos linked to no
                          project, and shows in the title tooltip either way. */}
                      <span
                        className="flex min-w-0 items-center gap-1.5 pl-6 text-muted-foreground text-xs"
                        title={job.detail}
                      >
                        {project ? (
                          <ProjectIcon
                            icon={project.icon}
                            color={project.color}
                            size={10}
                            className="size-3.5 shrink-0"
                          />
                        ) : (
                          <span className="truncate">{job.detail}</span>
                        )}
                        <span className="shrink-0">
                          {formatRelative(job.startedAt.toISOString())}
                        </span>
                      </span>
                      {job.error && (
                        <span className="block whitespace-pre-wrap break-words pl-6 text-destructive-foreground text-xs">
                          {job.error}
                        </span>
                      )}
                    </button>
                    {job.status !== 'running' && (
                      <button
                        type="button"
                        aria-label="Dismiss job"
                        title="Dismiss"
                        onClick={() => dismiss.mutate({ id: job.id })}
                        className="mt-0.5 shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <IconX className="size-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
              {finished.length > 0 && (
                <>
                  <Separator className="-mx-2" />
                  <Button
                    variant="ghost"
                    size="xs"
                    className="justify-self-end"
                    onClick={() => clearFinished.mutate()}
                  >
                    Clear finished
                  </Button>
                </>
              )}
            </div>
          )}
        </PopoverPopup>
      </Popover>
      {detailJobId && (
        <JobDetailDialog
          jobId={detailJobId}
          onOpenChange={(dialogOpen) => {
            if (!dialogOpen) setDetailJobId(null)
          }}
        />
      )}
    </>
  )
}
