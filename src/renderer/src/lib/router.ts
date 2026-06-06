import { createHashHistory, createRouter } from '@tanstack/react-router'
import { rootRoute } from '@/routes/__root'
import { indexRoute } from '@/routes/index'
import { projectRoute } from '@/routes/project'

const routeTree = rootRoute.addChildren([indexRoute, projectRoute])

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
