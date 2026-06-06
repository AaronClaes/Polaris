import { desc } from 'drizzle-orm'
import { z } from 'zod'
import { projects } from '../../db/schema'
import { publicProcedure, router } from '..'

// Optional free-text field — trims and collapses empty strings to null.
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))

export const createProjectInput = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  repoOwner: optionalText,
  repoName: optionalText,
  localPath: optionalText,
  stagingUrl: optionalText,
  productionUrl: optionalText,
  hostingUrl: optionalText,
  notes: optionalText
})

export const projectsRouter = router({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(projects).orderBy(desc(projects.createdAt)).all()
  ),

  create: publicProcedure
    .input(createProjectInput)
    .mutation(({ ctx, input }) => ctx.db.insert(projects).values(input).returning().get())
})
