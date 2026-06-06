import { IconArrowUpRight, IconExternalLink, IconTerminal2 } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import type { inferRouterOutputs } from '@trpc/server'
import { type ReactElement, useState } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { trpc } from '@/lib/trpc'
import type { AppRouter } from '../../../main/trpc/router'

type ProjectWithActions = inferRouterOutputs<AppRouter>['projects']['list'][number]

/** A launch tile: project identity, an open button, and its launchable actions. */
export function ProjectCard({ project }: { project: ProjectWithActions }): ReactElement {
  const [runError, setRunError] = useState<string | null>(null)

  const runAction = trpc.actions.run.useMutation({
    onSuccess: (result) => setRunError(result.ok ? null : (result.error ?? 'Action failed')),
    onError: (error) => setRunError(error.message)
  })

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

      {project.actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {project.actions.map((action) => (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              loading={runAction.isPending && runAction.variables?.id === action.id}
              onClick={() => runAction.mutate({ id: action.id })}
            >
              {action.type === 'link' ? <IconExternalLink /> : <IconTerminal2 />}
              {action.label}
            </Button>
          ))}
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
