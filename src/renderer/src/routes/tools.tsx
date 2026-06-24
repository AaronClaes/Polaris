import { createRoute } from '@tanstack/react-router'
import { ToolsPage } from '@/components/tools-page'
import { shellRoute } from './shell'

export const toolsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/tools',
  component: ToolsPage
})
