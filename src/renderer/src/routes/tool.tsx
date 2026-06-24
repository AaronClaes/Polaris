import { createRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ToolLayout } from '@/components/tool-layout'
import { toolById } from '@/lib/tools'
import { shellRoute } from './shell'

function ToolDetailPage(): ReactElement {
  const { toolId } = toolRoute.useParams()
  const tool = toolById(toolId)
  if (!tool) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Tool not found.
      </div>
    )
  }
  return <ToolLayout tool={tool} />
}

export const toolRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/tools/$toolId',
  component: ToolDetailPage
})
