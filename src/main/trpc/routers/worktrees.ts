import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { projectRepos, projects } from '../../db/schema'
import { listWorktrees } from '../../services/worktrees'
import { publicProcedure, router } from '..'

const repoInput = z.object({ owner: z.string().min(1), name: z.string().min(1) })

export const worktreesRouter = router({
  // The added worktrees of a repo's local clone. Owner/name is the renderer's
  // repo identity (same casing as the stored rows); the clone path is the
  // linked repo's `path` falling back to its project's default `path`. Several
  // projects can link the same repo — the first row with a usable path wins.
  // No usable path just means no worktrees, never an error (listWorktrees
  // itself is forgiving about missing directories).
  forRepo: publicProcedure.input(repoInput).query(async ({ ctx, input }) => {
    const rows = ctx.db
      .select({ repoPath: projectRepos.path, projectPath: projects.path })
      .from(projectRepos)
      .innerJoin(projects, eq(projectRepos.projectId, projects.id))
      .where(and(eq(projectRepos.owner, input.owner), eq(projectRepos.name, input.name)))
      .all()

    const clonePath = rows.map((row) => row.repoPath ?? row.projectPath).find(Boolean) ?? null
    return { worktrees: await listWorktrees(clonePath) }
  })
})
