import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconGripVertical } from '@tabler/icons-react'
import { type ReactElement, useMemo, useRef, useState } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { Card } from '@/components/ui/card'
import type { ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

/** A project tile's identity: its icon, name, and optional description. Shared by
 *  the sortable card and the drag overlay so they look identical. */
function ProjectTileBody({ project }: { project: ProjectWithActions }): ReactElement {
  return (
    <>
      <ProjectIcon icon={project.icon} color={project.color} size={22} className="size-11" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-sm leading-tight">{project.name}</h3>
        {project.description && (
          <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{project.description}</p>
        )}
      </div>
    </>
  )
}

/** A draggable project tile (grip handle + identity), one grid cell. The whole
 *  card is non-interactive in reorder mode — only the grip starts a drag. */
function SortableProjectCard({ project }: { project: ProjectWithActions }): ReactElement {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: project.id
  })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <Card className={cn('h-full flex-row items-start gap-3 p-4', isDragging && 'opacity-50')}>
        <button
          type="button"
          aria-label={`Reorder ${project.name}`}
          className="-ml-1 mt-0.5 flex cursor-grab touch-none items-center text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={16} />
        </button>
        <ProjectTileBody project={project} />
      </Card>
    </div>
  )
}

/**
 * Drag-to-reorder surface for the projects grid. Holds its own order (seeded once
 * from the project list) and persists each drop via projects.reorder; the parent
 * re-syncs the shared query on exit so the sidebar and dashboard pick up the new
 * order too. A flat single list — no nesting — so it's a plain grid sort.
 */
export function ReorderableProjects({
  projects
}: {
  projects: ProjectWithActions[]
}): ReactElement {
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const [order, setOrderState] = useState<number[]>(() => projects.map((p) => p.id))
  const [activeId, setActiveId] = useState<number | null>(null)

  // A ref mirrors state so the drag handler reads the freshest order synchronously.
  const orderRef = useRef(order)
  const commitOrder = (next: number[]): void => {
    orderRef.current = next
    setOrderState(next)
  }

  const reorder = trpc.projects.reorder.useMutation()

  // Persist the full arrangement — each id's index becomes its sortOrder. The
  // mutation is an idempotent overwrite, so we always send everything.
  const persist = (ids: number[]): void => {
    reorder.mutate({ items: ids.map((id, index) => ({ id, sortOrder: index })) })
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const oldIndex = orderRef.current.indexOf(Number(active.id))
    const newIndex = orderRef.current.indexOf(Number(over.id))
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
    const next = arrayMove(orderRef.current, oldIndex, newIndex)
    commitOrder(next)
    persist(next)
  }

  const activeProject = activeId != null ? projectsById.get(activeId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setActiveId(Number(event.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {order.map((id) => {
            const project = projectsById.get(id)
            if (!project) return null
            return <SortableProjectCard key={id} project={project} />
          })}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeProject ? (
          <Card className="flex-row items-start gap-3 p-4 shadow-lg">
            <IconGripVertical size={16} className="-ml-1 mt-0.5 text-muted-foreground" />
            <ProjectTileBody project={activeProject} />
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
