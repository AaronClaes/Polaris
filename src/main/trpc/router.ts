import { router } from '.'
import { actionsRouter } from './routers/actions'
import { faviconRouter } from './routers/favicon'
import { githubRouter } from './routers/github'
import { groupsRouter } from './routers/groups'
import { projectsRouter } from './routers/projects'

export const appRouter = router({
  projects: projectsRouter,
  groups: groupsRouter,
  actions: actionsRouter,
  github: githubRouter,
  favicon: faviconRouter
})

// Consumed type-only by the renderer for a fully typed IPC client.
export type AppRouter = typeof appRouter
