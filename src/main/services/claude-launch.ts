import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { execa } from 'execa'
import type { DB } from '../db/client'
import { settings } from '../db/schema'
import type { ExternalApp } from './default-apps'
import { shellQuote } from './worktrees'

/**
 * Starting a Claude Code session in a worktree — the "hand off" half of the
 * worktrees feature. Polaris never runs the work itself: it opens the user's
 * terminal at the worktree with `claude` already running (interactive, never
 * `-p`), optionally seeded with a prompt, model, and permission mode.
 */

/** Model choices for the `--model` flag. `''` means no flag — the user's own
 *  claude config decides. Values are CLI aliases for the latest model of each
 *  tier, so this list doesn't chase individual releases. */
export const CLAUDE_MODELS = [
  { value: '', label: 'Default' },
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' }
]

/** Permission-mode choices for `--permission-mode`. `''` means no flag. */
export const CLAUDE_PERMISSION_MODES = [
  { value: '', label: 'Default' },
  { value: 'auto', label: 'Auto' },
  { value: 'plan', label: 'Plan' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'dontAsk', label: "Don't ask" },
  { value: 'bypassPermissions', label: 'Bypass permissions' }
]

/** Settings-table keys for the last-used launch flags (global, not per-repo —
 *  model/mode are a personal preference, not a repo property). */
const MODEL_SETTING_KEY = 'claudeLaunchModel'
const PERMISSION_MODE_SETTING_KEY = 'claudeLaunchPermissionMode'

function readSetting(db: DB, key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? ''
}

function writeSetting(db: DB, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`(unixepoch())` } })
    .run()
}

/** The remembered launch flags. A stored value that's no longer in its registry
 *  (e.g. a retired model alias) reads as Default rather than reaching the CLI. */
export function readClaudeLaunchDefaults(db: DB): { model: string; permissionMode: string } {
  const model = readSetting(db, MODEL_SETTING_KEY)
  const permissionMode = readSetting(db, PERMISSION_MODE_SETTING_KEY)
  return {
    model: CLAUDE_MODELS.some((entry) => entry.value === model) ? model : '',
    permissionMode: CLAUDE_PERMISSION_MODES.some((entry) => entry.value === permissionMode)
      ? permissionMode
      : ''
  }
}

export function writeClaudeLaunchDefaults(
  db: DB,
  { model, permissionMode }: { model: string; permissionMode: string }
): void {
  writeSetting(db, MODEL_SETTING_KEY, model)
  writeSetting(db, PERMISSION_MODE_SETTING_KEY, permissionMode)
}

/**
 * Resolve launch flags for a mutation: omitted values fall back to the
 * remembered defaults, present values are validated against the registries and
 * become the new remembered defaults. Shared by `worktrees.startClaude` and the
 * create job's Claude handoff so every caller behaves identically. Throws on
 * unknown values — callers run this synchronously so bad input fails the
 * mutation, never a background job.
 */
export function resolveClaudeLaunchFlags(
  db: DB,
  input: { model?: string; permissionMode?: string }
): { model: string; permissionMode: string } {
  const stored = readClaudeLaunchDefaults(db)
  const model = input.model ?? stored.model
  const permissionMode = input.permissionMode ?? stored.permissionMode
  if (!CLAUDE_MODELS.some((entry) => entry.value === model)) {
    throw new Error(`Unknown Claude model: ${model}`)
  }
  if (!CLAUDE_PERMISSION_MODES.some((entry) => entry.value === permissionMode)) {
    throw new Error(`Unknown permission mode: ${permissionMode}`)
  }
  if (input.model !== undefined || input.permissionMode !== undefined) {
    writeClaudeLaunchDefaults(db, { model, permissionMode })
  }
  return { model, permissionMode }
}

/** The shell command that starts the session. Model/mode values come from the
 *  registries above (validated at the router), so only the free-text prompt
 *  needs quoting. */
export function buildClaudeCommand({
  prompt,
  model,
  permissionMode
}: {
  prompt?: string
  model: string
  permissionMode: string
}): string {
  const parts = ['claude']
  if (model) parts.push('--model', model)
  if (permissionMode) parts.push('--permission-mode', permissionMode)
  const trimmed = prompt?.trim()
  if (trimmed) parts.push(shellQuote(trimmed))
  return parts.join(' ')
}

/**
 * Open the user's terminal at `cwd` with `command` running. Warp can't be told
 * "open here and run this" directly (its `warp://action/new_tab` URI only sets
 * the folder), so Polaris writes a Tab Config — Warp's file format for exactly
 * this — into Warp's own config dir (configs are only resolved from there, by
 * filename) and triggers it via the `warp://tab_config/<name>` URI. One
 * Polaris-owned file, overwritten per launch. TOML basic strings escape exactly
 * like JSON, so JSON.stringify handles that layer.
 */
export async function startClaudeInTerminal({
  terminal,
  cwd,
  command
}: {
  terminal: ExternalApp
  cwd: string
  command: string
}): Promise<void> {
  if (terminal.key === 'warp') {
    const dir = join(homedir(), '.warp', 'tab_configs')
    await mkdir(dir, { recursive: true })
    const config = [
      'name = "polaris-claude"',
      'title = "Claude"',
      '',
      '[[panes]]',
      'id = "main"',
      'type = "terminal"',
      `directory = ${JSON.stringify(cwd)}`,
      `commands = [${JSON.stringify(command)}]`,
      ''
    ].join('\n')
    await writeFile(join(dir, 'polaris-claude.toml'), config)

    const result = await execa('open', ['warp://tab_config/polaris-claude'], {
      reject: false,
      timeout: 10_000
    })
    if (result.exitCode !== 0) {
      throw new Error(`Could not open Warp: ${result.stderr.trim() || 'is it installed?'}`)
    }
    return
  }

  if (terminal.key === 'terminal') {
    // Terminal.app has no config-file mechanism but is AppleScript-scriptable.
    const script = `cd ${shellQuote(cwd)} && ${command}`
    const appleQuoted = `"${script.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
    const result = await execa(
      'osascript',
      [
        '-e',
        'tell application "Terminal"',
        '-e',
        'activate',
        '-e',
        `do script ${appleQuoted}`,
        '-e',
        'end tell'
      ],
      { reject: false, timeout: 10_000 }
    )
    if (result.exitCode !== 0) {
      throw new Error(`Could not open Terminal: ${result.stderr.trim() || 'osascript failed'}`)
    }
    return
  }

  throw new Error(`Starting Claude in ${terminal.name} isn't supported yet.`)
}
