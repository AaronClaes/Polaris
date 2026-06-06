import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
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

// Discriminated on `type` so each kind validates against its own config shape.
const createActionInput = z.discriminatedUnion('type', [
  z.object({
    projectId: z.number().int(),
    type: z.literal('link'),
    label,
    config: linkConfig
  }),
  z.object({
    projectId: z.number().int(),
    type: z.literal('command'),
    label,
    config: commandConfig
  })
])

export const actionsRouter = router({
  create: publicProcedure.input(createActionInput).mutation(({ ctx, input }) => {
    // Append to the end of the project's list.
    const next =
      ctx.db
        .select({ max: sql<number | null>`max(${projectActions.sortOrder})` })
        .from(projectActions)
        .where(eq(projectActions.projectId, input.projectId))
        .get()?.max ?? -1

    return ctx.db
      .insert(projectActions)
      .values({
        projectId: input.projectId,
        type: input.type,
        label: input.label,
        config: input.config as ActionConfig,
        sortOrder: next + 1
      })
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
