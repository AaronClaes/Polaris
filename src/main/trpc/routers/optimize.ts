import { z } from 'zod'
import { optimizeManager } from '../../services/optimize/manager'
import {
  modelSourceSchema,
  optimizeOptionsSchema,
  textureOverrideSchema
} from '../../services/optimize/types'
import { publicProcedure, router } from '..'

/**
 * Optimize/export models in the main process (sharp + the nodejs gltf-transform
 * stack), off the renderer. `run`/`export` do the work in a utilityProcess and
 * return only stats + a result id; the bytes stay in a temp file. `read` pulls a
 * result's bytes back (to load into the viewer), `write` saves it to a folder, and
 * `dispose` frees stale previews. Results are also freed when the window is destroyed.
 */
export const optimizeRouter = router({
  run: publicProcedure
    .input(
      z.object({
        source: modelSourceSchema,
        overrides: z.array(textureOverrideSchema).default([]),
        options: optimizeOptionsSchema
      })
    )
    .mutation(({ ctx, input }) =>
      optimizeManager.run(ctx.sender, input.source, input.overrides, input.options)
    ),

  export: publicProcedure
    .input(
      z.object({
        source: modelSourceSchema,
        overrides: z.array(textureOverrideSchema).default([])
      })
    )
    .mutation(({ ctx, input }) =>
      optimizeManager.export(ctx.sender, input.source, input.overrides)
    ),

  read: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => ({ base64: await optimizeManager.read(input.id) })),

  write: publicProcedure
    .input(z.object({ id: z.string(), dir: z.string(), name: z.string() }))
    .mutation(async ({ input }) => ({
      path: await optimizeManager.write(input.id, input.dir, input.name)
    })),

  dispose: publicProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await optimizeManager.dispose(input.ids)
      return { ok: true }
    })
})
