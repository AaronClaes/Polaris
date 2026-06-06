import { createRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { TopBar } from '@/components/top-bar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { rootRoute } from './__root'

/** The main app layout: title bar + sidebar wrapping the routed content. */
function ShellLayout(): ReactElement {
  return (
    <>
      <TopBar />
      <SidebarProvider className="min-h-0 flex-1">
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <div className="flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </>
  )
}

/**
 * Pathless layout route. Pages nested under it get the sidebar shell; routes
 * mounted directly on the root (e.g. Settings) render full screen instead.
 */
export const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: ShellLayout
})
