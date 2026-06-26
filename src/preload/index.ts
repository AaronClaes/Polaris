import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, webUtils } from 'electron'
import { exposeElectronTRPC } from 'electron-trpc-experimental/preload'

// Expose the electron-trpc bridge (window.electronTRPC) the renderer link reads.
process.once('loaded', () => {
  exposeElectronTRPC()
})

// Polaris-specific renderer API (outside of tRPC).
const api = {
  // Resolve a dropped/opened File to its absolute path so the main process can read
  // it directly. webUtils.getPathForFile is the supported replacement for the
  // removed File.path; it must run here in the preload (it needs the File object).
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
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
