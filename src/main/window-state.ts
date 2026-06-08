import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow, screen } from 'electron'

/**
 * Persisted geometry of the main window. `x`/`y` are omitted when the window
 * should open centered (first launch, or a saved position that no longer lands
 * on a connected display). `isMaximized` is stored separately from the bounds:
 * we keep the *normal* (un-maximized) rectangle so un-maximizing has somewhere
 * sensible to go, and re-apply maximize on top of it.
 */
export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

/** Opening size on first launch / when saved state is unusable. */
const DEFAULT_STATE: WindowState = {
  width: 1100,
  height: 760,
  isMaximized: false
}

/** `move`/`resize` fire continuously while dragging; coalesce the writes. */
const SAVE_DEBOUNCE_MS = 400

/** How much of the window must overlap a display's work area to count as
 * reachable — enough title bar to grab and drag back into view. */
const MIN_VISIBLE_X = 100
const MIN_VISIBLE_Y = 50

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** Whether a saved position still lands on one of the currently-connected
 * displays. A centered window (no x/y) is always fine. Guards the off-screen
 * case: bounds saved on a monitor that's since been unplugged, or on a larger
 * display than the one now attached, would otherwise restore out of reach. */
function isVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return true
  const { x, y, width, height } = state
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const overlapX = Math.min(x + width, area.x + area.width) - Math.max(x, area.x)
    const overlapY = Math.min(y + height, area.y + area.height) - Math.max(y, area.y)
    return overlapX >= MIN_VISIBLE_X && overlapY >= MIN_VISIBLE_Y
  })
}

/**
 * Read the saved window state, falling back to defaults on a missing, corrupt,
 * or off-screen file — never throws, so a bad file can't stop the window from
 * opening. A saved-but-now-invisible position is dropped (the window centers)
 * while its size is kept.
 */
export function read(): WindowState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf-8')) as Partial<WindowState>
    const width = Number(parsed.width)
    const height = Number(parsed.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return DEFAULT_STATE
    }
    const x = Number.isFinite(Number(parsed.x)) ? Number(parsed.x) : undefined
    const y = Number.isFinite(Number(parsed.y)) ? Number(parsed.y) : undefined
    const state: WindowState = {
      width,
      height,
      x,
      y,
      isMaximized: parsed.isMaximized === true
    }
    if (!isVisible(state)) {
      state.x = undefined
      state.y = undefined
    }
    return state
  } catch {
    return DEFAULT_STATE
  }
}

function captureState(win: BrowserWindow): WindowState {
  // getNormalBounds() is the un-maximized rectangle, so a window saved while
  // maximized still restores to a sane size when the user un-maximizes.
  const bounds = win.getNormalBounds()
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: win.isMaximized()
  }
}

function write(state: WindowState): void {
  try {
    writeFileSync(statePath(), JSON.stringify(state))
  } catch {
    // Persisting geometry is best-effort; a failed write must never surface.
  }
}

/**
 * Track a window's geometry and persist it. The latest bounds are kept in memory
 * — refreshed only at moments the bounds API is reliable (an active move/resize,
 * or the one-shot completion events) — and the `close` handler writes that
 * remembered value rather than reading fresh.
 *
 * Why not read at close: `getNormalBounds()` inside the `close` handler is
 * unreliable on macOS right after a cross-display drag — it can report the
 * pre-drag position — so a window dragged to another display and closed quickly
 * would persist the wrong spot. macOS fires one-shot `moved`/`resized` events
 * the instant a drag ends; we capture-and-save on those so the final position is
 * stored immediately, even if the window is closed before the debounce fires.
 * The debounced `move`/`resize` writes cover live updates and platforms without
 * `moved`.
 *
 * Fullscreen is intentionally not persisted as a restore target: while
 * fullscreen we stop refreshing the tracked bounds (keeping the last windowed
 * ones) rather than re-entering fullscreen on launch, which is jarring on macOS
 * Spaces.
 */
export function manage(win: BrowserWindow): void {
  let latest = captureState(win)
  let timer: ReturnType<typeof setTimeout> | null = null

  const remember = (): void => {
    if (!win.isFullScreen()) latest = captureState(win)
  }
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    write(latest)
  }
  const rememberAndSave = (): void => {
    remember()
    save()
  }
  const scheduleSave = (): void => {
    remember()
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  win.on('move', scheduleSave)
  win.on('resize', scheduleSave)
  // macOS-only one-shot events: persist the final position the instant a drag or
  // resize ends, so it survives a close before the debounce would have fired.
  win.on('moved', rememberAndSave)
  win.on('resized', rememberAndSave)
  // Flush the last *remembered* bounds — not a fresh, close-time read (see above).
  win.on('close', save)
}
