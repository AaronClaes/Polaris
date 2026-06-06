import { IconExternalLink, IconPlayerPlay, IconTerminal2, IconTrash } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import type { inferRouterOutputs } from '@trpc/server'
import { type ReactElement, useState } from 'react'
import { AddActionDialog } from '@/components/add-action-dialog'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc'
import type { CommandActionConfig, LinkActionConfig } from '../../../main/db/schema'
import type { AppRouter } from '../../../main/trpc/router'

type ProjectWithActions = inferRouterOutputs<AppRouter>['projects']['list'][number]
type ProjectActionRow = ProjectWithActions['actions'][number]

function actionTarget(action: ProjectActionRow): string {
  return action.type === 'link'
    ? (action.config as LinkActionConfig).url
    : (action.config as CommandActionConfig).command
}

export function ProjectDetail({ project }: { project: ProjectWithActions }): ReactElement {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [runError, setRunError] = useState<string | null>(null)

  const runAction = trpc.actions.run.useMutation({
    onSuccess: (result) => setRunError(result.ok ? null : (result.error ?? 'Action failed')),
    onError: (error) => setRunError(error.message)
  })
  const deleteAction = trpc.actions.delete.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      navigate({ to: '/' })
    }
  })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-10">
      <header className="flex items-start gap-4">
        <ProjectIcon icon={project.icon} color={project.color} size={30} className="size-14" />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading font-semibold text-2xl tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="mt-0.5 text-muted-foreground text-sm">{project.description}</p>
          )}
          {project.path && (
            <p
              className="mt-2 truncate font-mono text-muted-foreground text-xs"
              title={project.path}
            >
              {project.path}
            </p>
          )}
        </div>
        <Button
          variant="destructive-outline"
          size="sm"
          loading={deleteProject.isPending}
          onClick={() => deleteProject.mutate({ id: project.id })}
        >
          <IconTrash />
          Delete
        </Button>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm">Actions</h2>
          <AddActionDialog projectId={project.id} projectPath={project.path} />
        </div>

        {runError && (
          <p className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-sm">
            {runError}
          </p>
        )}

        {project.actions.length === 0 ? (
          <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
            No actions yet. Add a link to open or a command to run.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {project.actions.map((action) => (
              <li
                key={action.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="text-muted-foreground">
                  {action.type === 'link' ? (
                    <IconExternalLink size={18} />
                  ) : (
                    <IconTerminal2 size={18} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{action.label}</p>
                  <p className="truncate font-mono text-muted-foreground text-xs">
                    {actionTarget(action)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  loading={runAction.isPending && runAction.variables?.id === action.id}
                  onClick={() => runAction.mutate({ id: action.id })}
                >
                  <IconPlayerPlay />
                  Run
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${action.label}`}
                  className="text-destructive-foreground hover:bg-destructive/8 hover:text-destructive-foreground"
                  loading={deleteAction.isPending && deleteAction.variables?.id === action.id}
                  onClick={() => deleteAction.mutate({ id: action.id })}
                >
                  <IconTrash />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
