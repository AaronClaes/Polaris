import { randomUUID } from 'node:crypto'

/**
 * The background-job registry: long-running worktree operations (create with a
 * setup recipe, remove) run here so dialogs can close on submit instead of
 * blocking on the work. Deliberately in-memory and session-scoped — a child
 * process dies with the app, so a persisted "running" row would be a lie on
 * restart, and worktree state is derived from git either way. Finished jobs
 * stay listed (running → finished, never running → gone) until dismissed, so
 * there's no "wait, did I run it?" and their logs stay readable.
 */

export type JobKind = 'worktree-create' | 'worktree-remove'
export type JobStatus = 'running' | 'succeeded' | 'failed'

export interface Job {
  id: string
  kind: JobKind
  /** User-facing, e.g. "Create worktree 123-fix-login". */
  title: string
  /** Secondary line, e.g. "owner/repo". */
  detail: string
  status: JobStatus
  /** User-facing failure message; only ever set on `failed`. */
  error?: string
  startedAt: Date
  finishedAt?: Date
  /** When the finished job was shown to the user (jobs popover opened) — unseen
   *  finished jobs drive the top-bar badge. Written in a later task; in the
   *  shape from day one so the wire type never changes. */
  seenAt?: Date
  /** What the job operates on, so the renderer can key UI state (row spinners,
   *  the project icon) and invalidations to it without parsing titles. */
  meta: {
    owner?: string
    name?: string
    branch?: string
    path?: string
    projectId?: number
    issueNumber?: number
  }
}

// Insertion order = start order, so values() iterates oldest-first. Logs live
// beside the jobs (not on them): `jobs.list` is polled and logs are ~20k chars
// each, so they only cross IPC one at a time via `jobs.log`.
const jobs = new Map<string, Job>()
const logs = new Map<string, string>()
const MAX_JOBS = 50
const MAX_LOG_LENGTH = 20_000

function appendLog(id: string, chunk: string): void {
  logs.set(id, ((logs.get(id) ?? '') + chunk).slice(-MAX_LOG_LENGTH))
}

/** Cap the registry by evicting the oldest *finished* job (running jobs are
 *  never evicted — the cap exists to bound memory, not to lose live state). */
function evictPastCap(): void {
  if (jobs.size < MAX_JOBS) return
  for (const job of jobs.values()) {
    if (job.status === 'running') continue
    jobs.delete(job.id)
    logs.delete(job.id)
    return
  }
}

/**
 * Register a job and kick off its work. The closure is deliberately not
 * awaited — the caller returns its mutation immediately and the renderer
 * follows along by polling. Everything the closure throws becomes the job's
 * user-facing `error` (and is appended to the log, so the detail view reads
 * as one continuous story).
 */
export function startJob(
  descriptor: { kind: JobKind; title: string; detail: string; meta: Job['meta'] },
  run: (log: (chunk: string) => void) => Promise<void>
): Job {
  evictPastCap()
  const job: Job = { ...descriptor, id: randomUUID(), status: 'running', startedAt: new Date() }
  jobs.set(job.id, job)
  logs.set(job.id, '')

  const log = (chunk: string): void => appendLog(job.id, chunk)
  void run(log)
    .then(() => {
      job.status = 'succeeded'
    })
    .catch((error: unknown) => {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      log(`\n${job.error}\n`)
    })
    .finally(() => {
      job.finishedAt = new Date()
    })
  return job
}

/** All jobs, newest first (the popover's display order). */
export function listJobs(): Job[] {
  return [...jobs.values()].reverse()
}

/** The first *running* job matching the predicate — the mutations' duplicate
 *  guard (dialogs no longer block while work runs, so the registry must). */
export function findActiveJob(predicate: (job: Job) => boolean): Job | undefined {
  for (const job of jobs.values()) {
    if (job.status === 'running' && predicate(job)) return job
  }
  return undefined
}

/** Stamp every finished job as seen — the popover was opened, so nothing
 *  listed is news anymore. Running jobs are deliberately skipped: they finish
 *  *after* the popover closed, and their ending should count as new again. */
export function markJobsSeen(): void {
  const now = new Date()
  for (const job of jobs.values()) {
    if (job.status !== 'running' && !job.seenAt) job.seenAt = now
  }
}

/** A job's captured output; an unknown id is just an empty log, never an error
 *  (same posture as the creation log this replaces). */
export function readJobLog(id: string): string {
  return logs.get(id) ?? ''
}

/** Drop one finished job from the archive. Running jobs can't be dismissed —
 *  there'd be no way to learn how they ended. */
export function dismissJob(id: string): void {
  const job = jobs.get(id)
  if (!job || job.status === 'running') return
  jobs.delete(id)
  logs.delete(id)
}

/** Empty the archive of everything that has finished. */
export function clearFinishedJobs(): void {
  for (const job of [...jobs.values()]) {
    if (job.status !== 'running') {
      jobs.delete(job.id)
      logs.delete(job.id)
    }
  }
}
