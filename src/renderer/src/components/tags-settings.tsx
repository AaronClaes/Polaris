import { IconPlus, IconTrash } from '@tabler/icons-react'
import { type FormEvent, type ReactElement, useEffect, useState } from 'react'
import { ColorPicker } from '@/components/color-picker'
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
import { Input } from '@/components/ui/input'
import { DEFAULT_COLOR_KEY } from '@/lib/colors'
import type { TagRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** One existing tag: an inline color picker + label (committed on blur/Enter) and
 * a delete button. Edits auto-save — there's no per-row Save. */
function TagRowEditor({
  tag,
  onUpdate,
  onDelete,
  deleting
}: {
  tag: TagRow
  onUpdate: (values: { label?: string; color?: string }) => void
  onDelete: () => void
  deleting: boolean
}): ReactElement {
  const [label, setLabel] = useState(tag.label)
  // Re-sync if the persisted label changes (e.g. a save lands or list refetches).
  useEffect(() => setLabel(tag.label), [tag.label])

  const commitLabel = (): void => {
    const trimmed = label.trim()
    if (!trimmed || trimmed === tag.label) {
      setLabel(tag.label) // revert a blank/no-op edit
      return
    }
    onUpdate({ label: trimmed })
  }

  return (
    <div className="flex items-center gap-2">
      <div className="w-40 shrink-0">
        <ColorPicker value={tag.color} onChange={(color) => onUpdate({ color })} />
      </div>
      <Input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={commitLabel}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        aria-label="Tag label"
        className="flex-1"
      />
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              loading={deleting}
              aria-label={`Delete ${tag.label}`}
              title="Delete tag"
              className="shrink-0 text-muted-foreground hover:text-destructive-foreground"
            >
              <IconTrash />
            </Button>
          }
        />
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{tag.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Projects with this tag won't be deleted — they'll just become untagged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose render={<Button variant="destructive" onClick={onDelete} />}>
              Delete tag
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  )
}

/** Manage the project tags: create, recolor/rename, and delete. Deleting a tag
 * un-tags its projects, so the project list is invalidated alongside the tags. */
export function TagsSettings(): ReactElement {
  const utils = trpc.useUtils()
  const tagsQuery = trpc.tags.list.useQuery()
  const tags = tagsQuery.data ?? []

  const invalidateTags = (): Promise<void> => utils.tags.list.invalidate()
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_COLOR_KEY)

  const create = trpc.tags.create.useMutation({
    onSuccess: () => {
      invalidateTags()
      setNewLabel('')
      setNewColor(DEFAULT_COLOR_KEY)
    }
  })
  const update = trpc.tags.update.useMutation({ onSuccess: invalidateTags })
  const remove = trpc.tags.delete.useMutation({
    onSuccess: () => {
      invalidateTags()
      // A deleted tag un-tags its projects; refresh the list so the filter clears.
      utils.projects.list.invalidate()
    }
  })

  const handleAdd = (event: FormEvent): void => {
    event.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    create.mutate({ label, color: newColor })
  }

  return (
    <section className="grid gap-4">
      {tags.length > 0 && (
        <div className="grid gap-2">
          {tags.map((tag) => (
            <TagRowEditor
              key={tag.id}
              tag={tag}
              onUpdate={(values) => update.mutate({ id: tag.id, ...values })}
              onDelete={() => remove.mutate({ id: tag.id })}
              deleting={remove.isPending && remove.variables?.id === tag.id}
            />
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <div className="w-40 shrink-0">
          <ColorPicker value={newColor} onChange={setNewColor} />
        </div>
        <Input
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          placeholder="New tag (e.g. Work)"
          aria-label="New tag label"
          className="flex-1"
        />
        <Button type="submit" loading={create.isPending} disabled={!newLabel.trim()}>
          <IconPlus />
          Add
        </Button>
      </form>

      {create.error && (
        <p className="text-destructive-foreground text-sm">{create.error.message}</p>
      )}
    </section>
  )
}
