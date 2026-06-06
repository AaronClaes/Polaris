import { createRootRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { CommandPalette } from '@/components/command-palette'

/**
 * Global shell: window-level styling + always-on overlays. The sidebar chrome
 * lives in the nested layout route (so full-screen routes like Settings can opt
 * out of it).
 */
function RootLayout(): ReactElement {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <Outlet />
      <CommandPalette />
    </div>
  )
}

export const rootRoute = createRootRoute({ component: RootLayout })
