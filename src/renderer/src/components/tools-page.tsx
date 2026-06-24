import { IconTools } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { ToolCard } from '@/components/tool-card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { TOOLS } from '@/lib/tools'

/** The tool launcher: a grid of tool tiles, mirroring the projects grid. */
export function ToolsPage(): ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Tools</h1>
        <p className="mt-0.5 text-muted-foreground text-sm">
          Open a tool in the app, or launch it in its own window.
        </p>
      </header>

      {TOOLS.length === 0 ? (
        <Empty className="rounded-2xl border border-border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconTools />
            </EmptyMedia>
            <EmptyTitle>No tools yet</EmptyTitle>
            <EmptyDescription>Register a tool to see it here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
