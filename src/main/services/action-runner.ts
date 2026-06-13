import { existsSync } from 'node:fs'
import { shell } from 'electron'
import { execa } from 'execa'
import type {
  AppLauncherActionConfig,
  CommandActionConfig,
  IdeActionConfig,
  LinkActionConfig,
  ProjectAction,
  RepoActionConfig
} from '../db/schema'
import { resolveBrowser } from './browsers'

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

/**
 * Open a URL. With no `target`, hand off to the OS default browser. With a
 * target, launch that browser's binary directly with `--profile-directory` so
 * the URL opens in the chosen profile — `open -a` can't do this reliably once
 * the browser is already running (it drops the args; the binary routes the URL
 * to the right profile via the singleton instance). Falls back to the OS
 * default if the target browser is unknown or its binary is gone, so a link
 * never silently dies.
 */
async function runLink(
  url: string,
  target: { browser: string; profileDirectory: string } | null
): Promise<RunResult> {
  const entry = target ? resolveBrowser(target.browser) : undefined
  // `supportsProfiles` guards a stale target (e.g. a Dia link saved before
  // profile-gating): launching Dia's binary with the flag only triggers its
  // single-instance dialog, so fall through to the OS default instead.
  if (entry?.supportsProfiles && target && existsSync(entry.binaryPath)) {
    // Array args (no shell) so the URL is never re-interpreted. Detached and
    // unref'd: the launcher hands off to the browser and exits without tying the
    // window's lifetime to ours.
    const subprocess = execa(
      entry.binaryPath,
      [`--profile-directory=${target.profileDirectory}`, url],
      { detached: true, stdio: 'ignore', reject: false }
    )
    subprocess.unref()
    subprocess.catch(() => {})
    return { ok: true }
  }

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
 * Open a macOS app (by its `.app` name) on a directory via `open -a <app> <dir>`
 * — the default-terminal / default-IDE launcher. `open` lives at a fixed path
 * and takes the app by name, so it sidesteps the stripped-PATH trap that forces
 * the login-shell dance in {@link runCommand}. With no directory it just brings
 * the app to the front. `open` returns promptly (it only launches), so we await
 * it and surface its error — e.g. "Unable to find application named '…'".
 */
async function runOpenApp(appName: string, cwd: string | null | undefined): Promise<RunResult> {
  const args = cwd ? ['-a', appName, cwd] : ['-a', appName]
  const result = await execa('open', args, { reject: false })
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: result.stderr || result.shortMessage || `open exited with code ${result.exitCode}`
    }
  }
  return { ok: true }
}

/**
 * The user's chosen default terminal / IDE, as macOS app names — resolved from
 * global settings (with fallbacks) by the caller and handed to the `terminal` /
 * `ide` action branches.
 */
export interface DefaultApps {
  terminal: string
  ide: string
}

/**
 * Execute a project action. The `type` discriminant selects the runner; the
 * project's default `path` is the working directory unless the action overrides
 * it. The `terminal` / `ide` types carry no command — they open `defaultApps`'
 * resolved app on that directory. New action types add a branch here (and to the
 * schema union + renderer form).
 *
 * `config` is stored as the `ActionConfig` union and isn't narrowed by the
 * sibling `type` column, so each branch casts to its matching shape — safe
 * because the tRPC input layer validates config against type on write.
 */
export async function runAction(
  action: ProjectAction,
  projectPath: string | null,
  defaultApps: DefaultApps
): Promise<RunResult> {
  switch (action.type) {
    case 'link':
    case 'repo': {
      // A repo action is a link whose URL is a linked repo's github.com page;
      // both open a URL, optionally in a chosen browser/profile.
      const config = action.config as LinkActionConfig | RepoActionConfig
      const target =
        config.browser && config.profileDirectory
          ? { browser: config.browser, profileDirectory: config.profileDirectory }
          : null
      return runLink(config.url, target)
    }
    case 'command': {
      const config = action.config as CommandActionConfig
      return runCommand(config.command, config.cwd ?? projectPath)
    }
    case 'terminal': {
      const config = action.config as AppLauncherActionConfig
      return runOpenApp(defaultApps.terminal, config.cwd ?? projectPath)
    }
    case 'finder': {
      // Always Finder (the macOS file browser), so unlike terminal / IDE it
      // needs no default-app resolution — just open the directory in it.
      const config = action.config as AppLauncherActionConfig
      return runOpenApp('Finder', config.cwd ?? projectPath)
    }
    case 'ide': {
      const config = action.config as IdeActionConfig
      // A `.code-workspace` file opens as a workspace; `open -a` passes any path
      // to the app, so a file target works exactly like a folder. Falls back to
      // the cwd override / project path when no workspace file is set.
      return runOpenApp(defaultApps.ide, config.workspaceFile ?? config.cwd ?? projectPath)
    }
    default: {
      // Exhaustiveness guard: a new ACTION_TYPES entry without a branch fails here.
      const exhaustive: never = action.type
      return { ok: false, error: `Unknown action type: ${String(exhaustive)}` }
    }
  }
}
