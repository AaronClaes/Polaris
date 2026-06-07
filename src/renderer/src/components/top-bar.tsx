import { IconRefresh } from '@tabler/icons-react'
import { useIsFetching } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc'

/**
 * Full-width draggable title bar (VS Code style). Shows the active project
 * centered, with a global refresh on the right. `drag-region` lets it move the
 * window; the left padding clears the inset macOS traffic lights (window uses
 * `titleBarStyle: 'hiddenInset'`); interactive controls opt out with `no-drag`.
 */
export function TopBar(): ReactElement {
  const params = useParams({ strict: false }) as { projectId?: string }
  const projectsQuery = trpc.projects.list.useQuery()
  const active = params.projectId
    ? projectsQuery.data?.find((p) => String(p.id) === params.projectId)
    : undefined

  // Refresh re-fetches all GitHub data app-wide; invalidating the whole router
  // namespace covers every per-repo issues/PRs query (and accounts/repos). The
  // spinner tracks any in-flight github query.
  const utils = trpc.useUtils()
  const refreshing = useIsFetching({
    predicate: (query) => {
      const group = query.queryKey[0]
      return Array.isArray(group) && group[0] === 'github'
    }
  })

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
      <Button
        variant="outline"
        size="sm"
        className="no-drag absolute right-2"
        loading={refreshing > 0}
        onClick={() => utils.github.invalidate()}
      >
        <IconRefresh />
        Refresh
      </Button>
    </header>
  )
}
