import {
  IconBold,
  IconCode,
  IconH1,
  IconH2,
  IconH3,
  IconItalic,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconSourceCode,
  IconStrikethrough,
  type TablerIcon
} from '@tabler/icons-react'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { Placeholder } from '@tiptap/extensions'
import { type Content, EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import type { NoteDoc, NoteRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

// One lowlight instance (the common language set) shared by every editor. The
// extension list is built once too — TipTap extensions are reusable definitions.
const lowlight = createLowlight(common)
const EXTENSIONS = [
  // StarterKit ships a plain `codeBlock`; swap it for the lowlight variant so
  // fenced blocks get syntax highlighting. Links are styled but not click-to-open
  // (you're editing, not browsing).
  StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
  CodeBlockLowlight.configure({ lowlight }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Write something…' })
]

type NotePayload = { title: string; body: NoteDoc; plaintext: string }

/** The note's title is its first non-empty line (Apple Notes-style), capped so a
 *  runaway paragraph can't bloat the list column. */
function deriveTitle(plaintext: string): string {
  const firstLine = plaintext
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine ? firstLine.slice(0, 200) : ''
}

/** A single formatting control: an icon button with a tooltip, pressed-styled
 *  when its mark/node is active at the selection. */
function ToolbarButton({
  label,
  icon: Icon,
  active,
  disabled,
  onClick
}: {
  label: string
  icon: TablerIcon
  active?: boolean
  disabled?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            className={cn(active && 'bg-accent text-accent-foreground')}
            onClick={onClick}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  )
}

/**
 * The rich-text editor for a single note. Mount it keyed by note id: the editor
 * (and its undo history) then belongs to one note for its lifetime, so switching
 * notes gives a fresh editor while toggling fullscreen — which doesn't change the
 * key — keeps the very same instance, cursor and undo stack intact.
 *
 * Edits auto-save: every change is debounced (500ms) and persisted via
 * notes.update, and any pending edit is flushed when the note is left.
 * `toolbarEnd` lets the parent drop note-level actions (pin, expand, delete) into
 * the right side of the toolbar.
 */
export function NoteEditor({
  note,
  toolbarEnd
}: {
  note: NoteRow
  toolbarEnd?: ReactNode
}): ReactElement {
  const utils = trpc.useUtils()
  const update = trpc.notes.update.useMutation({
    onSuccess: () => {
      // Refresh the per-project list (when linked) and always the global list, so
      // a save updates whichever surface is showing this note (project tab or the
      // global Notes view) without a manual refetch.
      if (note.projectId != null) utils.notes.list.invalidate({ projectId: note.projectId })
      utils.notes.listAll.invalidate()
    }
  })

  // The component is keyed by note.id, so these stay fixed for its lifetime.
  const save = update.mutate
  const noteId = note.id
  const pending = useRef<NotePayload | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback((): void => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current) {
      save({ id: noteId, ...pending.current })
      pending.current = null
    }
  }, [noteId, save])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: EXTENSIONS,
    // Stored ProseMirror JSON → TipTap's Content type.
    content: note.body as unknown as Content,
    editorProps: { attributes: { class: 'note-editor' } },
    autofocus: 'end',
    onUpdate: ({ editor }) => {
      const plaintext = editor.getText({ blockSeparator: '\n' })
      pending.current = {
        title: deriveTitle(plaintext),
        body: editor.getJSON() as unknown as NoteDoc,
        plaintext
      }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 500)
    }
  })

  // Flush any unsaved edit when the note is left (switched away or unmounted).
  useEffect(() => flush, [flush])

  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive('bold'),
            italic: editor.isActive('italic'),
            strike: editor.isActive('strike'),
            h1: editor.isActive('heading', { level: 1 }),
            h2: editor.isActive('heading', { level: 2 }),
            h3: editor.isActive('heading', { level: 3 }),
            bulletList: editor.isActive('bulletList'),
            orderedList: editor.isActive('orderedList'),
            taskList: editor.isActive('taskList'),
            codeBlock: editor.isActive('codeBlock')
          }
        : null
  })

  const disabled = !editor
  const run = (fn: (chain: ReturnType<NonNullable<typeof editor>['chain']>) => void): void => {
    if (editor) fn(editor.chain().focus())
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-border border-b px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5">
          <ToolbarButton
            label="Bold"
            icon={IconBold}
            active={state?.bold}
            disabled={disabled}
            onClick={() => run((c) => c.toggleBold().run())}
          />
          <ToolbarButton
            label="Italic"
            icon={IconItalic}
            active={state?.italic}
            disabled={disabled}
            onClick={() => run((c) => c.toggleItalic().run())}
          />
          <ToolbarButton
            label="Strikethrough"
            icon={IconStrikethrough}
            active={state?.strike}
            disabled={disabled}
            onClick={() => run((c) => c.toggleStrike().run())}
          />
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            label="Heading 1"
            icon={IconH1}
            active={state?.h1}
            disabled={disabled}
            onClick={() => run((c) => c.toggleHeading({ level: 1 }).run())}
          />
          <ToolbarButton
            label="Heading 2"
            icon={IconH2}
            active={state?.h2}
            disabled={disabled}
            onClick={() => run((c) => c.toggleHeading({ level: 2 }).run())}
          />
          <ToolbarButton
            label="Heading 3"
            icon={IconH3}
            active={state?.h3}
            disabled={disabled}
            onClick={() => run((c) => c.toggleHeading({ level: 3 }).run())}
          />
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            label="Bullet list"
            icon={IconList}
            active={state?.bulletList}
            disabled={disabled}
            onClick={() => run((c) => c.toggleBulletList().run())}
          />
          <ToolbarButton
            label="Numbered list"
            icon={IconListNumbers}
            active={state?.orderedList}
            disabled={disabled}
            onClick={() => run((c) => c.toggleOrderedList().run())}
          />
          <ToolbarButton
            label="Checklist"
            icon={IconListCheck}
            active={state?.taskList}
            disabled={disabled}
            onClick={() => run((c) => c.toggleTaskList().run())}
          />
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            label="Code block"
            icon={IconSourceCode}
            active={state?.codeBlock}
            disabled={disabled}
            onClick={() => run((c) => c.toggleCodeBlock().run())}
          />
          <ToolbarButton
            label="Inline code"
            icon={IconCode}
            disabled={disabled}
            onClick={() => run((c) => c.toggleCode().run())}
          />
        </div>
        {toolbarEnd && <div className="flex shrink-0 items-center gap-0.5">{toolbarEnd}</div>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-5">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
