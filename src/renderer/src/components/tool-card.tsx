import { IconAppWindow } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { ToolDef } from '@/lib/tools'
import { trpc } from '@/lib/trpc'

/**
 * A launch tile: the whole card opens the tool in the app, while the corner
 * button launches it in its own window. The two are deliberately separate
 * destinations — a tool opened in the app stays in the app, and one opened in a
 * window stays in the window (no docking between them).
 */
export function ToolCard({ tool }: { tool: ToolDef }): ReactElement {
  const { Icon } = tool
  const openWindow = trpc.tools.openWindow.useMutation()

  return (
    <Card className="relative gap-0 p-4 transition-colors hover:border-ring/60">
      {/* Stretched link: the whole card opens the tool in the app. It sits
          beneath the window button, which is lifted with z-10. */}
      <Link
        to="/tools/$toolId"
        params={{ toolId: tool.id }}
        aria-label={`Open ${tool.name}`}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-sm leading-tight">{tool.name}</h3>
          <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{tool.description}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative z-10 shrink-0 text-muted-foreground"
          title="Open in a new window"
          aria-label={`Open ${tool.name} in a new window`}
          loading={openWindow.isPending}
          onClick={() =>
            openWindow.mutate({
              toolId: tool.id,
              title: tool.name,
              width: tool.window.width,
              height: tool.window.height
            })
          }
        >
          <IconAppWindow />
        </Button>
      </div>
    </Card>
  )
}
