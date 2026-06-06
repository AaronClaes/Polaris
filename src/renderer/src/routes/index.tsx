import { createRoute } from '@tanstack/react-router'
import { Dashboard } from '@/components/dashboard'
import { rootRoute } from './__root'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard
})
