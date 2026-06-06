import { createRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ProjectDetail } from '@/components/project-detail'
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
  const projectsQuery = trpc.projects.list.useQuery()
  const project = projectsQuery.data?.find((p) => String(p.id) === projectId)

  if (projectsQuery.isLoading) return <CenteredMessage>Loading…</CenteredMessage>
  if (!project) return <CenteredMessage>Project not found.</CenteredMessage>
  return <ProjectDetail project={project} />
}

export const projectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects/$projectId',
  component: ProjectDetailPage
})
