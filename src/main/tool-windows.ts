import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, shell } from 'electron'
import type { createIPCHandler } from 'electron-trpc-experimental/main'

type IpcHandler = ReturnType<typeof createIPCHandler>

/**
 * The shared tRPC-over-IPC handler, set once from the app entry after it's
 * created for the main window. Each tool window is attached to it so tRPC works
 * inside the window exactly as it does in the main one. Kept as a module
 * reference rather than threaded through tRPC context because the handler
 * outlives any single request.
 */
let ipcHandler: IpcHandler | null = null

export function setIpcHandler(handler: IpcHandler): void {
  ipcHandler = handler
}

/**
 * One window per tool: launching a tool that's already open in a window focuses
 * the existing window instead of spawning a duplicate. Entries are dropped when
 * their window closes.
 */
const openWindows = new Map<string, BrowserWindow>()

export interface ToolWindowOptions {
  id: string
  title: string
  width: number
  height: number
}

/**
 * Open a tool in its own chromeless window (or focus the one already open). The
 * renderer owns the tool registry, so it passes the title and size; main just
 * spawns a window pointed at the tool's window route. The window reuses the same
 * preload + hiddenInset chrome as the main window, so it gets the tRPC bridge
 * and the macOS traffic-light insets the slim title bar is laid out around.
 */
export function openToolWindow(options: ToolWindowOptions): void {
  const existing = openWindows.get(options.id)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    show: false,
    title: options.title,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  openWindows.set(options.id, win)
  ipcHandler?.attachWindow(win)

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => openWindows.delete(options.id))

  // Same as the main window: in-app window.open / external links go to the
  // browser, not a new Electron window.
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Hash history (see the renderer router) addresses the chromeless tool route
  // via the URL fragment in both dev and prod.
  const hash = `/tool-window/${options.id}`
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (is.dev && rendererUrl) {
    win.loadURL(`${rendererUrl}#${hash}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

/**
 * Pin/unpin a tool window so it floats over other apps' windows on the normal
 * desktop. The `'floating'` level is the gentle one — above ordinary windows
 * but not over the menu bar or fullscreen apps, which is all we want here.
 * Returns the resulting state (false if the window is gone). Keyed by tool id
 * since that's how {@link openWindows} already tracks each window.
 */
export function setToolWindowAlwaysOnTop(id: string, value: boolean): boolean {
  const win = openWindows.get(id)
  if (!win || win.isDestroyed()) return false
  win.setAlwaysOnTop(value, 'floating')
  return win.isAlwaysOnTop()
}
