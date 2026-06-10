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
  pointerWithin,
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
import { IconGripVertical } from '@tabler/icons-react'
import { type ReactElement, useMemo, useRef, useState } from 'react'
import { ActionIcon } from '@/components/action-icon'
import { buildRootEntries } from '@/lib/action-tree'
import { getIcon } from '@/lib/icons'
import type { ActionGroupRow, ProjectActionRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import type {
  AppLauncherActionConfig,
  CommandActionConfig,
  LinkActionConfig,
  RepoActionConfig
} from '../../../main/db/schema'

// Sortable ids and container keys. A group appears in the root list as
// `group-<id>` and owns a `members-<id>` droppable holding its action rows; a
// loose action is `action-<id>`, living directly in the root list. The root and
// each members list are the entries of the `containers` map.
const groupKey = (id: number): string => `group-${id}`
const membersKey = (id: number): string => `members-${id}`
const actionKey = (id: number): string => `action-${id}`
const isGroupKey = (key: string): boolean => key.startsWith('group-')
const isMembersKey = (key: string): boolean => key.startsWith('members-')
const parseId = (key: string): number => Number(key.slice(key.indexOf('-') + 1))

const ROOT = 'root'

type Containers = Record<string, string[]>

function actionTarget(action: ProjectActionRow): string {
  switch (action.type) {
    case 'link':
      return (action.config as LinkActionConfig).url
    case 'command':
      return (action.config as CommandActionConfig).command
    case 'repo': {
      const config = action.config as RepoActionConfig
      return `${config.owner}/${config.name}`
    }
    default:
      // terminal / ide: the directory it opens (the cwd override) or, when none
      // is set, a label for the default app it resolves to at run time.
      return (
        (action.config as AppLauncherActionConfig).cwd ??
        (action.type === 'terminal' ? 'Default terminal' : 'Default editor')
      )
  }
}

/** Build the initial container map: the root list (groups + loose actions in
 * their shared order) plus a members list per group. */
function buildContainers(project: ProjectWithActions): Containers {
  const loose = project.actions.filter((a) => a.groupId == null)
  const root = buildRootEntries(project.groups, loose).map((entry) =>
    entry.kind === 'group' ? groupKey(entry.group.id) : actionKey(entry.action.id)
  )
  const containers: Containers = { [ROOT]: root }
  for (const group of project.groups) containers[membersKey(group.id)] = []
  // project.actions arrives ordered by sortOrder, so members land in order.
  for (const action of project.actions) {
    if (action.groupId != null) containers[membersKey(action.groupId)].push(actionKey(action.id))
  }
  return containers
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

/** A draggable action row (grip handle + identity), used in the root list and
 * inside groups alike. */
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

/** A draggable group section in the root list: its header is the group's drag
 * handle; its body is a droppable + sortable container for member actions. */
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
  // The body is its own droppable so an action dragged inside it joins the group
  // (vs. reordering next to the group in the root list).
  const { setNodeRef: setBodyRef } = useDroppable({ id: membersKey(group.id) })
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
      <div ref={setBodyRef}>
        <SortableContext
          items={actions.map((a) => actionKey(a.id))}
          strategy={verticalListSortingStrategy}
        >
          <ContainerBody actions={actions} emptyHint="Drop actions here" />
        </SortableContext>
      </div>
    </div>
  )
}

/**
 * Drag-to-reorder surface for a project's groups and actions. Groups and loose
 * actions share one root list and can be interleaved; actions can also be
 * dragged into or out of groups. Holds its own ordering state (seeded once from
 * the project) and persists each drop via the reorder mutations; the parent
 * re-syncs on exit.
 */
export function ReorderableActions({ project }: { project: ProjectWithActions }): ReactElement {
  const groupsById = useMemo(() => new Map(project.groups.map((g) => [g.id, g])), [project.groups])
  const actionsById = useMemo(
    () => new Map(project.actions.map((a) => [a.id, a])),
    [project.actions]
  )

  const [containers, setContainersState] = useState<Containers>(() => buildContainers(project))
  const [activeId, setActiveId] = useState<string | null>(null)

  // A ref mirrors state so the drag handlers read the freshest value synchronously.
  const containersRef = useRef(containers)
  const commitContainers = (next: Containers): void => {
    containersRef.current = next
    setContainersState(next)
  }

  const reorderActions = trpc.actions.reorder.useMutation()
  const reorderGroups = trpc.groups.reorder.useMutation()

  // Persist the full arrangement. Root entries (groups + loose actions) take
  // their shared index in the root list as sortOrder; group members number
  // within their group. Idempotent overwrite, so we always send everything.
  const persist = (state: Containers): void => {
    const groupItems: { id: number; sortOrder: number }[] = []
    const actionItems: {
      id: number
      groupId: number | null
      sortOrder: number
    }[] = []
    state[ROOT].forEach((key, index) => {
      if (isGroupKey(key)) groupItems.push({ id: parseId(key), sortOrder: index })
      else actionItems.push({ id: parseId(key), groupId: null, sortOrder: index })
    })
    for (const [containerKey, ids] of Object.entries(state)) {
      if (!isMembersKey(containerKey)) continue
      const groupId = parseId(containerKey)
      ids.forEach((aKey, index) => {
        actionItems.push({ id: parseId(aKey), groupId, sortOrder: index })
      })
    }
    reorderActions.mutate({ items: actionItems })
    reorderGroups.mutate({ items: groupItems })
  }

  const findContainer = (id: string): string | null => {
    if (id in containersRef.current) return id
    for (const key of Object.keys(containersRef.current)) {
      if (containersRef.current[key].includes(id)) return key
    }
    return null
  }

  // Resolve the drop target by intent. A dragged group reorders among the root
  // entries only. A dragged action: when the pointer is over a group's body, it
  // targets that group's member rows — so it reorders within the group (or drops
  // into it) at the hovered position; an empty group has no rows, so it targets
  // the body itself. When the pointer is outside every body (a group header or
  // the space around entries), it targets the root entries only — which is what
  // lets an action be dropped before or after a group, top one included.
  const collisionDetection: CollisionDetection = (args) => {
    const activeIdStr = String(args.active.id)
    const restrictTo = (keys: Set<string>): ReturnType<CollisionDetection> =>
      closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => keys.has(String(c.id)))
      })

    if (isGroupKey(activeIdStr)) {
      return restrictTo(new Set(containersRef.current[ROOT]))
    }

    const within = pointerWithin(args)
    const body = within.find((c) => isMembersKey(String(c.id)))
    if (body) {
      const members = new Set(containersRef.current[String(body.id)] ?? [])
      return members.size > 0 ? restrictTo(members) : [body]
    }

    // Hysteresis: if the action already lives in a group and the pointer is still
    // anywhere over that group's card (e.g. its header), keep it in the group
    // rather than releasing to the root. Without this, the target flickers
    // rapidly between the group and the root right at the body's edge — each move
    // shifts the layout and flips the decision back. Releasing needs the pointer
    // to leave the card entirely.
    const activeContainer = findContainer(activeIdStr)
    if (activeContainer && isMembersKey(activeContainer)) {
      const ownGroup = groupKey(parseId(activeContainer))
      if (within.some((c) => String(c.id) === ownGroup)) {
        return restrictTo(new Set(containersRef.current[activeContainer]))
      }
    }
    return restrictTo(new Set(containersRef.current[ROOT]))
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
    if (isGroupKey(activeIdStr)) return // group reorder is handled on drop

    const activeContainer = findContainer(activeIdStr)
    const overContainer = findContainer(overIdStr)
    if (!activeContainer || !overContainer || activeContainer === overContainer) return

    const prev = containersRef.current
    const activeItems = prev[activeContainer]
    const overItems = prev[overContainer]

    let newIndex: number
    if (overIdStr in prev) {
      newIndex = overItems.length
    } else {
      const overIndex = overItems.indexOf(overIdStr)
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
    if (!over) {
      persist(containersRef.current)
      return
    }
    const overIdStr = String(over.id)

    if (isGroupKey(activeIdStr)) {
      // Reorder the group among the root entries (groups + loose actions).
      const root = containersRef.current[ROOT]
      const oldIndex = root.indexOf(activeIdStr)
      const newIndex = root.indexOf(overIdStr)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const next = {
          ...containersRef.current,
          [ROOT]: arrayMove(root, oldIndex, newIndex)
        }
        commitContainers(next)
        persist(next)
      }
      return
    }

    // Action drop: the cross-container move already happened in dragOver, so
    // active now lives in the over container — finalize its index there.
    const activeContainer = findContainer(activeIdStr)
    const overContainer = findContainer(overIdStr)
    if (!activeContainer || !overContainer) {
      persist(containersRef.current)
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
    persist(next)
  }

  const actionsFor = (key: string): ProjectActionRow[] =>
    (containers[key] ?? [])
      .map((aKey) => actionsById.get(parseId(aKey)))
      .filter(Boolean) as ProjectActionRow[]

  const activeAction =
    activeId && !isGroupKey(activeId) ? actionsById.get(parseId(activeId)) : undefined
  const activeGroup =
    activeId && isGroupKey(activeId) ? groupsById.get(parseId(activeId)) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={containers[ROOT]} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-3">
          {containers[ROOT].map((key) => {
            if (isGroupKey(key)) {
              const group = groupsById.get(parseId(key))
              if (!group) return null
              return (
                <SortableGroupSection
                  key={key}
                  group={group}
                  actions={actionsFor(membersKey(group.id))}
                />
              )
            }
            const action = actionsById.get(parseId(key))
            if (!action) return null
            return <SortableActionRow key={key} action={action} />
          })}
        </div>
      </SortableContext>

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
