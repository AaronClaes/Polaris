import { useSyncExternalStore } from 'react'

/** The theme preference the user picks. `auto` follows the OS setting. */
export type Theme = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'polaris.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'auto'
}

/** The persisted preference, defaulting to `auto` (no choice made yet). */
function readStored(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  return isTheme(stored) ? stored : 'auto'
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

/** Whether a preference resolves to a dark appearance right now. */
function isDark(theme: Theme): boolean {
  return theme === 'dark' || (theme === 'auto' && systemPrefersDark())
}

/**
 * Reflect a preference onto the document: the `.dark` class drives our token
 * overrides (see globals.css), and `color-scheme` keeps native widgets
 * (scrollbars, form controls) in step.
 */
function applyTheme(theme: Theme): void {
  const dark = isDark(theme)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

let current = readStored()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * Apply the stored theme and start tracking system changes. Call once, as early
 * as possible (before first paint), to avoid a flash of the wrong theme. The CSP
 * blocks inline scripts, so this runs from the renderer entry rather than a
 * blocking <script> in the HTML head.
 */
export function initTheme(): void {
  applyTheme(current)
  // While on `auto`, follow the OS as it flips between light and dark.
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (current === 'auto') applyTheme('auto')
  })
}

export function setTheme(theme: Theme): void {
  current = theme
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
  emit()
}

/** Read the current preference reactively, paired with a setter. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    () => current
  )
  return [theme, setTheme]
}
