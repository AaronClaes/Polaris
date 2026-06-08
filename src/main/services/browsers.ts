import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * A Chromium-based browser we know how to launch with a specific profile. Only
 * Chromium browsers expose a `--profile-directory` flag and a `Local State`
 * profile index, so Safari/Firefox aren't listed (no reliable CLI way to target
 * a profile). `userDataDir` is the directory holding `Local State` and the
 * per-profile folders — note it's not uniform (Dia nests it under `User Data`).
 */
export interface BrowserRegistryEntry {
  key: string
  name: string
  /** The `.app` bundle; its existence is how we detect "installed". */
  appPath: string
  /** Executable inside the bundle, launched directly with the profile flag. */
  binaryPath: string
  /** Chromium user-data root: contains `Local State` + the profile dirs. */
  userDataDir: string
  /**
   * Whether opening a URL in a chosen profile actually works. True for stock
   * Chromium (Chrome, Brave, Edge, …), where a second `--profile-directory`
   * process forwards the URL to the running instance. False for Browser Company
   * apps (Dia, Arc): they enforce a single instance — a second launch just shows
   * an "already open" dialog — and expose no CLI flag, URL scheme, or AppleScript
   * profile hook, so a profile can't be targeted from outside the app.
   */
  supportsProfiles: boolean
}

/** A profile within a browser. `directory` is the on-disk folder name and the
 * value passed to `--profile-directory`; `name` is the label shown in the UI. */
export interface BrowserProfile {
  directory: string
  name: string
}

const appSupport = join(homedir(), 'Library', 'Application Support')

function mac(
  key: string,
  name: string,
  appName: string,
  binaryName: string,
  userDataParts: string[],
  supportsProfiles = true
): BrowserRegistryEntry {
  const appPath = `/Applications/${appName}.app`
  return {
    key,
    name,
    appPath,
    binaryPath: join(appPath, 'Contents', 'MacOS', binaryName),
    userDataDir: join(appSupport, ...userDataParts),
    supportsProfiles
  }
}

/** Known Chromium browsers, in display order. `key` is the stable identifier
 * persisted in the `browsers` table and referenced by link actions. Dia and Arc
 * are listed so they can be recognized, but flagged unsupported for profiles
 * (see `supportsProfiles`). */
const REGISTRY: BrowserRegistryEntry[] = [
  mac('chrome', 'Google Chrome', 'Google Chrome', 'Google Chrome', ['Google', 'Chrome']),
  mac('brave', 'Brave', 'Brave Browser', 'Brave Browser', ['BraveSoftware', 'Brave-Browser']),
  mac('edge', 'Microsoft Edge', 'Microsoft Edge', 'Microsoft Edge', ['Microsoft Edge']),
  mac('vivaldi', 'Vivaldi', 'Vivaldi', 'Vivaldi', ['Vivaldi']),
  mac('chromium', 'Chromium', 'Chromium', 'Chromium', ['Chromium']),
  mac('dia', 'Dia', 'Dia', 'Dia', ['Dia', 'User Data'], false),
  mac('arc', 'Arc', 'Arc', 'Arc', ['Arc', 'User Data'], false)
]

/** Look up a registry entry by its key. */
export function resolveBrowser(key: string): BrowserRegistryEntry | undefined {
  return REGISTRY.find((entry) => entry.key === key)
}

/** Registry entries whose app bundle is present on this machine. */
export function detectInstalled(): BrowserRegistryEntry[] {
  return REGISTRY.filter((entry) => existsSync(entry.appPath))
}

/**
 * Read a browser's profiles from its `Local State` file. Returns [] on any
 * failure (browser not installed, file locked or malformed), so callers can
 * treat "no profiles" uniformly. Ordered by Chromium's own `profiles_order`.
 */
export function readProfiles(userDataDir: string): BrowserProfile[] {
  try {
    const state = JSON.parse(readFileSync(join(userDataDir, 'Local State'), 'utf-8'))
    const cache: Record<string, { name?: string }> = state?.profile?.info_cache ?? {}
    const order: string[] = state?.profile?.profiles_order ?? Object.keys(cache)
    return order
      .filter((dir) => dir in cache)
      .map((dir) => ({ directory: dir, name: cache[dir]?.name ?? dir }))
  } catch {
    return []
  }
}
