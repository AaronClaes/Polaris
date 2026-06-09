import { IconDeviceLaptop, IconMoon, IconSun, type TablerIcon } from '@tabler/icons-react'
import { useSyncExternalStore } from 'react'

/** The theme preference the user picks. `auto` follows the OS setting. */
export type Theme = 'light' | 'dark' | 'auto'

/** The concrete appearance shown on screen (`auto` resolved against the OS). */
export type Appearance = 'light' | 'dark'

/** The theme options, in display order, each with its glyph. */
export const THEME_OPTIONS: { value: Theme; label: string; Icon: TablerIcon }[] = [
  { value: 'light', label: 'Light', Icon: IconSun },
  { value: 'dark', label: 'Dark', Icon: IconMoon },
  { value: 'auto', label: 'Auto', Icon: IconDeviceLaptop }
]

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

/** The concrete appearance a preference resolves to right now. */
function resolveAppearance(theme: Theme): Appearance {
  return isDark(theme) ? 'dark' : 'light'
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
  // While on `auto`, follow the OS as it flips between light and dark. Notify
  // subscribers too so anything keyed to the resolved appearance updates.
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (current === 'auto') {
      applyTheme('auto')
      emit()
    }
  })
}

export function setTheme(theme: Theme): void {
  current = theme
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
  emit()
}

/** Flip between explicit light and dark, based on the appearance shown now (so a
 *  press while on `auto` lands on the opposite of what the OS resolved to). */
export function toggleAppearance(): void {
  setTheme(resolveAppearance(current) === 'dark' ? 'light' : 'dark')
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Read the current preference reactively, paired with a setter. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => current)
  return [theme, setTheme]
}

/** The appearance shown right now, resolving `auto` against the OS. Re-renders
 *  when the preference changes or — while on `auto` — when the OS flips. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => resolveAppearance(current))
}
