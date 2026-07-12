import { IconCheck, IconStack2, IconX } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { useJobs } from '@/hooks/use-jobs'
import { formatRelative } from '@/lib/relative-time'
import { trpc } from '@/lib/trpc'

/**
 * The top-bar window onto background jobs — always visible, so there's a fixed
 * place to answer "did I run it?". The badge counts running jobs; the popover
 * lists the session's archive, newest first (finished jobs stay listed rather
 * than vanishing). This is also where the one `useJobs` instance lives, doing
 * the poll + finished-job invalidations for the whole app.
 */
export function JobsButton(): ReactElement {
  const { data } = useJobs()
  const jobs = data?.jobs ?? []
  const running = jobs.filter((job) => job.status === 'running').length
  // Raw list on purpose (same as the top bar's title lookup): a job's project
  // must still resolve when its tag is currently hidden.
  const projects = trpc.projects.list.useQuery()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon-sm" aria-label="Jobs" title="Jobs">
            <IconStack2 />
            {running > 0 && (
              <Badge size="sm" className="-top-1.5 -right-1.5 absolute rounded-full">
                {running}
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
                // min-w-0 down the chain so the truncates engage instead of the
                // row expanding past the popover (grid/flex min-width: auto).
                <div key={job.id} className="grid min-w-0 gap-0.5">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
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
                  </div>
                  {/* Project icon over repo text so the time — the part that
                      actually changes — always has room; owner/repo (job.detail)
                      is the fallback for repos linked to no project, and shows
                      in the title tooltip either way. */}
                  <p
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
                    <span className="shrink-0">{formatRelative(job.startedAt.toISOString())}</span>
                  </p>
                  {job.error && (
                    <p className="whitespace-pre-wrap break-words pl-6 text-destructive-foreground text-xs">
                      {job.error}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  )
}
