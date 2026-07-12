import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { execa } from 'execa'
import type { DB } from '../db/client'
import { settings } from '../db/schema'

/** An *added* worktree of a repo — the main clone itself is never included.
 *  Deliberately just path + branch: the renderer writes freshly created
 *  worktrees straight into its query cache, so every field here must be known
 *  at creation time without another git call. */
export interface Worktree {
  /** Absolute path of the worktree directory. */
  path: string
  /** Branch name (without the refs/heads/ prefix) checked out in the worktree. */
  branch: string
}

/**
 * In-memory output logs of in-flight worktree creations, keyed by a renderer-
 * generated run id. The creation dialog polls `worktrees.creationLog` while its
 * mutation runs, so the user watches the git/setup output live instead of a
 * spinner. Bounded both ways (runs kept + bytes per run) — it's a live peek,
 * not a persistent log.
 */
const creationLogs = new Map<string, string>()
const MAX_LOG_RUNS = 20
const MAX_LOG_LENGTH = 20_000

export function appendCreationLog(runId: string, chunk: string): void {
  if (!creationLogs.has(runId) && creationLogs.size >= MAX_LOG_RUNS) {
    // Maps iterate in insertion order, so the first key is the oldest run.
    const oldest = creationLogs.keys().next().value
    if (oldest !== undefined) creationLogs.delete(oldest)
  }
  creationLogs.set(runId, ((creationLogs.get(runId) ?? '') + chunk).slice(-MAX_LOG_LENGTH))
}

export function readCreationLog(runId: string): string {
  return creationLogs.get(runId) ?? ''
}

/**
 * Run a git command in `repoPath` through a login + interactive shell
 * (`$SHELL -ilc`, same trap as action-runner's runCommand) so the packaged app
 * resolves the user's git; cwd carries the repo path so the command string
 * itself stays quoting-free for the common case. `onLog` streams the combined
 * output as it arrives (on top of the buffered result).
 */
async function runGit(
  repoPath: string,
  command: string,
  timeout: number,
  onLog?: (chunk: string) => void
): Promise<{ exitCode?: number; stdout: string; stderr: string; timedOut: boolean }> {
  const userShell = process.env.SHELL || '/bin/zsh'
  const subprocess = execa(userShell, ['-ilc', command], {
    cwd: repoPath,
    reject: false,
    timeout,
    all: onLog !== undefined
  })
  subprocess.all?.on('data', (chunk: Buffer | string) => onLog?.(chunk.toString()))
  return subprocess
}

/** Single-quote a value for embedding in the `-ilc` command string (paths and
 *  branch names reach the shell verbatim). */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** The one-line reason a git call failed — stderr when there is any, otherwise
 *  what actually happened (timeout, or the shell never ran git at all). Never
 *  "exit code undefined". */
function describeGitFailure(result: {
  exitCode?: number
  stderr: string
  timedOut: boolean
}): string {
  if (result.timedOut) return 'timed out'
  return result.stderr.trim() || `exit code ${result.exitCode ?? 'unknown (git did not run)'}`
}

/**
 * List a repo's added worktrees by parsing `git worktree list --porcelain`.
 *
 * Worktree state is fully derived — nothing is persisted — so this is the
 * single source of branch → worktree truth.
 *
 * Deliberately forgiving: a missing/unset clone path or a failing git call
 * returns `[]` rather than throwing, so a repo without a usable clone simply
 * renders no worktrees instead of breaking the view.
 */
export async function listWorktrees(repoPath: string | null | undefined): Promise<Worktree[]> {
  if (!repoPath || !existsSync(repoPath)) return []

  const result = await runGit(repoPath, 'git worktree list --porcelain', 15_000)
  if (result.exitCode !== 0) return []

  // Porcelain output is stanzas separated by blank lines:
  //   worktree <path> / HEAD <sha> / branch refs/heads/<name>
  // (or `detached` / `bare` instead of a branch — skipped, they can't be keyed
  // to an issue's branch). The first stanza is always the main clone; only the
  // *added* worktrees after it are surfaced.
  const stanzas = result.stdout.split('\n\n')
  const worktrees: Worktree[] = []
  for (const stanza of stanzas.slice(1)) {
    let path: string | null = null
    let head: string | null = null
    let branch: string | null = null
    for (const line of stanza.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length)
      else if (line.startsWith('branch refs/heads/'))
        branch = line.slice('branch refs/heads/'.length)
    }
    // HEAD still gates the push — a stanza without it isn't a usable worktree.
    if (path && head && branch) worktrees.push({ path, branch })
  }
  return worktrees
}

/** Settings-table key for the global worktrees root directory. */
export const WORKTREES_ROOT_SETTING_KEY = 'worktreesRoot'

/** The effective worktrees root: the stored setting, or `~/polaris/worktrees`
 *  when unset. Worktrees land at `<root>/<owner>/<repo>/<sanitized-branch>`. */
export function readWorktreesRoot(db: DB): string {
  const row = db.select().from(settings).where(eq(settings.key, WORKTREES_ROOT_SETTING_KEY)).get()
  return row?.value.trim() || join(homedir(), 'polaris', 'worktrees')
}

/**
 * A branch name as a single filesystem-safe path segment: lowercased, with `/`
 * and anything outside [a-z0-9._] collapsed to `-`. Mirrored by the creation
 * dialog's client-side path preview (worktree-create-dialog.tsx) — keep the two
 * in sync.
 */
export function sanitizeBranchForPath(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Where a branch's worktree lives: `<root>/<owner>/<repo>/<sanitized-branch>`.
 *  A branch name that sanitizes to nothing (emoji/CJK-only) takes the fallback
 *  segment instead, so the path never collapses into the repo dir itself. The
 *  dialog's client-side preview mirrors this rule — keep the two in sync. */
export function deriveWorktreePath(
  root: string,
  owner: string,
  repo: string,
  branch: string,
  fallbackSegment = 'worktree'
): string {
  return join(root, owner, repo, sanitizeBranchForPath(branch) || fallbackSegment)
}

/**
 * The entries already on disk in the repo's worktree directory
 * (`<root>/<owner>/<repo>`). The creation dialog checks the live-derived path
 * segment against these, so an occupied target blocks submit *before* any
 * GitHub write instead of failing at `git worktree add`. A missing directory
 * just means nothing is occupied.
 */
export async function listOccupiedSegments(
  root: string,
  owner: string,
  repo: string
): Promise<string[]> {
  try {
    return await readdir(join(root, owner, repo))
  } catch {
    return []
  }
}

/**
 * The suggested branch name for an issue, following GitHub's own convention:
 * `<number>-<kebab-title>`, capped on a word boundary so a long issue title
 * doesn't produce an unwieldy ref.
 */
export function deriveBranchName(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .reduce((acc, word) => {
      const next = acc ? `${acc}-${word}` : word
      return next.length <= 50 ? next : acc
    }, '')
  return slug ? `${number}-${slug}` : `issue-${number}`
}

/**
 * Materialize a branch as a worktree: fetch so the (freshly created on GitHub,
 * or remote-only) branch is known locally, then `git worktree add` — git DWIMs
 * a local tracking branch when the name only exists on the remote. Throws with
 * git's stderr on failure; the caller decides how to surface it (a failure
 * *after* the GitHub branch was created is a legitimate, retryable state).
 */
export async function addWorktree({
  repoPath,
  branch,
  worktreePath,
  onLog
}: {
  repoPath: string
  branch: string
  worktreePath: string
  onLog?: (chunk: string) => void
}): Promise<void> {
  await mkdir(dirname(worktreePath), { recursive: true })

  onLog?.('$ git fetch origin\n')
  const fetch = await runGit(repoPath, 'git fetch origin', 120_000, onLog)
  if (fetch.exitCode !== 0) {
    throw new Error(`git fetch failed: ${describeGitFailure(fetch)}`)
  }

  const addCommand = `git worktree add ${shellQuote(worktreePath)} ${shellQuote(branch)}`
  onLog?.(`$ ${addCommand}\n`)
  const add = await runGit(repoPath, addCommand, 30_000, onLog)
  if (add.exitCode !== 0) {
    throw new Error(`git worktree add failed: ${describeGitFailure(add)}`)
  }
}

/**
 * Run a setup recipe in a freshly created worktree — `$SHELL -ilc` like every
 * other user command, cwd = the worktree, with the creation context layered
 * into the environment (execa merges it over process.env) so a recipe/script
 * can reach back to the main clone (`cp "$REPO_PATH/.env" .`).
 *
 * Returns an error message (with a tail of the captured output) instead of
 * throwing: by the time setup runs the worktree already exists, so a failed
 * recipe is a warning on a successful creation, never a failed mutation.
 */
export async function runSetupCommand({
  command,
  repoPath,
  worktreePath,
  branch,
  issueNumber,
  onLog
}: {
  command: string
  repoPath: string
  worktreePath: string
  branch: string
  issueNumber?: number
  onLog?: (chunk: string) => void
}): Promise<string | null> {
  const userShell = process.env.SHELL || '/bin/zsh'
  onLog?.(`$ ${command}\n`)
  const subprocess = execa(userShell, ['-ilc', command], {
    cwd: worktreePath,
    reject: false,
    // Bounded so a hung recipe can't wedge the create mutation indefinitely.
    timeout: 120_000,
    // Interleaved stdout+stderr, both for live streaming and the failure tail.
    all: true,
    env: {
      REPO_PATH: repoPath,
      WORKTREE_PATH: worktreePath,
      BRANCH: branch,
      ...(issueNumber === undefined ? {} : { ISSUE_NUMBER: String(issueNumber) })
    }
  })
  subprocess.all?.on('data', (chunk: Buffer | string) => onLog?.(chunk.toString()))
  const result = await subprocess
  if (!result.timedOut && result.exitCode === 0) return null

  const reason = result.timedOut
    ? 'timed out after 2 minutes'
    : `exited with code ${result.exitCode}`
  const tail = (result.all ?? '').trim().slice(-2_000)
  return `Setup command ${reason}.${tail ? `\n${tail}` : ''}`
}

/**
 * Remove a worktree — but only when nothing would be lost: refuses on
 * uncommitted changes, unpushed commits, or a branch with no upstream (never
 * pushed — same risk, so the same safe default). Never `--force`, and branches
 * (local and remote) are never touched: removal is purely "this checkout is
 * done", the work lives on in the branch. Refusals throw with a user-facing
 * message; cleanup happens in the user's own terminal, not here.
 */
export async function removeWorktree({
  repoPath,
  worktreePath
}: {
  repoPath: string
  worktreePath: string
}): Promise<void> {
  const status = await runGit(worktreePath, 'git status --porcelain', 15_000)
  if (status.exitCode !== 0) {
    throw new Error(`git status failed: ${describeGitFailure(status)}`)
  }
  if (status.stdout.trim().length > 0) {
    throw new Error('The worktree has uncommitted changes — clean them up in your terminal first.')
  }

  // `@{u}..` lists commits the upstream doesn't have; it errors when no
  // upstream is configured, which we fold into the same refusal.
  const unpushed = await runGit(worktreePath, 'git log @{u}.. --oneline', 15_000)
  if (unpushed.exitCode !== 0) {
    throw new Error('The branch has never been pushed — push it first so the work is safe.')
  }
  if (unpushed.stdout.trim().length > 0) {
    throw new Error('The worktree has unpushed commits — push them first.')
  }

  const remove = await runGit(repoPath, `git worktree remove ${shellQuote(worktreePath)}`, 30_000)
  if (remove.exitCode !== 0) {
    throw new Error(`git worktree remove failed: ${describeGitFailure(remove)}`)
  }
}
