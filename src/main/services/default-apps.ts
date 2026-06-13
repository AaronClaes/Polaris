import { existsSync } from 'node:fs'
import { nativeImage } from 'electron'
import type { DB } from '../db/client'
import { settings } from '../db/schema'

/**
 * A launchable external app the user can pick as their default terminal or IDE.
 * `key` is the stable identifier persisted in {@link settings}; `appName` is the
 * macOS application name handed to `open -a` (see the action runner); `appPath`
 * is the `.app` bundle, used to extract the app's icon. Add an entry to
 * {@link TERMINALS} / {@link IDES} to support another app.
 */
export interface ExternalApp {
  key: string
  /** Display label shown in the settings dropdown. */
  name: string
  /** macOS application name passed to `open -a`. */
  appName: string
  /** Absolute `.app` bundle path, for icon extraction. */
  appPath: string
}

/** Supported terminals, in display order. The first is the fallback default. */
export const TERMINALS: ExternalApp[] = [
  {
    key: 'terminal',
    name: 'Terminal',
    appName: 'Terminal',
    appPath: '/System/Applications/Utilities/Terminal.app'
  },
  { key: 'warp', name: 'Warp', appName: 'Warp', appPath: '/Applications/Warp.app' }
]

/** Supported IDEs, in display order. The first is the fallback default. */
export const IDES: ExternalApp[] = [
  {
    key: 'vscode',
    name: 'Visual Studio Code',
    appName: 'Visual Studio Code',
    appPath: '/Applications/Visual Studio Code.app'
  },
  { key: 'cursor', name: 'Cursor', appName: 'Cursor', appPath: '/Applications/Cursor.app' }
]

/**
 * Finder — the macOS file browser. Unlike the terminal / IDE it isn't
 * user-selectable (there's only one Finder), so it's a fixed entry rather than a
 * registry. Here purely so {@link findApp} can resolve its `.app` for the
 * `finder` action's icon; the runner opens "Finder" by name directly. The key
 * mirrors the renderer's `FINDER_APP_KEY`.
 */
export const FINDER_APP: ExternalApp = {
  key: 'finder',
  name: 'Finder',
  appName: 'Finder',
  appPath: '/System/Library/CoreServices/Finder.app'
}

/** The settings-table keys the chosen app registry keys are stored under. */
export const DEFAULT_APP_SETTING_KEYS = {
  terminal: 'defaultTerminal',
  ide: 'defaultIde'
} as const

/** Resolve a stored terminal key to its registry entry, falling back to the
 *  first supported terminal when unset or unknown (e.g. an app since removed). */
export function resolveTerminal(key: string | null | undefined): ExternalApp {
  return TERMINALS.find((app) => app.key === key) ?? TERMINALS[0]
}

/** Resolve a stored IDE key to its registry entry, falling back to the first
 *  supported IDE when unset or unknown. */
export function resolveIde(key: string | null | undefined): ExternalApp {
  return IDES.find((app) => app.key === key) ?? IDES[0]
}

/** The currently selected default terminal + IDE, each resolved (with fallback)
 *  from the persisted settings. Used by the action runner and the settings UI. */
export function readDefaultApps(db: DB): { terminal: ExternalApp; ide: ExternalApp } {
  const byKey = new Map(
    db
      .select()
      .from(settings)
      .all()
      .map((row) => [row.key, row.value])
  )
  return {
    terminal: resolveTerminal(byKey.get(DEFAULT_APP_SETTING_KEYS.terminal)),
    ide: resolveIde(byKey.get(DEFAULT_APP_SETTING_KEYS.ide))
  }
}

/** Look up a supported app (terminal, IDE, or Finder) by its registry key. */
export function findApp(key: string): ExternalApp | undefined {
  return [...TERMINALS, ...IDES, FINDER_APP].find((entry) => entry.key === key)
}

/**
 * The macOS icon for a supported app, as a PNG data URL — Null when the key is
 * unknown or the app isn't installed, so the UI can fall back to a glyph. The
 * renderer caches the result (long stale time + persisted), like favicons.
 *
 * Uses QuickLook thumbnailing rather than `app.getFileIcon`: on macOS 26 /
 * Electron 39 the latter hard-crashes (SIGTRAP) at a usable size, and returns a
 * generic placeholder at smaller ones. `createThumbnailFromPath` returns the
 * real icon at a size we control.
 */
export async function readAppIcon(key: string): Promise<{ dataUrl: string } | null> {
  const entry = findApp(key)
  if (!entry || !existsSync(entry.appPath)) return null
  try {
    const image = await nativeImage.createThumbnailFromPath(entry.appPath, {
      width: 64,
      height: 64
    })
    if (image.isEmpty()) return null
    return { dataUrl: image.toDataURL() }
  } catch {
    return null
  }
}
