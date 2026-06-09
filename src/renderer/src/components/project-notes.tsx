import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconNotes,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconTrash
} from '@tabler/icons-react'
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { NoteEditor } from '@/components/note-editor'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import type { NoteRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

/** Compact timestamp for the list: time today, "Mon D" this year, else "Mon D, YYYY". */
function formatNoteDate(date: Date): string {
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  ).format(date)
}

/** The list preview line: the note's text after its title line, trimmed short. */
function noteSnippet(note: NoteRow): string {
  const lines = note.plaintext
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.slice(1).join(' ').slice(0, 120)
}

function NoteListRow({
  note,
  active,
  onSelect
}: {
  note: NoteRow
  active: boolean
  onSelect: () => void
}): ReactElement {
  const snippet = noteSnippet(note)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex w-full flex-col gap-0.5 border-border border-b px-3 py-2 text-left transition-colors',
          active ? 'bg-accent' : 'hover:bg-accent/50'
        )}
      >
        <div className="flex items-center gap-1.5">
          {note.pinned && <IconPinFilled className="size-3 shrink-0 text-muted-foreground" />}
          <span className="truncate font-medium text-sm">{note.title || 'New note'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <span className="shrink-0">{formatNoteDate(note.updatedAt)}</span>
          {snippet && <span className="truncate">{snippet}</span>}
        </div>
      </button>
    </li>
  )
}

/**
 * The Notes tab: a list of the project's notes beside the editor for the active
 * one. Notes auto-save (see {@link NoteEditor}); creating, deleting and pinning
 * go straight to the `notes` router. `expanded` is owned by the parent so it can
 * clear the surrounding chrome and let the active note fill the project page;
 * this component just hides the list and drops the border when expanded.
 */
export function ProjectNotes({
  project,
  expanded,
  onExpandedChange
}: {
  project: ProjectWithActions
  expanded: boolean
  onExpandedChange: (value: boolean) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const projectId = project.id
  const notesQuery = trpc.notes.list.useQuery({ projectId })
  const notes = notesQuery.data ?? []

  const [activeId, setActiveId] = useState<number | null>(null)
  // Selection falls back to the top note so there's always something to edit.
  const activeNote = notes.find((note) => note.id === activeId) ?? notes[0] ?? null

  const invalidate = useCallback(
    () => utils.notes.list.invalidate({ projectId }),
    [utils, projectId]
  )
  const create = trpc.notes.create.useMutation({
    onSuccess: (note) => {
      setActiveId(note.id)
      invalidate()
    }
  })
  const remove = trpc.notes.delete.useMutation({
    onSuccess: () => {
      setActiveId(null)
      invalidate()
    }
  })
  const setPinned = trpc.notes.setPinned.useMutation({ onSuccess: invalidate })

  // Reset selection + collapse when switching projects (this instance is reused).
  const seededProject = useRef(projectId)
  useEffect(() => {
    if (seededProject.current !== projectId) {
      seededProject.current = projectId
      setActiveId(null)
      onExpandedChange(false)
    }
  }, [projectId, onExpandedChange])

  // Never stay fullscreen with no note to show (e.g. the active note was deleted).
  useEffect(() => {
    if (expanded && !activeNote) onExpandedChange(false)
  }, [expanded, activeNote, onExpandedChange])

  const newNoteButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="New note"
            loading={create.isPending}
            onClick={() => create.mutate({ projectId })}
          />
        }
      >
        <IconPlus />
      </TooltipTrigger>
      <TooltipPopup>New note</TooltipPopup>
    </Tooltip>
  )

  if (notesQuery.isLoading) {
    return (
      <div className="flex h-[60vh] min-h-[22rem] items-center justify-center rounded-lg border border-border text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  if (notes.length === 0) {
    return (
      <div className="flex h-[60vh] min-h-[22rem] flex-col items-center justify-center gap-3 rounded-lg border border-border px-6 text-center">
        <IconNotes className="size-8 text-muted-foreground" />
        <div>
          <p className="font-medium text-sm">No notes yet</p>
          <p className="text-muted-foreground text-sm">
            Keep scratch notes, checklists and snippets scoped to this project.
          </p>
        </div>
        <Button size="sm" loading={create.isPending} onClick={() => create.mutate({ projectId })}>
          <IconPlus />
          New note
        </Button>
      </div>
    )
  }

  const toolbarEnd = activeNote && (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={activeNote.pinned ? 'Unpin note' : 'Pin note'}
              aria-pressed={activeNote.pinned}
              className={cn(activeNote.pinned && 'text-foreground')}
              onClick={() => setPinned.mutate({ id: activeNote.id, pinned: !activeNote.pinned })}
            />
          }
        >
          {activeNote.pinned ? <IconPinFilled /> : <IconPin />}
        </TooltipTrigger>
        <TooltipPopup>{activeNote.pinned ? 'Unpin' : 'Pin'}</TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={expanded ? 'Exit fullscreen' : 'Expand to fullscreen'}
              onClick={() => onExpandedChange(!expanded)}
            />
          }
        >
          {expanded ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
        </TooltipTrigger>
        <TooltipPopup>{expanded ? 'Exit fullscreen' : 'Fullscreen'}</TooltipPopup>
      </Tooltip>

      <AlertDialog>
        <AlertDialogTrigger
          render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Delete note" />}
        >
          <IconTrash />
        </AlertDialogTrigger>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the note. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => remove.mutate({ id: activeNote.id })}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  )

  return (
    <div
      className={cn(
        'flex overflow-hidden',
        expanded ? 'h-full' : 'h-[60vh] min-h-[22rem] rounded-lg border border-border'
      )}
    >
      <aside
        className={cn('flex w-64 shrink-0 flex-col border-border border-r', expanded && 'hidden')}
      >
        <div className="flex items-center justify-between gap-2 border-border border-b px-2 py-1.5">
          <span className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Notes
          </span>
          {newNoteButton}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {notes.map((note) => (
            <NoteListRow
              key={note.id}
              note={note}
              active={note.id === activeNote?.id}
              onSelect={() => setActiveId(note.id)}
            />
          ))}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {activeNote && <NoteEditor key={activeNote.id} note={activeNote} toolbarEnd={toolbarEnd} />}
      </div>
    </div>
  )
}
