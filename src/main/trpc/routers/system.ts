import { z } from 'zod'
import { openInEditor } from '../../services/system-launcher'
import { publicProcedure, router } from '..'

export const systemRouter = router({
  // Proves process-spawning end-to-end: open a local path in the editor.
  openInEditor: publicProcedure
    .input(z.object({ path: z.string().trim().min(1, 'A path is required') }))
    .mutation(({ input }) => openInEditor(input.path))
})
