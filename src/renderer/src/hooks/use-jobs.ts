import { useEffect, useRef } from 'react'
import { toastManager } from '@/components/ui/toast'
import { trpc } from '@/lib/trpc'

/**
 * The renderer's window onto the background-job registry. Polls `jobs.list`
 * only while something is running (mutation callers invalidate the query when
 * they start a job, which kicks the polling off), and watches for jobs
 * *finishing* to invalidate the derived worktree state — that's how a row's
 * glyph appears/disappears with no dialog involved — and to fire a toast.
 * Toasts are deliberately dumb notifications; the jobs popover and detail
 * dialog are the durable record.
 *
 * Mounted once, by the top-bar jobs button; everything else reads the same
 * query from the cache.
 */
export function useJobs() {
  const utils = trpc.useUtils()
  const query = trpc.jobs.list.useQuery(undefined, {
    refetchInterval: (state) =>
      state.state.data?.jobs.some((job) => job.status === 'running') ? 1000 : false
  })

  // Previous poll's id → status. A job is "just finished" when it's not
  // running now but its last known status was — or when it's brand new and
  // already finished (started and completed inside one poll gap). The first
  // dataset only seeds the map: those jobs finished before this window
  // existed, and their invalidations are long done.
  const previous = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    const jobs = query.data?.jobs
    if (!jobs) return
    if (previous.current !== null) {
      for (const job of jobs) {
        if (job.status === 'running' || previous.current.get(job.id) === job.status) continue
        if (job.meta.owner && job.meta.name) {
          void utils.worktrees.forRepo.invalidate({ owner: job.meta.owner, name: job.meta.name })
        }
        if (job.status === 'succeeded') {
          toastManager.add({ type: 'success', title: `${job.title} finished` })
        } else {
          toastManager.add({
            type: 'error',
            title: `${job.title} failed`,
            description: 'Open Jobs for details.'
          })
        }
      }
    }
    previous.current = new Map(jobs.map((job) => [job.id, job.status]))
  }, [query.data, utils])

  return query
}
