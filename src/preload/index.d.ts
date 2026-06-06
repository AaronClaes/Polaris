import type { ElectronAPI } from '@electron-toolkit/preload'
import type { PolarisApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: PolarisApi
  }
}
