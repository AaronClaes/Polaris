import { IconArrowUpRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type ReactElement, useMemo, useState } from 'react'
import { GroupLauncher } from '@/components/group-launcher'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getIcon } from '@/lib/icons'
import type { ProjectActionRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** A launch tile: project identity, an open button, its groups and actions. */
export function ProjectCard({ project }: { project: ProjectWithActions }): ReactElement {
  const [runError, setRunError] = useState<string | null>(null)

  const looseActions = useMemo(
    () => project.actions.filter((a) => a.groupId == null),
    [project.actions]
  )
  const membersByGroup = useMemo(() => {
    const map = new Map<number, ProjectActionRow[]>()
    for (const action of project.actions) {
      if (action.groupId == null) continue
      const list = map.get(action.groupId)
      if (list) list.push(action)
      else map.set(action.groupId, [action])
    }
    return map
  }, [project.actions])

  const runAction = trpc.actions.run.useMutation({
    onSuccess: (result) => setRunError(result.ok ? null : (result.error ?? 'Action failed')),
    onError: (error) => setRunError(error.message)
  })

  const hasLaunchers = project.groups.length > 0 || looseActions.length > 0

  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start gap-3">
        <ProjectIcon icon={project.icon} color={project.color} size={22} className="size-11" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-sm leading-tight">{project.name}</h3>
          {project.description && (
            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{project.description}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mt-1 -mr-1 shrink-0"
          aria-label={`Open ${project.name}`}
          title={`Open ${project.name}`}
          render={<Link to="/projects/$projectId" params={{ projectId: String(project.id) }} />}
        >
          <IconArrowUpRight />
        </Button>
      </div>

      {hasLaunchers && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {project.groups.map((group) => (
            <GroupLauncher
              key={group.id}
              group={group}
              actions={membersByGroup.get(group.id) ?? []}
              onError={setRunError}
            />
          ))}
          {looseActions.map((action) => {
            const Icon = getIcon(action.icon).Icon
            return (
              <Button
                key={action.id}
                variant="outline"
                size="sm"
                loading={runAction.isPending && runAction.variables?.id === action.id}
                onClick={() => runAction.mutate({ id: action.id })}
              >
                <Icon />
                {action.label}
              </Button>
            )
          })}
        </div>
      )}

      {runError && (
        <p className="mt-3 rounded-md border border-destructive/36 bg-destructive/8 px-2.5 py-1.5 text-destructive-foreground text-xs">
          {runError}
        </p>
      )}
    </Card>
  )
}
