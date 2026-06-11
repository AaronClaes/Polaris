import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { projects, todos } from '../../db/schema'
import { publicProcedure, router } from '..'

// Open before completed, then newest-created first within each group — the
// default arrangement the views render. Sorting is a planned addition; for now
// this single order serves the project tab and the global list alike.
const TODO_ORDER = [asc(todos.completed), desc(todos.createdAt)] as const

// The owning project, joined into the global list so each row can show which
// project it belongs to (and group/filter by it later).
const projectRef = {
  id: projects.id,
  name: projects.name,
  icon: projects.icon,
  color: projects.color
}

export const todosRouter = router({
  // A single project's todos.
  list: publicProcedure.input(z.object({ projectId: z.number().int() })).query(({ ctx, input }) =>
    ctx.db
      .select()
      .from(todos)
      .where(eq(todos.projectId, input.projectId))
      .orderBy(...TODO_ORDER)
      .all()
  ),

  // Every project's todos, each tagged with its owning project — for the global
  // "All todos" view and the nav's open-count badge.
  listAll: publicProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: todos.id,
        projectId: todos.projectId,
        title: todos.title,
        dueDate: todos.dueDate,
        completed: todos.completed,
        completedAt: todos.completedAt,
        createdAt: todos.createdAt,
        updatedAt: todos.updatedAt,
        project: projectRef
      })
      .from(todos)
      .innerJoin(projects, eq(todos.projectId, projects.id))
      .orderBy(...TODO_ORDER)
      .all()
  ),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        title: z.string().trim().min(1),
        dueDate: z.date().nullable().optional()
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.db
        .insert(todos)
        .values({
          projectId: input.projectId,
          title: input.title,
          dueDate: input.dueDate ?? null
        })
        .returning()
        .get()
    ),

  // Edit the title and/or due date (click-to-edit). Only the provided fields
  // change; `updatedAt` is bumped either way.
  update: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string().trim().min(1).optional(),
        dueDate: z.date().nullable().optional()
      })
    )
    .mutation(({ ctx, input }) => {
      const values: { updatedAt: Date; title?: string; dueDate?: Date | null } = {
        updatedAt: new Date()
      }
      if (input.title !== undefined) values.title = input.title
      if (input.dueDate !== undefined) values.dueDate = input.dueDate
      return ctx.db.update(todos).set(values).where(eq(todos.id, input.id)).returning().get()
    }),

  // Check/uncheck. Stamps `completedAt` on completion, clears it on reopen.
  setCompleted: publicProcedure
    .input(z.object({ id: z.number().int(), completed: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .update(todos)
        .set({
          completed: input.completed,
          completedAt: input.completed ? new Date() : null,
          updatedAt: new Date()
        })
        .where(eq(todos.id, input.id))
        .returning()
        .get()
    ),

  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.delete(todos).where(eq(todos.id, input.id)).run()
    return { id: input.id }
  })
})
