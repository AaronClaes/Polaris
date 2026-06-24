import { IconArrowLeft } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type ReactElement, Suspense } from 'react'
import { ToolLoading } from '@/components/tool-loading'
import type { ToolDef } from '@/lib/tools'

/**
 * In-app chrome for a tool launched inside the shell: a back link to the grid
 * and the tool's identity header, wrapping the tool's own body. Laid out as a
 * standard padded page column so it reads like the rest of the app; the windowed
 * launch ({@link ToolWindowLayout}) wraps the same component in a bare window
 * instead. A `fullBleed` tool (e.g. the 3D viewer) gets a tall framed canvas
 * area rather than free-flowing page content.
 */
export function ToolLayout({ tool }: { tool: ToolDef }): ReactElement {
  const { Icon, Component, fullBleed } = tool
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-10">
      <header className="flex flex-col gap-3">
        <Link
          to="/tools"
          className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <IconArrowLeft className="size-4" />
          Tools
        </Link>
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-heading font-semibold text-2xl tracking-tight">{tool.name}</h1>
            <p className="mt-0.5 text-muted-foreground text-sm">{tool.description}</p>
          </div>
        </div>
      </header>
      {fullBleed ? (
        <div className="h-[70vh] min-h-105 overflow-hidden rounded-xl border border-border">
          <Suspense fallback={<ToolLoading />}>
            <Component />
          </Suspense>
        </div>
      ) : (
        <Suspense fallback={<ToolLoading />}>
          <Component />
        </Suspense>
      )}
    </div>
  )
}
