import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import { exposeElectronTRPC } from 'electron-trpc-experimental/preload'

// Expose the electron-trpc bridge (window.electronTRPC) the renderer link reads.
process.once('loaded', () => {
  exposeElectronTRPC()
})

// Polaris-specific renderer API.
const api = {
  /** Subscribe to the global command-palette toggle. Returns an unsubscribe. */
  onCommandPalette(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('command-palette:toggle', listener)
    return () => ipcRenderer.removeListener('command-palette:toggle', listener)
  }
}

export type PolarisApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // contextIsolation is enabled in this app, so this branch is unused; the
  // globalThis cast keeps it type-safe under both the node and DOM lib configs.
  const globalWindow = globalThis as typeof globalThis & {
    electron: typeof electronAPI
    api: typeof api
  }
  globalWindow.electron = electronAPI
  globalWindow.api = api
}
