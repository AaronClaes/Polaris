import {
  type CollisionDetection,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconGripVertical, IconInbox } from '@tabler/icons-react'
import { type ReactElement, useMemo, useRef, useState } from 'react'
import { ActionIcon } from '@/components/action-icon'
import { getIcon } from '@/lib/icons'
import type { ActionGroupRow, ProjectActionRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import type { CommandActionConfig, LinkActionConfig } from '../../../main/db/schema'

const UNGROUPED = 'ungrouped'
const groupKey = (id: number): string => `group-${id}`
const actionKey = (id: number): string => `action-${id}`
const parseGroupId = (key: string): number => Number(key.slice('group-'.length))
const parseActionId = (key: string): number => Number(key.slice('action-'.length))

type Containers = Record<string, string[]>

function actionTarget(action: ProjectActionRow): string {
  return action.type === 'link'
    ? (action.config as LinkActionConfig).url
    : (action.config as CommandActionConfig).command
}

/** Build the initial container → ordered action-id map from project data. */
function buildContainers(project: ProjectWithActions): Containers {
  const map: Containers = { [UNGROUPED]: [] }
  for (const group of project.groups) map[groupKey(group.id)] = []
  for (const action of project.actions) {
    const key = action.groupId == null ? UNGROUPED : groupKey(action.groupId)
    if (!map[key]) map[key] = []
    map[key].push(actionKey(action.id))
  }
  return map
}

type DragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'> & {
  label: string
}

function DragHandle({ label, attributes, listeners }: DragHandleProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      className="-ml-1 flex cursor-grab touch-none items-center text-muted-foreground hover:text-foreground"
      {...attributes}
      {...listeners}
    >
      <IconGripVertical size={16} />
    </button>
  )
}

function ActionRowContent({ action }: { action: ProjectActionRow }): ReactElement {
  return (
    <>
      <span className="text-muted-foreground">
        <ActionIcon action={action} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{action.label}</p>
        <p className="truncate font-mono text-muted-foreground text-xs">{actionTarget(action)}</p>
      </div>
    </>
  )
}

/** A draggable action row (grip handle + identity), used inside any container. */
function SortableActionRow({ action }: { action: ProjectActionRow }): ReactElement {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: actionKey(action.id)
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('flex items-center gap-3 px-3 py-2', isDragging && 'opacity-50')}
    >
      <DragHandle label={`Reorder ${action.label}`} attributes={attributes} listeners={listeners} />
      <ActionRowContent action={action} />
    </div>
  )
}

/** Renders a container's rows (or an empty drop hint). */
function ContainerBody({
  actions,
  emptyHint
}: {
  actions: ProjectActionRow[]
  emptyHint: string
}): ReactElement {
  if (actions.length === 0) {
    return <p className="px-3 py-4 text-center text-muted-foreground text-xs">{emptyHint}</p>
  }
  return (
    <div className="divide-y divide-border">
      {actions.map((action) => (
        <SortableActionRow key={action.id} action={action} />
      ))}
    </div>
  )
}

/** A draggable group section: its header is the group's drag handle; its body
 * is a sortable + droppable container for member actions. */
function SortableGroupSection({
  group,
  actions
}: {
  group: ActionGroupRow
  actions: ProjectActionRow[]
}): ReactElement {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: groupKey(group.id)
  })
  const GroupIcon = getIcon(group.icon).Icon
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('rounded-xl border border-border', isDragging && 'opacity-60')}
    >
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <DragHandle label={`Reorder ${group.name}`} attributes={attributes} listeners={listeners} />
        <span className="text-muted-foreground">
          <GroupIcon size={18} />
        </span>
        <span className="truncate font-medium text-sm">{group.name}</span>
        <span className="text-muted-foreground text-xs">{actions.length}</span>
      </div>
      <SortableContext
        items={actions.map((a) => actionKey(a.id))}
        strategy={verticalListSortingStrategy}
      >
        <ContainerBody actions={actions} emptyHint="Drop actions here" />
      </SortableContext>
    </div>
  )
}

/** The ungrouped (loose) container — a droppable so actions can be dragged out. */
function UngroupedSection({ actions }: { actions: ProjectActionRow[] }): ReactElement {
  const { setNodeRef } = useDroppable({ id: UNGROUPED })
  return (
    <div ref={setNodeRef} className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span className="text-muted-foreground">
          <IconInbox size={18} />
        </span>
        <span className="truncate font-medium text-sm">Ungrouped</span>
        <span className="text-muted-foreground text-xs">{actions.length}</span>
      </div>
      <SortableContext
        items={actions.map((a) => actionKey(a.id))}
        strategy={verticalListSortingStrategy}
      >
        <ContainerBody actions={actions} emptyHint="Drop actions here to ungroup them" />
      </SortableContext>
    </div>
  )
}

/**
 * Drag-to-reorder surface for a project's groups and actions. Holds its own
 * ordering state (seeded once from the project) and persists each drop via the
 * reorder mutations; the parent re-syncs on exit.
 */
export function ReorderableActions({ project }: { project: ProjectWithActions }): ReactElement {
  const groupsById = useMemo(() => new Map(project.groups.map((g) => [g.id, g])), [project.groups])
  const actionsById = useMemo(
    () => new Map(project.actions.map((a) => [a.id, a])),
    [project.actions]
  )

  const [groupOrder, setGroupOrderState] = useState<string[]>(() =>
    project.groups.map((g) => groupKey(g.id))
  )
  const [containers, setContainersState] = useState<Containers>(() => buildContainers(project))
  const [activeId, setActiveId] = useState<string | null>(null)

  // Refs mirror state so drag handlers read the freshest value synchronously.
  const groupOrderRef = useRef(groupOrder)
  const containersRef = useRef(containers)
  const commitGroups = (next: string[]): void => {
    groupOrderRef.current = next
    setGroupOrderState(next)
  }
  const commitContainers = (next: Containers): void => {
    containersRef.current = next
    setContainersState(next)
  }

  const reorderActions = trpc.actions.reorder.useMutation()
  const reorderGroups = trpc.groups.reorder.useMutation()

  const persistContainers = (next: Containers): void => {
    const items: { id: number; groupId: number | null; sortOrder: number }[] = []
    for (const [key, ids] of Object.entries(next)) {
      const groupId = key === UNGROUPED ? null : parseGroupId(key)
      ids.forEach((aKey, index) => {
        items.push({ id: parseActionId(aKey), groupId, sortOrder: index })
      })
    }
    reorderActions.mutate({ items })
  }
  const persistGroups = (next: string[]): void => {
    reorderGroups.mutate({
      items: next.map((gKey, index) => ({
        id: parseGroupId(gKey),
        sortOrder: index
      }))
    })
  }

  const findContainer = (id: string): string | null => {
    if (id in containersRef.current) return id
    for (const key of Object.keys(containersRef.current)) {
      if (containersRef.current[key].includes(id)) return key
    }
    return null
  }

  // When dragging a group, only let it collide with other group containers so
  // the reorder stays clean; actions collide with everything.
  const collisionDetection: CollisionDetection = (args) => {
    if (String(args.active.id).startsWith('group-')) {
      return closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          String(c.id).startsWith('group-')
        )
      })
    }
    return closestCorners(args)
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const handleDragStart = (event: DragStartEvent): void => setActiveId(String(event.active.id))

  const handleDragOver = (event: DragOverEvent): void => {
    const { active, over } = event
    if (!over) return
    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)
    if (activeIdStr.startsWith('group-')) return // group reorder handled on drop

    const activeContainer = findContainer(activeIdStr)
    const overContainer = findContainer(overIdStr)
    if (!activeContainer || !overContainer || activeContainer === overContainer) return

    const prev = containersRef.current
    const activeItems = prev[activeContainer]
    const overItems = prev[overContainer]
    const overIndex = overItems.indexOf(overIdStr)

    let newIndex: number
    if (overIdStr in prev) {
      newIndex = overItems.length
    } else {
      const isBelow =
        active.rect.current.translated &&
        active.rect.current.translated.top > over.rect.top + over.rect.height / 2
      newIndex = overIndex >= 0 ? overIndex + (isBelow ? 1 : 0) : overItems.length
    }

    commitContainers({
      ...prev,
      [activeContainer]: activeItems.filter((id) => id !== activeIdStr),
      [overContainer]: [...overItems.slice(0, newIndex), activeIdStr, ...overItems.slice(newIndex)]
    })
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    const activeIdStr = String(active.id)
    setActiveId(null)
    if (!over) return
    const overIdStr = String(over.id)

    if (activeIdStr.startsWith('group-')) {
      const order = groupOrderRef.current
      const oldIndex = order.indexOf(activeIdStr)
      let overGroupKey = overIdStr
      if (!overIdStr.startsWith('group-')) {
        const container = findContainer(overIdStr)
        overGroupKey = container?.startsWith('group-') ? container : activeIdStr
      }
      const newIndex = order.indexOf(overGroupKey)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const next = arrayMove(order, oldIndex, newIndex)
        commitGroups(next)
        persistGroups(next)
      }
      return
    }

    // Action drop: the cross-container move already happened in dragOver, so
    // active now lives in the over container — finalize its index there.
    const activeContainer = findContainer(activeIdStr)
    const overContainer = findContainer(overIdStr)
    if (!activeContainer || !overContainer) {
      persistContainers(containersRef.current)
      return
    }

    const items = containersRef.current[overContainer]
    const oldIndex = items.indexOf(activeIdStr)
    const newIndex =
      overIdStr in containersRef.current ? items.length - 1 : items.indexOf(overIdStr)

    let next = containersRef.current
    if (activeContainer === overContainer && oldIndex !== newIndex && newIndex >= 0) {
      next = {
        ...containersRef.current,
        [overContainer]: arrayMove(items, oldIndex, newIndex)
      }
      commitContainers(next)
    }
    persistContainers(next)
  }

  const actionsFor = (key: string): ProjectActionRow[] =>
    (containers[key] ?? [])
      .map((aKey) => actionsById.get(parseActionId(aKey)))
      .filter(Boolean) as ProjectActionRow[]

  const activeAction =
    activeId && !activeId.startsWith('group-')
      ? actionsById.get(parseActionId(activeId))
      : undefined
  const activeGroup = activeId?.startsWith('group-')
    ? groupsById.get(parseGroupId(activeId))
    : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex flex-col gap-3">
        <SortableContext items={groupOrder} strategy={verticalListSortingStrategy}>
          {groupOrder.map((gKey) => {
            const group = groupsById.get(parseGroupId(gKey))
            if (!group) return null
            return <SortableGroupSection key={gKey} group={group} actions={actionsFor(gKey)} />
          })}
        </SortableContext>
        <UngroupedSection actions={actionsFor(UNGROUPED)} />
      </div>

      <DragOverlay>
        {activeAction ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
            <IconGripVertical size={16} className="-ml-1 text-muted-foreground" />
            <ActionRowContent action={activeAction} />
          </div>
        ) : activeGroup ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg">
            <IconGripVertical size={16} className="-ml-1 text-muted-foreground" />
            {(() => {
              const GroupIcon = getIcon(activeGroup.icon).Icon
              return <GroupIcon size={18} className="text-muted-foreground" />
            })()}
            <span className="font-medium text-sm">{activeGroup.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
