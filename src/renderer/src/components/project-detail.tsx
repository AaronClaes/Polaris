import {
  IconDots,
  IconInbox,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconTrash
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { type ReactElement, useMemo, useState } from 'react'
import { AddActionDialog } from '@/components/add-action-dialog'
import { GroupDialog } from '@/components/group-dialog'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger
} from '@/components/ui/menu'
import { getIcon } from '@/lib/icons'
import type { ActionGroupRow, ProjectActionRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import type { CommandActionConfig, LinkActionConfig } from '../../../main/db/schema'

function actionTarget(action: ProjectActionRow): string {
  return action.type === 'link'
    ? (action.config as LinkActionConfig).url
    : (action.config as CommandActionConfig).command
}

/** One action: chosen icon, label, target, a Run button and a move/delete menu. */
function ActionRow({
  action,
  groups,
  onError
}: {
  action: ProjectActionRow
  groups: ActionGroupRow[]
  onError: (message: string | null) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const Icon = getIcon(action.icon).Icon

  const runAction = trpc.actions.run.useMutation({
    onSuccess: (res) => onError(res.ok ? null : (res.error ?? 'Action failed')),
    onError: (error) => onError(error.message)
  })
  const deleteAction = trpc.actions.delete.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const setGroup = trpc.actions.setGroup.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })

  const moveTargets = groups.filter((g) => g.id !== action.groupId)
  const hasMove = action.groupId != null || moveTargets.length > 0

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="text-muted-foreground">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{action.label}</p>
        <p className="truncate font-mono text-muted-foreground text-xs">{actionTarget(action)}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        loading={runAction.isPending}
        onClick={() => runAction.mutate({ id: action.id })}
      >
        <IconPlayerPlay />
        Run
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${action.label}`}
            />
          }
        >
          <IconDots />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-44">
          {hasMove && (
            <>
              <MenuGroup>
                <MenuGroupLabel>Move to</MenuGroupLabel>
                {action.groupId != null && (
                  <MenuItem onClick={() => setGroup.mutate({ id: action.id, groupId: null })}>
                    <IconInbox />
                    Ungrouped
                  </MenuItem>
                )}
                {moveTargets.map((group) => {
                  const GroupIcon = getIcon(group.icon).Icon
                  return (
                    <MenuItem
                      key={group.id}
                      onClick={() => setGroup.mutate({ id: action.id, groupId: group.id })}
                    >
                      <GroupIcon />
                      {group.name}
                    </MenuItem>
                  )
                })}
              </MenuGroup>
              <MenuSeparator />
            </>
          )}
          <MenuItem variant="destructive" onClick={() => deleteAction.mutate({ id: action.id })}>
            <IconTrash />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  )
}

/** A group as a bordered section: header (run-all + manage) over member rows. */
function GroupSection({
  project,
  group,
  members,
  onError
}: {
  project: ProjectWithActions
  group: ActionGroupRow
  members: ProjectActionRow[]
  onError: (message: string | null) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const GroupIcon = getIcon(group.icon).Icon

  const runGroup = trpc.groups.run.useMutation({
    onSuccess: (res) => {
      if (res.ok) return onError(null)
      const failed = res.results.filter((r) => !r.ok)
      onError(
        `${failed.length} of ${res.results.length} failed: ${failed.map((r) => r.label).join(', ')}`
      )
    },
    onError: (error) => onError(error.message)
  })
  const deleteGroup = trpc.groups.delete.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span className="text-muted-foreground">
          <GroupIcon size={18} />
        </span>
        <span className="truncate font-medium text-sm">{group.name}</span>
        <span className="text-muted-foreground text-xs">{members.length}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            loading={runGroup.isPending}
            disabled={members.length === 0}
            onClick={() => runGroup.mutate({ groupId: group.id })}
          >
            <IconPlayerPlay />
            Run all
          </Button>
          <AddActionDialog
            projectId={project.id}
            projectPath={project.path}
            groups={project.groups}
            defaultGroupId={group.id}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Add action to ${group.name}`}
                title="Add action to group"
              >
                <IconPlus />
              </Button>
            }
          />
          <GroupDialog
            projectId={project.id}
            group={group}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${group.name}`}
                title="Edit group"
              >
                <IconPencil />
              </Button>
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive-foreground hover:bg-destructive/8 hover:text-destructive-foreground"
            aria-label={`Delete ${group.name}`}
            title="Delete group (its actions are kept)"
            loading={deleteGroup.isPending}
            onClick={() => deleteGroup.mutate({ id: group.id })}
          >
            <IconTrash />
          </Button>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="px-3 py-4 text-center text-muted-foreground text-xs">
          No actions yet. Add one to this group.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {members.map((action) => (
            <ActionRow key={action.id} action={action} groups={project.groups} onError={onError} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectDetail({ project }: { project: ProjectWithActions }): ReactElement {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
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

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      navigate({ to: '/' })
    }
  })

  const isEmpty = project.groups.length === 0 && looseActions.length === 0

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
          <div className="flex items-center gap-2">
            <GroupDialog projectId={project.id} />
            <AddActionDialog
              projectId={project.id}
              projectPath={project.path}
              groups={project.groups}
            />
          </div>
        </div>

        {runError && (
          <p className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-sm">
            {runError}
          </p>
        )}

        {isEmpty ? (
          <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
            No actions yet. Add a link to open, a command to run, or a group to launch several at
            once.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {project.groups.map((group) => (
              <GroupSection
                key={group.id}
                project={project}
                group={group}
                members={membersByGroup.get(group.id) ?? []}
                onError={setRunError}
              />
            ))}

            {looseActions.length > 0 && (
              <div className="rounded-xl border border-border">
                <div className="flex items-center gap-2 border-border border-b px-3 py-2">
                  <span className="text-muted-foreground">
                    <IconInbox size={18} />
                  </span>
                  <span className="truncate font-medium text-sm">Ungrouped</span>
                  <span className="text-muted-foreground text-xs">{looseActions.length}</span>
                </div>
                <div className="divide-y divide-border">
                  {looseActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      groups={project.groups}
                      onError={setRunError}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
