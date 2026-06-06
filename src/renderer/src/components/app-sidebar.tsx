import { IconExternalLink, IconPlus, IconTerminal2 } from '@tabler/icons-react'
import { Link, useParams } from '@tanstack/react-router'
import type { inferRouterOutputs } from '@trpc/server'
import type { ReactElement } from 'react'
import { CreateProjectDialog } from '@/components/create-project-dialog'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { trpc } from '@/lib/trpc'
import type { AppRouter } from '../../../main/trpc/router'

type ProjectWithActions = inferRouterOutputs<AppRouter>['projects']['list'][number]

function ProjectRow({
  project,
  isActive
}: {
  project: ProjectWithActions
  isActive: boolean
}): ReactElement {
  const runAction = trpc.actions.run.useMutation()
  const firstAction = project.actions[0]

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        render={<Link to="/projects/$projectId" params={{ projectId: String(project.id) }} />}
      >
        <ProjectIcon icon={project.icon} color={project.color} size={15} className="size-5" />
        <span>{project.name}</span>
      </SidebarMenuButton>

      {firstAction && (
        <SidebarMenuAction
          title={`Run: ${firstAction.label}`}
          aria-label={`Run ${firstAction.label}`}
          disabled={runAction.isPending && runAction.variables?.id === firstAction.id}
          onClick={() => runAction.mutate({ id: firstAction.id })}
        >
          {firstAction.type === 'link' ? <IconExternalLink /> : <IconTerminal2 />}
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  )
}

/** Left app shell: app name + create, the project list, and an account stub. */
export function AppSidebar(): ReactElement {
  const params = useParams({ strict: false }) as { projectId?: string }
  const projectsQuery = trpc.projects.list.useQuery()
  const projects = projectsQuery.data ?? []

  return (
    <Sidebar collapsible="none" className="border-sidebar-border border-r">
      <SidebarHeader className="flex-row items-center justify-between px-3 py-2.5">
        <Link
          to="/"
          className="-mx-1 rounded px-1 py-0.5 font-heading font-semibold text-sm tracking-tight transition-colors hover:bg-sidebar-accent"
        >
          Polaris
        </Link>
        <CreateProjectDialog
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="New project" title="New project">
              <IconPlus />
            </Button>
          }
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            {projects.length === 0 ? (
              <p className="px-2 py-1.5 text-muted-foreground text-xs">No projects yet.</p>
            ) : (
              <SidebarMenu>
                {projects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    isActive={params.projectId === String(project.id)}
                  />
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs">
                AC
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-sm">Account</span>
                <span className="truncate text-muted-foreground text-xs">Local</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
