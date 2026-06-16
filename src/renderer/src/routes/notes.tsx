import { createRoute } from '@tanstack/react-router'
import { AllNotes } from '@/components/all-notes'
import { shellRoute } from './shell'

export const notesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/notes',
  component: AllNotes
})
