import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { actionGroups, projectActions, projects } from '../../db/schema'
import { maxRootSortOrder } from '../../db/sort-order'
import { runAction } from '../../services/action-runner'
import { publicProcedure, router } from '..'

const name = z.string().trim().min(1, 'Name is required')
const icon = z.string().trim().min(1).default('stack')

export const groupsRouter = router({
  create: publicProcedure
    .input(z.object({ projectId: z.number().int(), name, icon }))
    .mutation(({ ctx, input }) => {
      return ctx.db
        .insert(actionGroups)
        .values({
          projectId: input.projectId,
          name: input.name,
          icon: input.icon,
          // Append to the end of the project's root list (shared with loose actions).
          sortOrder: maxRootSortOrder(ctx.db, input.projectId) + 1
        })
        .returning()
        .get()
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: name.optional(),
        icon: icon.optional(),
        pinned: z.boolean().optional()
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...values } = input
      return ctx.db
        .update(actionGroups)
        .set(values)
        .where(eq(actionGroups.id, id))
        .returning()
        .get()
    }),

  // Deleting a group ungroups its actions (FK onDelete: 'set null'), never
  // deletes them. Requires `foreign_keys = ON` (set in the db client).
  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.delete(actionGroups).where(eq(actionGroups.id, input.id)).run()
    return { id: input.id }
  }),

  // Persist a drag reorder of the project's groups in one transaction.
  reorder: publicProcedure
    .input(
      z.object({
        items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() }))
      })
    )
    .mutation(({ ctx, input }) => {
      ctx.db.transaction((tx) => {
        for (const item of input.items) {
          tx.update(actionGroups)
            .set({ sortOrder: item.sortOrder })
            .where(eq(actionGroups.id, item.id))
            .run()
        }
      })
      return { ok: true }
    }),

  // Launch every action in the group at once. Each runs independently; results
  // are aggregated so the UI can report partial failure.
  run: publicProcedure
    .input(z.object({ groupId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const group = ctx.db
        .select()
        .from(actionGroups)
        .where(eq(actionGroups.id, input.groupId))
        .get()
      if (!group) return { ok: false, results: [] }

      const members = ctx.db
        .select()
        .from(projectActions)
        .where(eq(projectActions.groupId, input.groupId))
        .orderBy(asc(projectActions.sortOrder), asc(projectActions.id))
        .all()

      const projectPath =
        ctx.db
          .select({ path: projects.path })
          .from(projects)
          .where(eq(projects.id, group.projectId))
          .get()?.path ?? null

      const results = await Promise.all(
        members.map(async (action) => {
          const result = await runAction(action, projectPath)
          return {
            id: action.id,
            label: action.label,
            ok: result.ok,
            error: result.error
          }
        })
      )

      return { ok: results.every((r) => r.ok), results }
    })
})
