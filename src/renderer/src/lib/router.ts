import { createHashHistory, createRouter } from '@tanstack/react-router'
import { RouteError } from '@/components/route-error'
import { rootRoute } from '@/routes/__root'
import { archiveRoute } from '@/routes/archive'
import { indexRoute } from '@/routes/index'
import { issuesRoute } from '@/routes/issues'
import { notesRoute } from '@/routes/notes'
import { projectRoute } from '@/routes/project'
import { projectsRoute } from '@/routes/projects'
import { pullsRoute } from '@/routes/pulls'
import { settingsRoute } from '@/routes/settings'
import { shellRoute } from '@/routes/shell'
import { todosRoute } from '@/routes/todos'

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    indexRoute,
    issuesRoute,
    pullsRoute,
    todosRoute,
    notesRoute,
    archiveRoute,
    projectsRoute,
    projectRoute
  ]),
  settingsRoute
])

// Hash history works under both the Vite dev server and file:// in the
// packaged app (no web server to handle real paths).
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  // Any uncaught render error in a route falls back to this instead of a blank
  // screen — see route-error.tsx.
  defaultErrorComponent: RouteError
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
