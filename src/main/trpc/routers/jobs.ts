import { z } from 'zod'
import {
  clearFinishedJobs,
  dismissJob,
  listJobs,
  markJobsSeen,
  readJobLog
} from '../../services/jobs'
import { publicProcedure, router } from '..'

/**
 * The background-jobs surface: the top-bar button polls `list` (~1s while
 * anything runs), the detail dialog polls `log` for one job at a time. Logs are
 * deliberately not part of `list` — they're bounded at ~20k chars *each*, far
 * too heavy to ship on every poll.
 */
export const jobsRouter = router({
  list: publicProcedure.query(() => ({ jobs: listJobs() })),

  log: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => ({ log: readJobLog(input.id) })),

  markSeen: publicProcedure.mutation(() => {
    markJobsSeen()
  }),

  dismiss: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(({ input }) => {
    dismissJob(input.id)
  }),

  clearFinished: publicProcedure.mutation(() => {
    clearFinishedJobs()
  })
})
