import {
  IconCircleDot,
  IconGitPullRequest,
  IconLayoutDashboard,
  IconSettings,
  type TablerIcon
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { type ReactElement, useEffect, useState } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { trpc } from '@/lib/trpc'
import { useUiStore } from '@/stores/ui-store'

export function CommandPalette(): ReactElement {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const toggle = useUiStore((s) => s.toggleCommandPalette)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const projectsQuery = trpc.projects.list.useQuery()
  const projects = projectsQuery.data ?? []

  // Cmd/Ctrl+K opens the palette when the window is focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  // Run a command, then close and clear the query so the next open starts fresh.
  const run = (action: () => void): void => {
    action()
    setOpen(false)
    setQuery('')
  }

  // Manual substring match — the palette filters its own static items rather
  // than Base UI's data-driven filtering (which needs an `items` prop).
  const q = query.trim().toLowerCase()
  const matches = (text: string): boolean => q === '' || text.toLowerCase().includes(q)

  const navItems: { label: string; Icon: TablerIcon; go: () => void }[] = [
    { label: 'Dashboard', Icon: IconLayoutDashboard, go: () => navigate({ to: '/' }) },
    { label: 'Issues', Icon: IconCircleDot, go: () => navigate({ to: '/issues' }) },
    { label: 'Pull requests', Icon: IconGitPullRequest, go: () => navigate({ to: '/pulls' }) },
    { label: 'Settings', Icon: IconSettings, go: () => navigate({ to: '/settings' }) }
  ]
  const filteredNav = navItems.filter((item) => matches(item.label))
  const filteredProjects = projects.filter((project) => matches(project.name))
  const hasResults = filteredNav.length > 0 || filteredProjects.length > 0

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <CommandDialogPopup>
        <Command value={query} onValueChange={(value) => setQuery(value)}>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            {!hasResults && (
              <div className="py-6 text-center text-muted-foreground text-sm">
                No results found.
              </div>
            )}

            {filteredNav.length > 0 && (
              <CommandGroup>
                <CommandGroupLabel>Go to</CommandGroupLabel>
                {filteredNav.map((item) => (
                  <CommandItem key={item.label} className="gap-2" onClick={() => run(item.go)}>
                    <item.Icon className="size-4 text-muted-foreground" />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {filteredProjects.length > 0 && (
              <CommandGroup>
                <CommandGroupLabel>Projects</CommandGroupLabel>
                {filteredProjects.map((project) => (
                  <CommandItem
                    key={project.id}
                    className="gap-2"
                    onClick={() =>
                      run(() =>
                        navigate({
                          to: '/projects/$projectId',
                          params: { projectId: String(project.id) }
                        })
                      )
                    }
                  >
                    <ProjectIcon
                      icon={project.icon}
                      color={project.color}
                      size={13}
                      className="size-5"
                    />
                    {project.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}
