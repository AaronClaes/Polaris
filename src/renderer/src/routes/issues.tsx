import { createRoute } from '@tanstack/react-router'
import { AllIssues } from '@/components/global-views'
import { shellRoute } from './shell'

export const issuesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/issues',
  component: AllIssues
})
