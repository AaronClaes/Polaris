import { createRoute } from '@tanstack/react-router'
import { Archive } from '@/components/archive'
import { shellRoute } from './shell'

export const archiveRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/archive',
  component: Archive
})
