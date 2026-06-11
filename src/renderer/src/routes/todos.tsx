import { createRoute } from '@tanstack/react-router'
import { AllTodos } from '@/components/global-views'
import { shellRoute } from './shell'

export const todosRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/todos',
  component: AllTodos
})
