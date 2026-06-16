import {
  IconCircleDot,
  IconGitPullRequest,
  IconLayoutDashboard,
  IconListCheck,
  IconNotes,
  IconPlus,
  IconSelector,
  IconSettings
} from '@tabler/icons-react'
import { Link, useLocation, useParams } from '@tanstack/react-router'
import { type ReactElement, useMemo } from 'react'
import { ACTION_ICON_CLASS, ActionIcon } from '@/components/action-icon'
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { useRepoCounts } from '@/lib/github-queries'
import { getIcon } from '@/lib/icons'
import type { ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { useVisibleProjects, useVisibleTodos } from '@/lib/use-visible-projects'
import { cn } from '@/lib/utils'

function ProjectRow({
  project,
  isActive
}: {
  project: ProjectWithActions
  isActive: boolean
}): ReactElement {
  const runAction = trpc.actions.run.useMutation()
  const runGroup = trpc.groups.run.useMutation()

  // Mirror the dashboard's visibility: only pinned groups/actions (and non-empty
  // groups) are candidates for the quick-launch target.
  const firstGroup = project.groups.find(
    (g) => g.pinned && project.actions.some((a) => a.groupId === g.id)
  )
  const firstLooseAction = project.actions.find((a) => a.groupId == null && a.pinned)

  // Quick-launch the first top-level item: a group (run all) or a loose action.
  // The loose-action branch carries the action so a favicon link shows its
  // favicon; the group branch resolves a Tabler glyph (groups never use one).
  const quick = firstGroup
    ? {
        Icon: getIcon(firstGroup.icon).Icon,
        action: null,
        title: `Run group: ${firstGroup.name}`,
        pending: runGroup.isPending && runGroup.variables?.groupId === firstGroup.id,
        run: () => runGroup.mutate({ groupId: firstGroup.id })
      }
    : firstLooseAction
      ? {
          Icon: null,
          action: firstLooseAction,
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
          {quick.action ? (
            <ActionIcon action={quick.action} className={ACTION_ICON_CLASS} />
          ) : (
            quick.Icon && <quick.Icon />
          )}
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
  const projectsQuery = useVisibleProjects()
  const projects = projectsQuery.data ?? []

  // Deduped union of every linked repo → total issue/PR counts for the nav
  // badges. Reads the same per-repo cache the views use, so it adds no fetch.
  const allRepos = useMemo(() => {
    const seen = new Set<string>()
    const repos: { owner: string; name: string }[] = []
    for (const project of projects) {
      for (const repo of project.repos) {
        const key = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        repos.push({ owner: repo.owner, name: repo.name })
      }
    }
    return repos
  }, [projects])
  const counts = useRepoCounts(allRepos)

  // Open todos across every project — the Todos nav badge. Shares the same
  // cache as the global Todos view, so it adds no fetch. `loaded` gates the
  // badge so it doesn't flash "0" before the query resolves. Visible-project
  // filtering (under the current tag filter) is handled by useVisibleTodos.
  const todosQuery = useVisibleTodos()
  const openTodos = (todosQuery.data ?? []).filter((todo) => !todo.completed).length
  const todosLoaded = !todosQuery.isLoading

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
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname === '/issues'} render={<Link to="/issues" />}>
                  <IconCircleDot />
                  <span>Issues</span>
                </SidebarMenuButton>
                {counts.issuesLoaded && <SidebarMenuBadge>{counts.issues}</SidebarMenuBadge>}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname === '/pulls'} render={<Link to="/pulls" />}>
                  <IconGitPullRequest />
                  <span>Pull requests</span>
                </SidebarMenuButton>
                {counts.pullsLoaded && <SidebarMenuBadge>{counts.pulls}</SidebarMenuBadge>}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname === '/todos'} render={<Link to="/todos" />}>
                  <IconListCheck />
                  <span>Todos</span>
                </SidebarMenuButton>
                {todosLoaded && <SidebarMenuBadge>{openTodos}</SidebarMenuBadge>}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname === '/notes'} render={<Link to="/notes" />}>
                  <IconNotes />
                  <span>Notes</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel
            render={<Link to="/projects" />}
            className={cn(
              'cursor-pointer transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              pathname === '/projects' &&
                'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            )}
          >
            Projects
          </SidebarGroupLabel>
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
