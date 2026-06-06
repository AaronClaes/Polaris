import { createRootRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/command-palette'
import { TopBar } from '@/components/top-bar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

function RootLayout(): ReactElement {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <TopBar />
      <SidebarProvider className="min-h-0 flex-1">
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <div className="flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette />
    </div>
  )
}

export const rootRoute = createRootRoute({ component: RootLayout })
