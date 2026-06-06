import { useParams } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { trpc } from '@/lib/trpc'

/**
 * Full-width draggable title bar (VS Code style). Shows the active project
 * centered. `drag-region` lets it move the window; the left padding clears the
 * inset macOS traffic lights (window uses `titleBarStyle: 'hiddenInset'`).
 */
export function TopBar(): ReactElement {
  const params = useParams({ strict: false }) as { projectId?: string }
  const projectsQuery = trpc.projects.list.useQuery()
  const active = params.projectId
    ? projectsQuery.data?.find((p) => String(p.id) === params.projectId)
    : undefined

  return (
    <header className="drag-region relative flex h-10 shrink-0 items-center justify-center border-border border-b bg-background pl-20">
      {active ? (
        <div className="flex items-center gap-2 text-sm">
          <ProjectIcon icon={active.icon} color={active.color} size={13} className="size-4.5" />
          <span className="font-medium">{active.name}</span>
        </div>
      ) : (
        <span className="font-medium text-muted-foreground text-sm">Polaris</span>
      )}
    </header>
  )
}
