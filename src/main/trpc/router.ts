import { router } from '.'
import { actionsRouter } from './routers/actions'
import { projectsRouter } from './routers/projects'

export const appRouter = router({
  projects: projectsRouter,
  actions: actionsRouter
})

// Consumed type-only by the renderer for a fully typed IPC client.
export type AppRouter = typeof appRouter
