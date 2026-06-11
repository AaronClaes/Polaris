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
    }),

  // Open the native file picker and return the chosen absolute path, or null if
  // the user cancels. Like `pickDirectory`, but for a single file — `filters`
  // restricts the selectable types (e.g. `.code-workspace` for an IDE action).
  pickFile: publicProcedure
    .input(
      z
        .object({
          defaultPath: z.string().optional(),
          filters: z
            .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
            .optional()
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options: Electron.OpenDialogOptions = {
        // `showHiddenFiles` surfaces dotfolders by default — workspace files
        // commonly live in a hidden `.vscode/` directory.
        properties: ['openFile', 'showHiddenFiles'],
        defaultPath: input?.defaultPath || undefined,
        filters: input?.filters
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })
})
