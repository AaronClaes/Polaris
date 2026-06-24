import { type ReactElement, Suspense } from 'react'
import { ToolLoading } from '@/components/tool-loading'
import type { ToolDef } from '@/lib/tools'

/**
 * Chrome for a tool launched in its own window: a slim draggable title bar
 * matching the main window's hiddenInset traffic lights (hence the `pl-20` to
 * clear them), over the tool body which fills the rest of the window. No sidebar
 * — this is a standalone mini app. Renders the same tool component as the in-app
 * {@link ToolLayout}; only the chrome differs. A `fullBleed` tool (e.g. the 3D
 * viewer) fills the window edge-to-edge; others sit in a centered padded column.
 */
export function ToolWindowLayout({ tool }: { tool: ToolDef }): ReactElement {
  const { Icon, Component, fullBleed } = tool
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="drag-region flex h-10 shrink-0 items-center gap-2 border-border border-b bg-background pl-20 text-sm">
        <Icon className="size-4 text-muted-foreground" />
        <span className="font-medium">{tool.name}</span>
      </header>
      {fullBleed ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={<ToolLoading />}>
            <Component />
          </Suspense>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-8 py-8">
            <Suspense fallback={<ToolLoading />}>
              <Component />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  )
}
