import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  type ActionGroup,
  actionGroups,
  type ProjectAction,
  type ProjectRepo,
  projectActions,
  projectRepos,
  projects
} from '../../db/schema'
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
  // Projects newest-first, each with its action groups, actions, and linked
  // GitHub repos. Each child set is fetched in one pass and bucketed in memory
  // to avoid an N+1 per project. Actions carry their own `groupId`, so the
  // renderer splits them into per-group and loose (ungrouped) lists.
  list: publicProcedure.query(({ ctx }) => {
    const rows = ctx.db.select().from(projects).orderBy(desc(projects.createdAt)).all()
    const actions = ctx.db
      .select()
      .from(projectActions)
      .orderBy(asc(projectActions.sortOrder), asc(projectActions.id))
      .all()
    const groups = ctx.db
      .select()
      .from(actionGroups)
      .orderBy(asc(actionGroups.sortOrder), asc(actionGroups.id))
      .all()
    const repos = ctx.db
      .select()
      .from(projectRepos)
      .orderBy(asc(projectRepos.owner), asc(projectRepos.name))
      .all()

    const actionsByProject = new Map<number, ProjectAction[]>()
    for (const action of actions) {
      const list = actionsByProject.get(action.projectId)
      if (list) list.push(action)
      else actionsByProject.set(action.projectId, [action])
    }

    const groupsByProject = new Map<number, ActionGroup[]>()
    for (const group of groups) {
      const list = groupsByProject.get(group.projectId)
      if (list) list.push(group)
      else groupsByProject.set(group.projectId, [group])
    }

    const reposByProject = new Map<number, ProjectRepo[]>()
    for (const repo of repos) {
      const list = reposByProject.get(repo.projectId)
      if (list) list.push(repo)
      else reposByProject.set(repo.projectId, [repo])
    }

    return rows.map((project) => ({
      ...project,
      groups: groupsByProject.get(project.id) ?? [],
      actions: actionsByProject.get(project.id) ?? [],
      repos: reposByProject.get(project.id) ?? []
    }))
  }),

  create: publicProcedure
    .input(createProjectInput)
    .mutation(({ ctx, input }) => ctx.db.insert(projects).values(input).returning().get()),

  update: publicProcedure.input(updateProjectInput).mutation(({ ctx, input }) => {
    const { id, ...values } = input
    return ctx.db.update(projects).set(values).where(eq(projects.id, id)).returning().get()
  }),

  // Pin/unpin from the dashboard home's projects section.
  setPinned: publicProcedure
    .input(z.object({ id: z.number().int(), pinned: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .update(projects)
        .set({ pinned: input.pinned })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    ),

  // Cascades to the project's actions (FK onDelete: 'cascade' + foreign_keys ON).
  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.delete(projects).where(eq(projects.id, input.id)).run()
    return { id: input.id }
  })
})
