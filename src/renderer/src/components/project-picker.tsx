import { IconChevronDown, IconInbox } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/menu'
import { cn } from '@/lib/utils'

/** The display bits the picker needs from a project (icon/color/name). */
export type ProjectOption = { id: number; name: string; icon: string; color: string }

// The "No project" radio value — a sentinel distinct from any project id string.
const NO_PROJECT = 'none'

/**
 * Picks which project something lands in, or "No project" to leave it unlinked.
 * Shows the selection's icon + name; a radio menu with a "No project" choice on
 * top, then every project. Shared by the todos add row and the email allowlist —
 * the same optional-project control in both places.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
  className
}: {
  projects: ProjectOption[]
  value: number | null
  onChange: (projectId: number | null) => void
  className?: string
}): ReactElement {
  const active = value != null ? projects.find((project) => project.id === value) : undefined
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="outline" size="sm" className={cn('shrink-0 gap-1.5', className)} />
        }
      >
        {active ? (
          <ProjectIcon icon={active.icon} color={active.color} size={11} className="size-4" />
        ) : (
          <IconInbox className="size-4 text-muted-foreground" />
        )}
        <span className="max-w-28 truncate">{active?.name ?? 'No project'}</span>
        <IconChevronDown />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-44">
        <MenuRadioGroup
          value={value != null ? String(value) : NO_PROJECT}
          onValueChange={(next) => onChange(next === NO_PROJECT ? null : Number(next))}
        >
          <MenuRadioItem value={NO_PROJECT}>
            <span className="flex items-center gap-2">
              <IconInbox className="size-4 text-muted-foreground" />
              <span className="truncate">No project</span>
            </span>
          </MenuRadioItem>
          {projects.map((project) => (
            <MenuRadioItem key={project.id} value={String(project.id)}>
              <span className="flex items-center gap-2">
                <ProjectIcon
                  icon={project.icon}
                  color={project.color}
                  size={11}
                  className="size-4"
                />
                <span className="truncate">{project.name}</span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  )
}
