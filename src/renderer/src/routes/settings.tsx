import { createRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/components/settings-page'
import { rootRoute } from './__root'

// Mounted on the root (not the sidebar shell) so it renders full screen.
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage
})
