import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type ProjectAction, projectActions, projects } from '../../db/schema'
import { publicProcedure, router } from '..'

// Optional free-text field — trims and collapses empty strings to null.
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))

export const createProjectInput = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: optionalText,
  icon: z.string().trim().min(1).default('folder'),
  color: z.string().trim().min(1).default('blue'),
  path: optionalText
})

export const updateProjectInput = createProjectInput.partial().extend({
  id: z.number().int()
})

export const projectsRouter = router({
  // Projects newest-first, each with its actions in manual sort order. Actions
  // are fetched in one pass and grouped in memory to avoid an N+1 per project.
  list: publicProcedure.query(({ ctx }) => {
    const rows = ctx.db.select().from(projects).orderBy(desc(projects.createdAt)).all()
    const actions = ctx.db
      .select()
      .from(projectActions)
      .orderBy(asc(projectActions.sortOrder), asc(projectActions.id))
      .all()

    const byProject = new Map<number, ProjectAction[]>()
    for (const action of actions) {
      const list = byProject.get(action.projectId)
      if (list) list.push(action)
      else byProject.set(action.projectId, [action])
    }

    return rows.map((project) => ({
      ...project,
      actions: byProject.get(project.id) ?? []
    }))
  }),

  create: publicProcedure
    .input(createProjectInput)
    .mutation(({ ctx, input }) => ctx.db.insert(projects).values(input).returning().get()),

  update: publicProcedure.input(updateProjectInput).mutation(({ ctx, input }) => {
    const { id, ...values } = input
    return ctx.db.update(projects).set(values).where(eq(projects.id, id)).returning().get()
  }),

  // Cascades to the project's actions (FK onDelete: 'cascade' + foreign_keys ON).
  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.delete(projects).where(eq(projects.id, input.id)).run()
    return { id: input.id }
  })
})
