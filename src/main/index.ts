import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import { createIPCHandler } from 'electron-trpc-experimental/main'
import icon from '../../resources/icon.png?asset'
import { runMigrations } from './db/migrate'
import { createContext } from './trpc'
import { appRouter } from './trpc/router'

// OS-global shortcut to summon the command palette. Kept off Cmd+K (too common)
// — the renderer also binds a local Cmd+K when focused.
const COMMAND_PALETTE_SHORTCUT = 'CommandOrControl+Shift+P'

let mainWindow: BrowserWindow | null = null
let ipcHandler: ReturnType<typeof createIPCHandler> | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Wire the typed tRPC-over-IPC handler to this window (attach extra windows
  // to the existing handler rather than recreating it).
  if (!ipcHandler) {
    ipcHandler = createIPCHandler({
      router: appRouter,
      createContext,
      windows: [mainWindow]
    })
  } else {
    ipcHandler.attachWindow(mainWindow)
  }

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR in dev (electron-vite renderer URL); built file otherwise.
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (is.dev && rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerGlobalShortcuts(): void {
  globalShortcut.register(COMMAND_PALETTE_SHORTCUT, () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.webContents.send('command-palette:toggle')
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.aaronclaes.polaris')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Bring the schema up to date before opening any window.
  runMigrations()

  createWindow()
  registerGlobalShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
