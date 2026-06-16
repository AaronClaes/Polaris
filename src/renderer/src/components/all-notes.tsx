import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconInbox,
  IconNotes,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconTrash
} from '@tabler/icons-react'
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import { NoteEditor } from '@/components/note-editor'
import { ProjectIcon } from '@/components/project-icon'
import { formatNoteDate, noteSnippet } from '@/components/project-notes'
import { type ProjectOption, ProjectPicker } from '@/components/project-picker'
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
import type { GlobalNoteRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { useVisibleNotes, useVisibleProjects } from '@/lib/use-visible-projects'
import { cn } from '@/lib/utils'

/** The owning-project tile for a list row: the project's tinted icon (name on
 *  hover), or a muted inbox tile for an unlinked note — same glyph the picker uses
 *  for "No project", so the symbol reads the same in both places. */
function NoteProjectChip({ project }: { project: GlobalNoteRow['project'] }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0">
            {project ? (
              <ProjectIcon icon={project.icon} color={project.color} size={11} className="size-4" />
            ) : (
              <span className="inline-flex size-4 items-center justify-center rounded bg-muted text-muted-foreground">
                <IconInbox size={11} stroke={1.75} />
              </span>
            )}
          </span>
        }
      />
      <TooltipPopup>{project?.name ?? 'No project'}</TooltipPopup>
    </Tooltip>
  )
}

/** A row in the global list: the project chip trailing the title (so you can see
 *  at a glance where each note lives), then the date + snippet — otherwise the
 *  same shape as a project's notes list. */
function GlobalNoteListRow({
  note,
  active,
  onSelect
}: {
  note: GlobalNoteRow
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
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {note.title || 'New note'}
          </span>
          <NoteProjectChip project={note.project} />
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
 * The global Notes view: every note across all projects (plus unlinked ones)
 * beside the editor for the active one, mirroring a project's Notes tab. The list
 * adds a project chip per row and the toolbar a project picker, so a note can be
 * (re)filed or unlinked from here; "New note" creates an unlinked note. Notes
 * auto-save (see {@link NoteEditor}). `expanded` is local: it hides the page
 * chrome and the list so the active note fills the screen.
 */
export function AllNotes(): ReactElement {
  const utils = trpc.useUtils()
  const notesQuery = useVisibleNotes()
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data])

  // Every visible project, for the move/(re)file picker (the tag filter scopes
  // which notes show, not where you can file one).
  const projectsQuery = useVisibleProjects()
  const pickerProjects = useMemo<ProjectOption[]>(
    () =>
      (projectsQuery.data ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        icon: project.icon,
        color: project.color
      })),
    [projectsQuery.data]
  )

  const [activeId, setActiveId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  // Selection falls back to the top note so there's always something to edit.
  const activeNote = notes.find((note) => note.id === activeId) ?? notes[0] ?? null

  const invalidate = useCallback(() => utils.notes.invalidate(), [utils])
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
  const setProject = trpc.notes.setProject.useMutation({ onSuccess: invalidate })

  // Never stay fullscreen with no note to show (e.g. the active note was deleted).
  useEffect(() => {
    if (expanded && !activeNote) setExpanded(false)
  }, [expanded, activeNote])

  // Esc leaves fullscreen — unless an open dialog (e.g. delete confirm) should
  // take the keypress first.
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return
      setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])

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
            onClick={() => create.mutate({ projectId: null })}
          />
        }
      >
        <IconPlus />
      </TooltipTrigger>
      <TooltipPopup>New note</TooltipPopup>
    </Tooltip>
  )

  const toolbarEnd = activeNote && (
    <>
      <ProjectPicker
        projects={pickerProjects}
        value={activeNote.projectId}
        onChange={(projectId) => setProject.mutate({ id: activeNote.id, projectId })}
      />

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
              onClick={() => setExpanded(!expanded)}
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
    <div className={cn('flex h-full flex-col', !expanded && 'gap-4 px-8 pt-10 pb-8')}>
      {!expanded && (
        <header className="shrink-0">
          <h1 className="font-heading font-semibold text-2xl tracking-tight">
            Notes
            {!notesQuery.isLoading && (
              <span className="ml-2 font-normal text-muted-foreground">{notes.length}</span>
            )}
          </h1>
          <p className="mt-0.5 text-muted-foreground text-sm">
            Every note across your projects, plus ones linked to none.
          </p>
        </header>
      )}

      {notesQuery.isLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border text-muted-foreground text-sm">
          Loading…
        </div>
      ) : notes.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border px-6 text-center">
          <IconNotes className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium text-sm">No notes yet</p>
            <p className="text-muted-foreground text-sm">
              Jot something down here, or open a project's Notes tab to keep it scoped.
            </p>
          </div>
          <Button
            size="sm"
            loading={create.isPending}
            onClick={() => create.mutate({ projectId: null })}
          >
            <IconPlus />
            New note
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            'flex min-h-0 flex-1 overflow-hidden',
            !expanded && 'rounded-xl border border-border'
          )}
        >
          <aside
            className={cn(
              'flex w-64 shrink-0 flex-col border-border border-r',
              expanded && 'hidden'
            )}
          >
            <div className="flex items-center justify-between gap-2 border-border border-b px-2 py-1.5">
              <span className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Notes ({notes.length})
              </span>
              {newNoteButton}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {notes.map((note) => (
                <GlobalNoteListRow
                  key={note.id}
                  note={note}
                  active={note.id === activeNote?.id}
                  onSelect={() => setActiveId(note.id)}
                />
              ))}
            </ul>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {activeNote && (
              <NoteEditor key={activeNote.id} note={activeNote} toolbarEnd={toolbarEnd} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
