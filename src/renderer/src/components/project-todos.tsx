import { IconCalendarPlus, IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react'
import { type ReactElement, useCallback, useMemo, useState } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/menu'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import type { GlobalTodoRow, ProjectWithActions, TodoRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

/** The owning-project bits a global todo row carries (icon/color for the chip). */
type TodoProject = GlobalTodoRow['project']
/** A row the list can render: a todo, plus its project when shown globally. */
type TodoItem = TodoRow & { project?: TodoProject }

// Inputs the view hands back up; the wrappers wire these to the todos router.
type CreateInput = { projectId: number; title: string; dueDate: Date | null }
type UpdateInput = { id: number; title?: string; dueDate?: Date | null }

const DAY_MS = 86_400_000

/** Midnight of `date` in local time — for date-only comparisons (due dates). */
function startOfDay(date: Date): number {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/** A due date as "Today" / "Tomorrow" / "Yesterday", else "Mon D" (+ year if not
 *  this one). Date-only — the time component is never shown. */
function formatDueDate(date: Date): string {
  const today = startOfDay(new Date())
  const diff = Math.round((startOfDay(date) - today) / DAY_MS)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  ).format(date)
}

/** A pending due date is overdue if it's before today and the todo is still open. */
function isOverdue(date: Date, completed: boolean): boolean {
  return !completed && startOfDay(date) < startOfDay(new Date())
}

/** A calendar in a popover for picking (or clearing) a due date. When empty it
 *  shows just the calendar icon; once set it shows the date, reddened if overdue. */
function DueDatePicker({
  value,
  completed = false,
  alwaysVisible = false,
  onChange
}: {
  value: Date | null
  completed?: boolean
  // Keep the trigger shown even with no date (the add row); rows hide it until hover.
  alwaysVisible?: boolean
  onChange: (next: Date | null) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const overdue = value ? isOverdue(value, completed) : false
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={value ? `Due ${formatDueDate(value)}` : 'Set due date'}
            className={cn(
              'shrink-0 gap-1.5 text-muted-foreground',
              overdue && 'text-destructive-foreground',
              !value && !alwaysVisible && 'opacity-0 transition-opacity group-hover:opacity-100'
            )}
          />
        }
      >
        <IconCalendarPlus />
        {value && <span>{formatDueDate(value)}</span>}
      </PopoverTrigger>
      <PopoverPopup align="end">
        <div className="flex flex-col gap-2">
          <Calendar
            mode="single"
            autoFocus
            selected={value ?? undefined}
            defaultMonth={value ?? undefined}
            onSelect={(date) => {
              onChange(date ?? null)
              setOpen(false)
            }}
          />
          {value && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              Clear date
            </Button>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  )
}

/** The project's tinted icon, name on hover — the Project column in the global list. */
function TodoProjectChip({ project }: { project: TodoProject }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex w-fit shrink-0">
            <ProjectIcon icon={project.icon} color={project.color} size={13} className="size-6" />
          </span>
        }
      />
      <TooltipPopup>{project.name}</TooltipPopup>
    </Tooltip>
  )
}

/** Picks which project a new todo lands in (the global add row). Shows the
 *  selected project's icon + name; a radio menu of every project. */
function ProjectPicker({
  projects,
  value,
  onChange
}: {
  projects: TodoProject[]
  value: number | null
  onChange: (projectId: number) => void
}): ReactElement {
  const active = projects.find((project) => project.id === value) ?? projects[0]
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" className="shrink-0 gap-1.5" />}>
        {active && (
          <ProjectIcon icon={active.icon} color={active.color} size={11} className="size-4" />
        )}
        <span className="max-w-28 truncate">{active?.name ?? 'Project'}</span>
        <IconChevronDown />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-44">
        <MenuRadioGroup
          value={value != null ? String(value) : undefined}
          onValueChange={(next) => onChange(Number(next))}
        >
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

/** The always-present first row: type a title, optionally set a due date (and,
 *  globally, pick a project), Enter or click Add to create. */
function TodoAddRow({
  addProjects,
  fixedProjectId,
  creating,
  onCreate
}: {
  addProjects?: TodoProject[]
  fixedProjectId?: number
  creating: boolean
  onCreate: (input: CreateInput) => void
}): ReactElement {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState<Date | null>(null)
  const [projectId, setProjectId] = useState<number | null>(
    fixedProjectId ?? addProjects?.[0]?.id ?? null
  )
  const targetId = fixedProjectId ?? projectId
  const canAdd = title.trim().length > 0 && targetId != null

  const submit = (): void => {
    if (!canAdd || targetId == null) return
    onCreate({ projectId: targetId, title: title.trim(), dueDate })
    setTitle('')
    setDueDate(null)
  }

  return (
    <div className="group flex items-center gap-2 border-border border-b px-3 py-2">
      <IconPlus className="size-4 shrink-0 text-muted-foreground" />
      <Input
        unstyled
        size="sm"
        className="flex-1"
        placeholder="Add a todo…"
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      />
      {addProjects && (
        <ProjectPicker projects={addProjects} value={projectId} onChange={setProjectId} />
      )}
      <DueDatePicker value={dueDate} alwaysVisible onChange={setDueDate} />
      <Button size="sm" disabled={!canAdd} loading={creating} onClick={submit}>
        Add
      </Button>
    </div>
  )
}

/** A single todo row: completion checkbox, click-to-edit title, optional project
 *  chip, due-date picker, and a delete button revealed on hover. */
function TodoRowItem({
  todo,
  showProject,
  pendingDelete,
  onUpdate,
  onToggle,
  onDelete
}: {
  todo: TodoItem
  showProject: boolean
  pendingDelete: boolean
  onUpdate: (input: UpdateInput) => void
  onToggle: (id: number, completed: boolean) => void
  onDelete: (id: number) => void
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.title)

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== todo.title) onUpdate({ id: todo.id, title: next })
  }

  return (
    <li
      className={cn(
        'group flex items-center gap-3 border-border border-b px-3 py-2 transition-colors last:border-b-0 hover:bg-accent/50',
        todo.completed && 'opacity-60'
      )}
    >
      <Checkbox
        checked={todo.completed}
        aria-label={todo.completed ? 'Mark as not done' : 'Mark as done'}
        onCheckedChange={(checked) => onToggle(todo.id, checked === true)}
      />
      {editing ? (
        <Input
          autoFocus
          size="sm"
          className="flex-1"
          value={draft}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              setDraft(todo.title)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(todo.title)
            setEditing(true)
          }}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-sm',
            todo.completed && 'text-muted-foreground line-through'
          )}
        >
          {todo.title}
        </button>
      )}
      {showProject && todo.project && <TodoProjectChip project={todo.project} />}
      <DueDatePicker
        value={todo.dueDate}
        completed={todo.completed}
        onChange={(dueDate) => onUpdate({ id: todo.id, dueDate })}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete todo"
        loading={pendingDelete}
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => onDelete(todo.id)}
      >
        <IconTrash />
      </Button>
    </li>
  )
}

/**
 * The shared todos list: an add row on top, then open todos, then completed ones
 * (dimmed, struck through) sunk to the bottom — one flat list, no sections. Both
 * the project tab and the global view render this; the global view passes
 * `showProject` + `addProjects` (a project picker for the add row).
 */
export function TodosView({
  rows,
  isLoading,
  showProject = false,
  addProjects,
  fixedProjectId,
  creating,
  pendingDeleteId,
  onCreate,
  onUpdate,
  onToggle,
  onDelete
}: {
  rows: TodoItem[]
  isLoading: boolean
  showProject?: boolean
  addProjects?: TodoProject[]
  fixedProjectId?: number
  creating: boolean
  pendingDeleteId?: number
  onCreate: (input: CreateInput) => void
  onUpdate: (input: UpdateInput) => void
  onToggle: (id: number, completed: boolean) => void
  onDelete: (id: number) => void
}): ReactElement {
  // Open first, completed last; order within each group is the server's (newest
  // created first). Splitting here keeps completed at the bottom regardless.
  const ordered = useMemo(
    () => [...rows.filter((todo) => !todo.completed), ...rows.filter((todo) => todo.completed)],
    [rows]
  )

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <TodoAddRow
        addProjects={addProjects}
        fixedProjectId={fixedProjectId}
        creating={creating}
        onCreate={onCreate}
      />
      {isLoading ? (
        <p className="px-3 py-6 text-center text-muted-foreground text-sm">Loading…</p>
      ) : ordered.length === 0 ? (
        <p className="px-3 py-6 text-center text-muted-foreground text-sm">
          No todos yet. Add one above.
        </p>
      ) : (
        <ul>
          {ordered.map((todo) => (
            <TodoRowItem
              key={todo.id}
              todo={todo}
              showProject={showProject}
              pendingDelete={pendingDeleteId === todo.id}
              onUpdate={onUpdate}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** The project's Todos tab: its own todos, created against this project. */
export function ProjectTodos({ project }: { project: ProjectWithActions }): ReactElement {
  const utils = trpc.useUtils()
  const projectId = project.id
  const todosQuery = trpc.todos.list.useQuery({ projectId })
  const invalidate = useCallback(() => utils.todos.invalidate(), [utils])
  const create = trpc.todos.create.useMutation({ onSuccess: invalidate })
  const update = trpc.todos.update.useMutation({ onSuccess: invalidate })
  const setCompleted = trpc.todos.setCompleted.useMutation({ onSuccess: invalidate })
  const remove = trpc.todos.delete.useMutation({ onSuccess: invalidate })

  return (
    <TodosView
      rows={todosQuery.data ?? []}
      isLoading={todosQuery.isLoading}
      fixedProjectId={projectId}
      creating={create.isPending}
      pendingDeleteId={remove.isPending ? remove.variables?.id : undefined}
      onCreate={(input) => create.mutate(input)}
      onUpdate={(input) => update.mutate(input)}
      onToggle={(id, completed) => setCompleted.mutate({ id, completed })}
      onDelete={(id) => remove.mutate({ id })}
    />
  )
}
