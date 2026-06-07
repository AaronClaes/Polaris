import { IconLayoutDashboard, IconPlus, IconSelector, IconSettings } from '@tabler/icons-react'
import { Link, useLocation, useParams } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { CreateProjectDialog } from '@/components/create-project-dialog'
import { ProjectIcon } from '@/components/project-icon'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { getIcon } from '@/lib/icons'
import type { ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

function ProjectRow({
  project,
  isActive
}: {
  project: ProjectWithActions
  isActive: boolean
}): ReactElement {
  const runAction = trpc.actions.run.useMutation()
  const runGroup = trpc.groups.run.useMutation()

  // Mirror the dashboard's visibility: skip hidden groups/actions (and empty
  // groups) when picking the quick-launch target.
  const firstGroup = project.groups.find(
    (g) => !g.hidden && project.actions.some((a) => a.groupId === g.id)
  )
  const firstLooseAction = project.actions.find((a) => a.groupId == null && !a.hidden)

  // Quick-launch the first top-level item: a group (run all) or a loose action.
  const quick = firstGroup
    ? {
        Icon: getIcon(firstGroup.icon).Icon,
        title: `Run group: ${firstGroup.name}`,
        pending: runGroup.isPending && runGroup.variables?.groupId === firstGroup.id,
        run: () => runGroup.mutate({ groupId: firstGroup.id })
      }
    : firstLooseAction
      ? {
          Icon: getIcon(firstLooseAction.icon).Icon,
          title: `Run: ${firstLooseAction.label}`,
          pending: runAction.isPending && runAction.variables?.id === firstLooseAction.id,
          run: () => runAction.mutate({ id: firstLooseAction.id })
        }
      : null

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        render={<Link to="/projects/$projectId" params={{ projectId: String(project.id) }} />}
      >
        <ProjectIcon icon={project.icon} color={project.color} size={15} className="size-5" />
        <span>{project.name}</span>
      </SidebarMenuButton>

      {quick && (
        <SidebarMenuAction
          title={quick.title}
          aria-label={quick.title}
          disabled={quick.pending}
          onClick={quick.run}
        >
          <quick.Icon />
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  )
}

/** Avatar + identity block, shared by the footer trigger and the account menu. */
function AccountInfo(): ReactElement {
  return (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs">
        AC
      </span>
      <div className="flex min-w-0 flex-col text-left">
        <span className="truncate font-medium text-sm">Account</span>
        <span className="truncate text-muted-foreground text-xs">Local</span>
      </div>
    </>
  )
}

/** Left app shell: top-level nav (Dashboard), the project list, and an account stub. */
export function AppSidebar(): ReactElement {
  const params = useParams({ strict: false }) as { projectId?: string }
  const pathname = useLocation({ select: (location) => location.pathname })
  const projectsQuery = trpc.projects.list.useQuery()
  const projects = projectsQuery.data ?? []

  return (
    <Sidebar collapsible="none" className="border-sidebar-border border-r">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname === '/'} render={<Link to="/" />}>
                  <IconLayoutDashboard />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <CreateProjectDialog
            trigger={
              <SidebarGroupAction aria-label="New project" title="New project">
                <IconPlus />
              </SidebarGroupAction>
            }
          />
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
            <Menu>
              <MenuTrigger render={<SidebarMenuButton size="lg" />}>
                <AccountInfo />
                <IconSelector className="ml-auto size-4 shrink-0 text-muted-foreground" />
              </MenuTrigger>
              <MenuPopup side="right" align="end" sideOffset={12} className="min-w-56">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <AccountInfo />
                </div>
                <MenuSeparator />
                <MenuItem render={<Link to="/settings" />}>
                  <IconSettings />
                  Settings
                </MenuItem>
              </MenuPopup>
            </Menu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
