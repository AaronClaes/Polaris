import { existsSync } from 'node:fs'
import { execa } from 'execa'

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
 * List a repo's added worktrees by parsing `git worktree list --porcelain`.
 *
 * Worktree state is fully derived — nothing is persisted — so this is the
 * single source of branch → worktree truth. Run through a login + interactive
 * shell (`$SHELL -ilc`, same trap as action-runner's runCommand) so the
 * packaged app resolves the user's git; cwd carries the repo path, keeping the
 * command free of quoting concerns.
 *
 * Deliberately forgiving: a missing/unset clone path or a failing git call
 * returns `[]` rather than throwing, so a repo without a usable clone simply
 * renders no worktrees instead of breaking the view.
 */
export async function listWorktrees(repoPath: string | null | undefined): Promise<Worktree[]> {
  if (!repoPath || !existsSync(repoPath)) return []

  const userShell = process.env.SHELL || '/bin/zsh'
  const result = await execa(userShell, ['-ilc', 'git worktree list --porcelain'], {
    cwd: repoPath,
    reject: false,
    timeout: 15_000
  })
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
