import { createRoute } from '@tanstack/react-router'
import { AllPulls } from '@/components/global-views'
import { shellRoute } from './shell'

export const pullsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/pulls',
  component: AllPulls
})
