import {
  IconArrowsSort,
  IconCheck,
  IconDots,
  IconEye,
  IconEyeOff,
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
import { ReorderableActions } from '@/components/reorderable-actions'
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
  const setHidden = trpc.actions.setHidden.useMutation({
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
        <p className="flex items-center gap-1.5 truncate font-medium text-sm">
          <span className="truncate">{action.label}</span>
          {action.hidden && (
            <IconEyeOff
              size={14}
              className="shrink-0 text-muted-foreground"
              aria-label="Hidden from dashboard"
            />
          )}
        </p>
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
          <MenuItem onClick={() => setHidden.mutate({ id: action.id, hidden: !action.hidden })}>
            {action.hidden ? <IconEye /> : <IconEyeOff />}
            {action.hidden ? 'Show on dashboard' : 'Hide from dashboard'}
          </MenuItem>
          <MenuSeparator />
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
  const updateGroup = trpc.groups.update.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span className="text-muted-foreground">
          <GroupIcon size={18} />
        </span>
        <span className="truncate font-medium text-sm">{group.name}</span>
        <span className="text-muted-foreground text-xs">{members.length}</span>
        {group.hidden && (
          <IconEyeOff
            size={14}
            className="text-muted-foreground"
            aria-label="Hidden from dashboard"
          />
        )}
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
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Manage ${group.name}`}
                  title="Manage group"
                />
              }
            >
              <IconDots />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-48">
              <MenuItem onClick={() => setAddOpen(true)}>
                <IconPlus />
                Add action
              </MenuItem>
              <MenuItem onClick={() => setEditOpen(true)}>
                <IconPencil />
                Edit group
              </MenuItem>
              <MenuItem onClick={() => updateGroup.mutate({ id: group.id, hidden: !group.hidden })}>
                {group.hidden ? <IconEye /> : <IconEyeOff />}
                {group.hidden ? 'Show on dashboard' : 'Hide from dashboard'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => deleteGroup.mutate({ id: group.id })}>
                <IconTrash />
                Delete group
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>

      <AddActionDialog
        projectId={project.id}
        projectPath={project.path}
        groups={project.groups}
        defaultGroupId={group.id}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
      <GroupDialog
        projectId={project.id}
        group={group}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

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
  const [reordering, setReordering] = useState(false)

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
  // Reordering is only meaningful with groups (move in/out, reorder them) or
  // more than one loose action to shuffle.
  const canReorder = project.groups.length > 0 || project.actions.length > 1

  const exitReorder = (): void => {
    // Re-sync the rest of the app (sidebar, dashboard) with the new order.
    utils.projects.list.invalidate()
    setReordering(false)
  }

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
          {reordering ? (
            <Button variant="outline" size="sm" onClick={exitReorder}>
              <IconCheck />
              Done
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              {canReorder && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRunError(null)
                    setReordering(true)
                  }}
                >
                  <IconArrowsSort />
                  Reorder
                </Button>
              )}
              <GroupDialog projectId={project.id} />
              <AddActionDialog
                projectId={project.id}
                projectPath={project.path}
                groups={project.groups}
              />
            </div>
          )}
        </div>

        {runError && (
          <p className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-sm">
            {runError}
          </p>
        )}

        {reordering ? (
          <ReorderableActions project={project} />
        ) : isEmpty ? (
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
