import { createHashHistory, createRouter } from '@tanstack/react-router'
import { rootRoute } from '@/routes/__root'
import { indexRoute } from '@/routes/index'
import { issuesRoute } from '@/routes/issues'
import { projectRoute } from '@/routes/project'
import { projectsRoute } from '@/routes/projects'
import { pullsRoute } from '@/routes/pulls'
import { settingsRoute } from '@/routes/settings'
import { shellRoute } from '@/routes/shell'

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([indexRoute, issuesRoute, pullsRoute, projectsRoute, projectRoute]),
  settingsRoute
])

// Hash history works under both the Vite dev server and file:// in the
// packaged app (no web server to handle real paths).
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent'
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
