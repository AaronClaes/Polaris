import { createRootRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { CommandPalette } from '@/components/command-palette'

function RootLayout(): ReactElement {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground antialiased">
      <Outlet />
      <CommandPalette />
    </div>
  )
}

export const rootRoute = createRootRoute({ component: RootLayout })
