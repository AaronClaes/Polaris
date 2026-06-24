import { z } from 'zod'
import { openToolWindow } from '../../tool-windows'
import { publicProcedure, router } from '..'

export const toolsRouter = router({
  // Launch a tool in its own window (or focus the existing one). The renderer
  // owns the tool registry, so it passes the window title and size; main only
  // needs the id to point the window at the right tool route.
  openWindow: publicProcedure
    .input(
      z.object({
        toolId: z.string(),
        title: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive()
      })
    )
    .mutation(({ input }) => {
      openToolWindow({
        id: input.toolId,
        title: input.title,
        width: input.width,
        height: input.height
      })
      return { ok: true as const }
    })
})
