import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { projects, tags } from '../../db/schema'
import { publicProcedure, router } from '..'

// A tag's label is required; the color is a palette key — validated loosely as a
// non-empty string, since the renderer constrains the actual choices.
const labelInput = z.string().trim().min(1, 'Label is required')

export const tagsRouter = router({
  // All tags in creation order — the list the settings manager and the header
  // toggle both render.
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(tags).orderBy(asc(tags.createdAt), asc(tags.id)).all()
  ),

  create: publicProcedure
    .input(z.object({ label: labelInput, color: z.string().trim().min(1).default('blue') }))
    .mutation(({ ctx, input }) =>
      ctx.db.insert(tags).values({ label: input.label, color: input.color }).returning().get()
    ),

  update: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        label: labelInput.optional(),
        color: z.string().trim().min(1).optional()
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...values } = input
      return ctx.db.update(tags).set(values).where(eq(tags.id, id)).returning().get()
    }),

  // Deleting a tag un-tags its projects rather than deleting them. The FK on
  // projects.tag_id is added via ALTER TABLE, which SQLite can't give an
  // ON DELETE action — and foreign_keys is ON — so a bare delete would fail while
  // any project still references it. Null those references first, in one
  // transaction, then drop the tag.
  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.transaction((tx) => {
      tx.update(projects).set({ tagId: null }).where(eq(projects.tagId, input.id)).run()
      tx.delete(tags).where(eq(tags.id, input.id)).run()
    })
    return { id: input.id }
  })
})
