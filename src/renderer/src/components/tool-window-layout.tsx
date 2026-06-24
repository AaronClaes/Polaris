import { IconPin, IconPinFilled } from '@tabler/icons-react'
import { type ReactElement, Suspense, useState } from 'react'
import { ToolLoading } from '@/components/tool-loading'
import { Button } from '@/components/ui/button'
import type { ToolDef } from '@/lib/tools'
import { trpc } from '@/lib/trpc'

/**
 * Chrome for a tool launched in its own window: a slim draggable title bar
 * matching the main window's hiddenInset traffic lights (hence the `pl-20` to
 * clear them), over the tool body which fills the rest of the window. No sidebar
 * — this is a standalone mini app. Renders the same tool component as the in-app
 * {@link ToolLayout}; only the chrome differs. A `fullBleed` tool (e.g. the 3D
 * viewer) fills the window edge-to-edge; others sit in a centered padded column.
 *
 * The title bar centers the tool's icon + name and carries a pin toggle on the
 * right that floats the window over other apps (see `tools.setAlwaysOnTop`).
 */
export function ToolWindowLayout({ tool }: { tool: ToolDef }): ReactElement {
  const { Icon, Component, fullBleed } = tool
  const [pinned, setPinned] = useState(false)
  const setAlwaysOnTop = trpc.tools.setAlwaysOnTop.useMutation()
  const togglePin = (): void => {
    const next = !pinned
    setPinned(next) // optimistic; main returns the real state but a fresh window can only be off→on
    setAlwaysOnTop.mutate({ toolId: tool.id, value: next })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="drag-region relative flex h-10 shrink-0 items-center border-border border-b bg-background pr-1.5 pl-20 text-sm">
        {/* Centered across the full bar; pointer-events-none so it never steals
            drags or clicks from the bar or the pin button. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="font-medium">{tool.name}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className={`no-drag relative z-10 ml-auto shrink-0 ${pinned ? 'text-foreground' : 'text-muted-foreground'}`}
          aria-pressed={pinned}
          title={pinned ? 'Unpin — stop floating on top' : 'Pin — keep on top of other windows'}
          aria-label={pinned ? 'Unpin window' : 'Keep window on top'}
          onClick={togglePin}
        >
          {pinned ? <IconPinFilled /> : <IconPin />}
        </Button>
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
