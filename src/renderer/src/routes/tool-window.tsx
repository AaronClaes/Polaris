import { createRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ToolWindowLayout } from '@/components/tool-window-layout'
import { toolById } from '@/lib/tools'
import { rootRoute } from './__root'

function ToolWindowPage(): ReactElement {
  const { toolId } = toolWindowRoute.useParams()
  const tool = toolById(toolId)
  if (!tool) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground text-sm">
        Tool not found.
      </div>
    )
  }
  return <ToolWindowLayout tool={tool} />
}

// Mounted on the root (not the sidebar shell) so the popped-out tool renders in
// a bare window — no sidebar, no top bar. The main process opens a BrowserWindow
// at this route's hash (see main/tool-windows.ts).
export const toolWindowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tool-window/$toolId',
  component: ToolWindowPage
})
