import { BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { publicProcedure, router } from '..'

export const dialogRouter = router({
  // Open the native folder picker and return the chosen absolute path, or null
  // if the user cancels. Attached to the focused window so it presents as a
  // sheet on macOS. `defaultPath` seeds the starting directory (the current
  // value of whatever field is being edited).
  pickDirectory: publicProcedure
    .input(z.object({ defaultPath: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: input?.defaultPath || undefined
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })
})
