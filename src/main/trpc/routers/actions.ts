import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DB } from '../../db/client'
import { type ActionConfig, projectActions, projects } from '../../db/schema'
import { runAction } from '../../services/action-runner'
import { publicProcedure, router } from '..'

// Per-type config payloads. Adding an action type means adding a variant here,
// to the `type` enum + ActionConfig union in the schema, and a runner branch.
const linkConfig = z.object({
  url: z.string().trim().url('Must be a valid URL')
})

const commandConfig = z.object({
  command: z.string().trim().min(1, 'Command is required'),
  // Optional cwd override; falls back to the project's default path at run time.
  cwd: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
})

const label = z.string().trim().min(1, 'Label is required')
const icon = z.string().trim().min(1).default('bolt')
// Optional group membership; null/omitted means a loose (ungrouped) action.
const groupId = z.number().int().nullish()

// Discriminated on `type` so each kind validates against its own config shape.
const createActionInput = z.discriminatedUnion('type', [
  z.object({
    projectId: z.number().int(),
    groupId,
    type: z.literal('link'),
    label,
    icon,
    config: linkConfig
  }),
  z.object({
    projectId: z.number().int(),
    groupId,
    type: z.literal('command'),
    label,
    icon,
    config: commandConfig
  })
])

/**
 * Next sort position within an action's container — its group, or (when
 * ungrouped) the project's loose pool. Ordering is scoped per container so a
 * group's members and the loose actions each number from zero.
 */
function nextSortOrder(db: DB, projectId: number, group: number | null | undefined): number {
  const where =
    group == null
      ? and(eq(projectActions.projectId, projectId), isNull(projectActions.groupId))
      : eq(projectActions.groupId, group)

  const max =
    db
      .select({ max: sql<number | null>`max(${projectActions.sortOrder})` })
      .from(projectActions)
      .where(where)
      .get()?.max ?? -1

  return max + 1
}

export const actionsRouter = router({
  create: publicProcedure.input(createActionInput).mutation(({ ctx, input }) => {
    return ctx.db
      .insert(projectActions)
      .values({
        projectId: input.projectId,
        groupId: input.groupId ?? null,
        type: input.type,
        label: input.label,
        icon: input.icon,
        config: input.config as ActionConfig,
        sortOrder: nextSortOrder(ctx.db, input.projectId, input.groupId)
      })
      .returning()
      .get()
  }),

  // Move an action into a group (or out, with groupId null). Re-appends it to
  // the end of the target container.
  setGroup: publicProcedure
    .input(z.object({ id: z.number().int(), groupId: z.number().int().nullable() }))
    .mutation(({ ctx, input }) => {
      const action = ctx.db
        .select({ projectId: projectActions.projectId })
        .from(projectActions)
        .where(eq(projectActions.id, input.id))
        .get()
      if (!action) return { id: input.id }

      return ctx.db
        .update(projectActions)
        .set({
          groupId: input.groupId,
          sortOrder: nextSortOrder(ctx.db, action.projectId, input.groupId)
        })
        .where(eq(projectActions.id, input.id))
        .returning()
        .get()
    }),

  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.delete(projectActions).where(eq(projectActions.id, input.id)).run()
    return { id: input.id }
  }),

  // Execute an action; resolves the project's default path for command cwd.
  run: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    const action = ctx.db.select().from(projectActions).where(eq(projectActions.id, input.id)).get()
    if (!action) return { ok: false, error: 'Action not found' }

    const project = ctx.db
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, action.projectId))
      .get()

    return runAction(action, project?.path ?? null)
  })
})
