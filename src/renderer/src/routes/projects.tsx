import { createRoute } from '@tanstack/react-router'
import { ProjectsPage } from '@/components/projects-page'
import { shellRoute } from './shell'

export const projectsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects',
  component: ProjectsPage
})
