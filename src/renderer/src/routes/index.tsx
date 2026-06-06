import { createRoute } from '@tanstack/react-router'
import { Dashboard } from '@/components/dashboard'
import { shellRoute } from './shell'

export const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: Dashboard
})
