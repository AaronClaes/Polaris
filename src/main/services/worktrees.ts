import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { execa } from 'execa'
import type { DB } from '../db/client'
import { settings } from '../db/schema'

/** An *added* worktree of a repo — the main clone itself is never included. */
export interface Worktree {
  /** Absolute path of the worktree directory. */
  path: string
  /** Branch name (without the refs/heads/ prefix) checked out in the worktree. */
  branch: string
  /** The commit the worktree is on. */
  head: string
}

/**
 * Run a git command in `repoPath` through a login + interactive shell
 * (`$SHELL -ilc`, same trap as action-runner's runCommand) so the packaged app
 * resolves the user's git; cwd carries the repo path so the command string
 * itself stays quoting-free for the common case.
 */
async function runGit(
  repoPath: string,
  command: string,
  timeout: number
): Promise<{ exitCode?: number; stdout: string; stderr: string }> {
  const userShell = process.env.SHELL || '/bin/zsh'
  return execa(userShell, ['-ilc', command], { cwd: repoPath, reject: false, timeout })
}

/** Single-quote a value for embedding in the `-ilc` command string (paths and
 *  branch names reach the shell verbatim). */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
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
    if (path && head && branch) worktrees.push({ path, head, branch })
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

/** Where a branch's worktree lives: `<root>/<owner>/<repo>/<sanitized-branch>`. */
export function deriveWorktreePath(
  root: string,
  owner: string,
  repo: string,
  branch: string
): string {
  return join(root, owner, repo, sanitizeBranchForPath(branch))
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
  worktreePath
}: {
  repoPath: string
  branch: string
  worktreePath: string
}): Promise<void> {
  await mkdir(dirname(worktreePath), { recursive: true })

  const fetch = await runGit(repoPath, 'git fetch origin', 120_000)
  if (fetch.exitCode !== 0) {
    throw new Error(`git fetch failed: ${fetch.stderr || `exit code ${fetch.exitCode}`}`)
  }

  const add = await runGit(
    repoPath,
    `git worktree add ${shellQuote(worktreePath)} ${shellQuote(branch)}`,
    30_000
  )
  if (add.exitCode !== 0) {
    throw new Error(`git worktree add failed: ${add.stderr || `exit code ${add.exitCode}`}`)
  }
}
