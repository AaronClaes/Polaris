import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { publicProcedure, router } from '..'

/** Subfolder the model viewer writes its exported/optimized output into. */
const OUTPUT_DIR = 'polaris-optimized'

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
    }),

  // Open the native "Save as…" dialog and write the given bytes to the chosen
  // path. Bytes arrive base64-encoded (over the JSON IPC transport). Returns the
  // saved path, or null if the user cancels. Used to download extracted assets
  // (e.g. a model's textures) without ever touching the disk from the renderer.
  saveFile: publicProcedure
    .input(z.object({ filename: z.string(), base64: z.string() }))
    .mutation(async ({ input }) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options: Electron.SaveDialogOptions = { defaultPath: input.filename }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, Buffer.from(input.base64, 'base64'))
      return result.filePath
    }),

  // Write one exported/optimized model into `<dir>/polaris-optimized/<name>`,
  // creating the subfolder if needed and overwriting an existing same-named file.
  // The renderer picks `dir` once (via pickDirectory) and calls this per file so
  // bulk runs stream to disk one model at a time. Returns the written path.
  writeModelFile: publicProcedure
    .input(z.object({ dir: z.string(), name: z.string(), base64: z.string() }))
    .mutation(async ({ input }) => {
      const outDir = join(input.dir, OUTPUT_DIR)
      await mkdir(outDir, { recursive: true })
      const path = join(outDir, input.name)
      await writeFile(path, Buffer.from(input.base64, 'base64'))
      return path
    })
})
