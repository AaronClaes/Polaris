import { router } from '.'
import { projectsRouter } from './routers/projects'
import { systemRouter } from './routers/system'

export const appRouter = router({
  projects: projectsRouter,
  system: systemRouter
})

// Consumed type-only by the renderer for a fully typed IPC client.
export type AppRouter = typeof appRouter
