import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'
import { createIPCHandler } from 'electron-trpc-experimental/main'
import icon from '../../resources/icon.png?asset'
import { runMigrations } from './db/migrate'
import { optimizeManager } from './services/optimize/manager'
import { setIpcHandler } from './tool-windows'
import { createContext } from './trpc'
import { appRouter } from './trpc/router'
import { manage as manageWindowState, read as readWindowState } from './window-state'

let mainWindow: BrowserWindow | null = null
let ipcHandler: ReturnType<typeof createIPCHandler> | null = null

function createWindow(): void {
  const windowState = readWindowState()
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    ...(windowState.x !== undefined && windowState.y !== undefined
      ? { x: windowState.x, y: windowState.y }
      : {}),
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // Restore maximize on top of the normal bounds, while still hidden, so the
  // window appears already maximized rather than resizing into place.
  if (windowState.isMaximized) mainWindow.maximize()
  manageWindowState(mainWindow)

  // Wire the typed tRPC-over-IPC handler to this window (attach extra windows
  // to the existing handler rather than recreating it).
  if (!ipcHandler) {
    ipcHandler = createIPCHandler({
      router: appRouter,
      createContext,
      windows: [mainWindow]
    })
    // Hand the handler to the tool-window manager so popped-out tools attach to
    // it and get the same tRPC-over-IPC bridge as the main window.
    setIpcHandler(ipcHandler)
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.aaronclaes.polaris')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Bring the schema up to date before opening any window.
  runMigrations()

  // Reset the optimize service's temp result dir (clears anything orphaned by a
  // previous crash); the worker itself is spawned lazily on first use.
  void optimizeManager.init()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Tear down the optimize worker and wipe its temp results on quit.
app.on('will-quit', () => {
  void optimizeManager.shutdown()
})
