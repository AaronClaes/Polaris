import { createRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { PROJECT_TABS, ProjectDetail, type ProjectTab } from '@/components/project-detail'
import { trpc } from '@/lib/trpc'
import { shellRoute } from './shell'

function CenteredMessage({ children }: { children: string }): ReactElement {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
      {children}
    </div>
  )
}

function ProjectDetailPage(): ReactElement {
  const { projectId } = projectRoute.useParams()
  // Raw (unfiltered) list on purpose: resolve the open project by id even if its
  // tag is currently hidden. Every list/aggregate surface uses useVisibleProjects
  // (or useVisibleTodos) to apply the tag filter instead.
  const projectsQuery = trpc.projects.list.useQuery()
  const project = projectsQuery.data?.find((p) => String(p.id) === projectId)

  if (projectsQuery.isLoading) return <CenteredMessage>Loading…</CenteredMessage>
  if (!project) return <CenteredMessage>Project not found.</CenteredMessage>
  return <ProjectDetail project={project} />
}

export const projectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects/$projectId',
  // `?tab=` selects the open tab; an absent/unknown value falls back in the
  // component. Lets the dashboard cards deep-link to Issues/Pull requests.
  validateSearch: (search: Record<string, unknown>): { tab?: ProjectTab } => {
    const tab = search.tab
    return typeof tab === 'string' && (PROJECT_TABS as readonly string[]).includes(tab)
      ? { tab: tab as ProjectTab }
      : {}
  },
  component: ProjectDetailPage
})
