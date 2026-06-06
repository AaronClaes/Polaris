import { shell } from 'electron'
import { execa } from 'execa'
import type { CommandActionConfig, LinkActionConfig, ProjectAction } from '../db/schema'

export interface RunResult {
  ok: boolean
  error?: string
}

// How long to wait for a command before assuming it launched successfully.
// Quick commands (e.g. `open -a Cursor .`) finish well within this and surface
// their exit error; long-running ones (e.g. `pnpm dev`) keep running in the
// background and we report success once they're past this window.
const COMMAND_LAUNCH_GRACE_MS = 700

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Open a URL in the user's default browser. */
async function runLink(url: string): Promise<RunResult> {
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/**
 * Run a shell command in `cwd`.
 *
 * Executed through a login + interactive shell (`$SHELL -ilc`) so it inherits
 * the user's full PATH. A packaged `.app` launched from Finder/Dock otherwise
 * gets a stripped PATH (/usr/bin:/bin:/usr/sbin:/sbin) and can't resolve dev
 * tools like `pnpm`/`cursor` — the same trap that forced `open -a` for the
 * editor launcher. `-l` sources login profiles, `-i` sources the interactive
 * rc (where PATH is commonly set), `-c` runs the command and exits.
 *
 * We don't await completion: long-running commands (dev servers) would block
 * forever. Instead we race a short grace window — if the process exits fast
 * with a non-zero code we surface its error, otherwise we treat it as launched.
 */
async function runCommand(command: string, cwd: string | null | undefined): Promise<RunResult> {
  const userShell = process.env.SHELL || '/bin/zsh'

  const subprocess = execa(userShell, ['-ilc', command], {
    cwd: cwd || undefined,
    reject: false
  })
  // Keep the dangling promise from triggering an unhandled rejection once the
  // grace window has already returned.
  subprocess.catch(() => {})

  const outcome = await Promise.race([
    subprocess.then((result) => ({ settled: true as const, result })),
    new Promise<{ settled: false }>((resolve) => {
      setTimeout(() => resolve({ settled: false }), COMMAND_LAUNCH_GRACE_MS)
    })
  ])

  if (outcome.settled && outcome.result.exitCode !== 0) {
    const { result } = outcome
    return {
      ok: false,
      error: result.stderr || result.shortMessage || `Command exited with code ${result.exitCode}`
    }
  }

  return { ok: true }
}

/**
 * Execute a project action. The `type` discriminant selects the runner; the
 * project's default `path` is the command cwd unless the action overrides it.
 * New action types add a branch here (and to the schema union + renderer form).
 *
 * `config` is stored as the `ActionConfig` union and isn't narrowed by the
 * sibling `type` column, so each branch casts to its matching shape — safe
 * because the tRPC input layer validates config against type on write.
 */
export async function runAction(
  action: ProjectAction,
  projectPath: string | null
): Promise<RunResult> {
  switch (action.type) {
    case 'link':
      return runLink((action.config as LinkActionConfig).url)
    case 'command': {
      const config = action.config as CommandActionConfig
      return runCommand(config.command, config.cwd ?? projectPath)
    }
    default: {
      // Exhaustiveness guard: a new ACTION_TYPES entry without a branch fails here.
      const exhaustive: never = action.type
      return { ok: false, error: `Unknown action type: ${String(exhaustive)}` }
    }
  }
}
