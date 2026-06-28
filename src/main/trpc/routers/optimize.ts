import { z } from 'zod'
import { optimizeManager } from '../../services/optimize/manager'
import {
  imageOptimizeOptionsSchema,
  imageSourceSchema,
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

  // Optimize a single image (texture viewer) — shares the result cache with model
  // jobs, so its result id flows through read/write/dispose unchanged.
  runImage: publicProcedure
    .input(z.object({ source: imageSourceSchema, options: imageOptimizeOptionsSchema }))
    .mutation(({ ctx, input }) => optimizeManager.runImage(ctx.sender, input.source, input.options)),

  // Write caller-supplied bytes into a chosen folder — for exporting original
  // (un-optimized) textures the renderer already holds, without a temp result.
  writeFile: publicProcedure
    .input(z.object({ dir: z.string(), name: z.string(), base64: z.string() }))
    .mutation(async ({ input }) => ({
      path: await optimizeManager.writeBytes(input.dir, input.name, input.base64)
    })),

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
