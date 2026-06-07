import { createRootRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { CommandPalette } from '@/components/command-palette'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Global shell: window-level styling + always-on overlays. The sidebar chrome
 * lives in the nested layout route (so full-screen routes like Settings can opt
 * out of it). The TooltipProvider shares hover delay/grouping across all tooltips.
 */
function RootLayout(): ReactElement {
  return (
    <TooltipProvider delay={300}>
      <div className="flex h-svh flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
        <Outlet />
        <CommandPalette />
      </div>
    </TooltipProvider>
  )
}

export const rootRoute = createRootRoute({ component: RootLayout })
